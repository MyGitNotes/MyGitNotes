import { NewerVersionError } from './newer-version-error.js';
import { STUDY_FILE } from './study.js';
import { BookmarkError } from './bookmark-error.js';
import { managedNotebook } from './file-manager.js';
import path from 'node:path';
import { assetPath, decodeAsset, isAssetPath } from './assets.js';
import { MANIFEST_FILES } from './remote-manifest.js';
import { type RepositoryId, StaleRevisionError } from './repository.js';
import { isNoteFile, NOTE_EXTENSIONS, parseNoteFile, serializeNoteFile } from './note-file.js';
import { templateFileId } from './templates.js';
import { isNotebookContent, parseFolderConfig } from './folders.js';
import { NotebookConfig, NoteMetadata } from './types.js';
import { SourceError } from './github-api.js';
import { agentFileAllowed, agentWorkspaceFile } from './agent-workspace.js';
import { agentSkillLocation, renameAgentSkillEntryContent, renamedAgentSkillPath, rewriteAgentSkillReferences } from './agent-skill-metadata.js';
import { skillFile } from './agent-system.js';
import { type CommitScope, readWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument, workspaceDocument, writeWorkspaceDocument } from './workspace-documents.js';
import { gitBlobId } from './remote-cache.js';
import { addVersion, agentEditMessage, readVersionFile, serializeVersionFile, versionedPath, versionFilePath, type VersionLabel } from './note-versions.js';
import { CASE_COLLISION_ERROR, differsOnlyInCase } from './case-collision.js';
import { type CommitAuthor, commitAuthor, withCoAuthors } from './commit-author.js';
import { CheckedOutError, LiveStaleError, LiveTooLargeError, normalizeLiveText } from './live-notes.js';
import { editedLiveError, liveNoteState, parseLiveBase } from './live-repository.js';
import type { CommitNoteChange, CommitNoteDeletion, CommitNoteWrite, RemoteChange, RemoteCommitHeard, RemoteSnapshot } from './remote-source/types.js';
import { NoteSource } from './remote-source/notes.js';

export { SourceError } from './github-api.js';
export type { CommitNoteChange, CommitNoteDeletion, CommitNoteWrite, HistoryRead, LiveMoveResult, LiveRelocationLeft, RemoteChange, RemoteCommit, RemoteCommitHeard, RemoteEntry, RemoteSnapshot, RepositoryInfo } from './remote-source/types.js';
/** Hears of every commit this process publishes to a remote repository: its identity, as `RemoteSource.id`, and the changed paths. */
export type RemoteCommitListener = (repository: RepositoryId, paths: string[]) => void;
const commitListeners = new Set<RemoteCommitListener>();

/** Subscribes to the commits this process publishes, so open pages can read history again; returns the unsubscribe. */
export function onRemoteCommit(listener: RemoteCommitListener): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

/** Shared workspace rules, independent of the Git hosting provider. */
export abstract class RemoteSource extends NoteSource {
  /** Whom this reader tells of each commit `commitChanges` makes ({@link onCommit}). */
  private commitHeard?: (changes: readonly RemoteChange[], commit: RemoteCommitHeard) => void;
  /**
   * The author of the commits this source publishes. It is checked when a commit is made, before a provider hears of
   * it, and not when the source opens: a person whose author cannot be written into a commit still reads.
   */
  private checkedAuthor(): CommitAuthor | undefined {
    return commitAuthor(this.commitsAs);
  }
  private announceCommit(paths: string[]) {
    for (const listener of commitListeners) {
      try {
        listener(this.id, paths);
      } catch (error) {
        console.warn(`[remote-source] commit listener failed: ${(error as Error).message}`);
      }
    }
  }
  /**
   * Has this reader tell `listener` of each commit it makes through `commitChanges`, once it landed: the changes as
   * they were written, so a text needs no second read, and the commit's revision. The server publishes the notes of an
   * `/mcp` call's commits with it. What the listener throws is logged and never fails the commit; a second listener
   * replaces the first.
   */
  onCommit(listener: (changes: readonly RemoteChange[], commit: RemoteCommitHeard) => void) {
    this.commitHeard = listener;
  }
  /**
   * Rejects a mutation without write access, one touching `paths` while any is checked out to the live editor, or one
   * against a revision other than `snapshot`, in that order.
   */
  private async assertMutable(snapshot: RemoteSnapshot, expected: string, paths: readonly string[] = [], refusal?: (touched: string[]) => CheckedOutError) {
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    await this.refuseCheckedOut(paths, refusal);
    if (!expected || expected !== snapshot.sha) throw new StaleRevisionError([this.id], 'The repository changed. Reload before saving.');
  }

  /** Commits a serialized manifest to one of the manifest locations. */
  async commitManifest(file: string, content: string, expected: string) {
    if (!MANIFEST_FILES.includes(file)) throw new SourceError('Path is not a workspace manifest.', 403);
    // The same commit subject a local checkout writes, so the history reads the same from either side.
    return this.commitChanges([{ path: file, content }], expected, 'save', 'config', 'chore(workspace): update configuration');
  }

  async mutateAsset(operation: 'upload' | 'move' | 'delete', args: Record<string, unknown>) {
    const config = await this.config();
    const snapshot = await this.getSnapshot();
    const file = typeof args.path === 'string' ? args.path : '';
    const nb = config.notebooks.find(n => operation === 'upload' ? n.id === args.notebookId : isAssetPath(file, n));
    if (!nb) throw new SourceError('Asset notebook or path is unavailable.', 403);
    const existing = snapshot.entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (operation !== 'upload' && !existing) throw new SourceError('Asset not found.', 404);
    const destination = operation === 'delete' ? file : assetPath(nb, args.directory ?? '', args.filename || path.posix.basename(file));
    if (operation !== 'delete' && snapshot.entries.some(e => e.path === destination)) throw new SourceError('Destination already exists.', 409);
    // A name another entry has in different letter case is the same file once the repository is checked out on macOS or Windows.
    if (operation !== 'delete' && differsOnlyInCase(snapshot.entries.map(e => e.path), destination, entry => entry === file)) throw new SourceError(CASE_COLLISION_ERROR, 409);
    const changes = operation === 'upload' ? [{ path: destination, base64: decodeAsset(args.base64Content).toString('base64') }] : operation === 'move' ? [{ path: destination, sha: existing!.sha }, { path: file, sha: null }] : [{ path: file, sha: null }];
    const receipt = await this.commitChanges(changes, String(args.revision || ''), operation, 'assets');
    return { ...receipt, path: destination };
  }

  /** `agent` marks the commit as an agent's edit of this one file. */
  async save(file: string, content: string, metadata: NoteMetadata | undefined, expected: string, createOnly = false, agent = false) {
    // A `live:` revision, which only a read of a checked-out note hands out, writes the note's text into the live editor.
    const base = parseLiveBase(expected);
    const snapshot = await this.getSnapshot(!base);
    if (base) {
      if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    } else await this.assertMutable(snapshot, expected, [file], () => editedLiveError(file));
    const config = await this.config();
    const link = base ? await this.liveLink(file) : undefined;
    if (base && !link) throw new LiveStaleError();
    const nb = link?.notebook ?? config.notebooks.find(n => file.startsWith(`${n.root}/`));
    if (!nb || !(link || isNotebookContent(file.slice(nb.root.length + 1), nb) || templateFileId(file.slice(nb.root.length + 1)) !== undefined) || !isNoteFile(file) || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p)) throw new SourceError('Path is not a configured note.', 403);
    if (createOnly && snapshot.entries.some(e => e.path === file)) throw new SourceError('A note already exists at this path.', 409);
    if (createOnly && differsOnlyInCase(snapshot.entries.map(e => e.path), file)) throw new SourceError(CASE_COLLISION_ERROR, 409);
    const existing = snapshot.entries.find(e => e.path === file);
    if (existing && (existing.type !== 'blob' || existing.mode === '120000')) throw new SourceError('Path is not a regular note file.', 403);
    if (file.includes('\0') || (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)))) throw new SourceError('Invalid note path or metadata.');
    const existingRaw = link ? (await this.liveTextOf(link)).content : existing ? await this.readFile(file).then(b => b.toString('utf8')).catch(() => undefined) : undefined;
    const serialized = metadata ? serializeNoteFile(file, metadata, content, !existing && !link, new Date(), existingRaw) : content;
    // The live editor keeps text in normal form, which is what the note then reads.
    const raw = base ? normalizeLiveText(serialized) : serialized;
    if (Buffer.byteLength(raw) > 5 * 1024 * 1024) throw base ? new LiveTooLargeError() : new SourceError('Note exceeds the 5 MiB limit.', 413);
    const operation = existing || link ? 'write' : 'create';
    const receipt = base ? await this.writeLive(file, raw, base, agent) : await this.commitChanges([{ path: file, content: raw }], expected, operation, 'notes', agent ? agentEditMessage(`docs(notes): ${operation} ${path.posix.basename(file)}`) : undefined, snapshot);
    const { extra, ...parsed } = parseNoteFile(raw, file, config.notebooks.map(item => item.root));
    return { ...receipt, note: { id: typeof parsed.metadata.id === 'string' ? parsed.metadata.id : file, path: file, notebookId: nb.id, ...parsed, ...extra, tags: Array.isArray(parsed.metadata.tags) ? parsed.metadata.tags.map(String) : [], status: typeof parsed.metadata.status === 'string' ? parsed.metadata.status : undefined, size: Buffer.byteLength(raw), revision: receipt.revision, ...(link ? { live: liveNoteState(link.checkout, this.live!.retargets) } : {}) } };
  }

  /**
   * Publish selected browser working notes as one commit after validation. A `delete` entry removes its note, and its
   * version file with it, in the same commit. With `version`, the one note's version
   * file joins the same commit with a version recorded after the current head, since the commit cannot name itself.
   */
  async commitNotes(notes: CommitNoteChange[], expected: string, message: string, documents: { path: string; page: unknown; base: unknown; }[] = [], version?: { path: string; label: VersionLabel; today: string; }) {
    if (!Array.isArray(notes) || !Array.isArray(documents) || !notes.length && !documents.length || notes.length + documents.length > 200) throw new SourceError('Select between 1 and 200 files.');
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) throw new SourceError('A commit message of at most 4000 characters is required.');
    const snapshot = await this.getSnapshot(true);
    // A browser never writes a live note: a commit naming a checked-out note is refused before any note is read.
    await this.refuseCheckedOut(notes.map(note => note?.path).filter((file): file is string => typeof file === 'string'));
    const removals = notes.filter((note): note is CommitNoteDeletion => note?.delete === true);
    for (const note of removals) {
      if (typeof note.path !== 'string' || !isNoteFile(note.path)) throw new SourceError('Invalid note change.');
      if (!snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`Note moved or deleted: ${note.path}.`, 409);
    }
    if (version && removals.length) throw new SourceError('A new version commits its note alone.');
    const writes = notes.filter((note): note is CommitNoteWrite => note?.delete !== true);
    for (const note of writes) {
      if (!note || typeof note.path !== 'string' || !isNoteFile(note.path) || typeof note.content !== 'string' || !note.metadata || typeof note.metadata !== 'object' || Array.isArray(note.metadata)) throw new SourceError('Invalid note change.');
      if (note.createOnly && snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`A note already exists at ${note.path}.`, 409);
      if (!note.createOnly && !snapshot.entries.some(entry => entry.path === note.path)) throw new SourceError(`Note moved or deleted: ${note.path}.`, 409);
    }
    // A creation never takes the name of another entry in different letter case or Unicode form, nor the name of another creation of this batch: a case-insensitive file system would make them one.
    const removed = new Set(removals.map(note => note.path));
    const created = writes.filter(note => note.createOnly).map(note => note.path);
    for (const path of created) {
      if (differsOnlyInCase(snapshot.entries.map(entry => entry.path), path, entry => removed.has(entry))) throw new SourceError(CASE_COLLISION_ERROR, 409);
      if (differsOnlyInCase(created, path)) throw new SourceError(CASE_COLLISION_ERROR, 409);
    }
    // Bounds concurrent blob reads the same way `contents()` does, so a 200-note batch cannot burst 200 uncached platform reads at once.
    await this.prefetchFiles(writes.filter(note => !note.createOnly).map(note => note.path));
    const changes: RemoteChange[] = [];
    for (let i = 0; i < writes.length; i += 6) {
      changes.push(
        ...await Promise.all(
          writes.slice(i, i + 6).map(async note => {
            const existingRaw = note.createOnly ? undefined : await this.readFile(note.path).then(b => b.toString('utf8')).catch(error => {
              if (!(error instanceof SourceError && error.status === 404)) throw error;
              return undefined;
            });
            return { path: note.path, content: serializeNoteFile(note.path, note.metadata, note.content, Boolean(note.createOnly), new Date(), existingRaw) };
          }),
        ),
      );
    }
    for (const note of removals) {
      changes.push({ path: note.path, sha: null });
      const versions = versionFilePath(note.path);
      if (snapshot.entries.some(entry => entry.path === versions)) changes.push({ path: versions, sha: null });
    }
    for (const draft of documents) {
      const document = workspaceDocument(draft?.path);
      if (document?.retired) throw new SourceError('Legacy bookmark authoring is retired. Export or import the saved source into a new outline.', 410);
      if (!document?.scopes.includes('folders')) throw new SourceError('Path is not an allowed workspace resource.', 403);
      const page = document.schema.safeParse(draft.page), base = document.schema.safeParse(draft.base);
      if (!page.success || !base.success) throw new SourceError(`Invalid ${document.label} configuration.`);
      const current = await this.readDocumentSnapshot(document, snapshot);
      if (JSON.stringify(current) !== JSON.stringify(base.data)) throw new SourceError(`${document.label} configuration changed. Reload and review your draft.`, 409);
      await this.validateDocumentChange(document, current, page.data, (await this.config()).notebooks, snapshot);
      changes.push({ path: document.file, content: writeWorkspaceDocument(document, page.data) });
    }
    if (version) {
      const change = changes.find(entry => entry.path === version.path);
      if (!change || changes.length !== 1) throw new SourceError('A new version commits its note alone.');
      const file = versionFilePath(version.path);
      const now = new Date();
      try {
        const record = readVersionFile(snapshot.entries.some(entry => entry.path === file) ? (await this.readSnapshotFile(snapshot, file)).toString('utf8') : null);
        addVersion(record, { blob: gitBlobId(Buffer.from(change.content!), snapshot.sha.length), parent: snapshot.sha, authored: now.toISOString() }, version.label, version.today, now);
        changes.push({ path: file, content: serializeVersionFile(record) });
      } catch (error) {
        throw error instanceof SourceError ? error : new SourceError((error as Error).message, 409);
      }
    }
    return this.commitChanges(changes, expected, 'update', documents.length ? 'folders' : 'notes', message.trim(), snapshot);
  }

  /** One Git tree, commit and non-force ref update for the entire mutation. */
  async saveAgentResource(file: string, content: string, expected: string, create?: boolean) {
    if (typeof file !== 'string' || !agentWorkspaceFile(file, (await this.config()).notebooks)) throw new SourceError('Path is not an agent workspace file.', 403);
    if (typeof content !== 'string') throw new SourceError('Agent document content is required.');
    if (create) {
      // A new skill needs a free folder; any other new file needs a free path, so creating never overwrites.
      const location = agentSkillLocation(file);
      const snapshot = await this.getSnapshot(true);
      if (location && snapshot.entries.some(entry => entry.path === location.directory || entry.path.startsWith(`${location.directory}/`))) throw new SourceError(`A skill named ${location.slug} already exists.`, 409);
      if (!location && snapshot.entries.some(entry => entry.path === file)) throw new SourceError(`${file} already exists.`, 409);
      return this.commitChanges([{ path: file, content }], expected, 'write', 'agents', undefined, snapshot);
    }
    return this.commitChanges([{ path: file, content }], expected, 'write', 'agents');
  }

  /** Moves every blob in a skill directory and updates textual Agent-document references in one commit. */
  async renameAgentSkill(file: string, slug: string, content: string, expected: string) {
    const location = agentSkillLocation(file);
    if (!location || typeof content !== 'string') throw new SourceError('A directory-backed SKILL.md path and content are required.');
    let nextPath: string;
    try {
      nextPath = renamedAgentSkillPath(file, slug);
    } catch (error) {
      throw new SourceError((error as Error).message, 400);
    }
    const notebooks = (await this.config()).notebooks;
    if (agentWorkspaceFile(file, notebooks)?.kind !== 'skill' || agentWorkspaceFile(nextPath, notebooks)?.kind !== 'skill') throw new SourceError('Only a workspace skill can be renamed.', 403);
    if (nextPath === file) return this.saveAgentResource(file, content, expected);
    const nextLocation = agentSkillLocation(nextPath)!;
    const snapshot = await this.getSnapshot(true);
    await this.assertMutable(snapshot, expected);
    if (snapshot.entries.some(entry => entry.path === nextLocation.directory || entry.path.startsWith(`${nextLocation.directory}/`))) throw new SourceError(`A skill named ${nextLocation.slug} already exists.`, 409);

    const skillEntries = snapshot.entries.filter(entry => entry.type === 'blob' && (entry.path === location.directory || entry.path.startsWith(`${location.directory}/`)));
    if (!skillEntries.some(entry => entry.path === file)) throw new SourceError('Skill moved or deleted.', 409);
    if (skillEntries.some(entry => entry.mode === '120000')) throw new SourceError('Skill directories cannot contain symlinks.', 403);
    const changes = new Map<string, RemoteChange>();
    for (const entry of skillEntries) {
      changes.set(entry.path, { path: entry.path, sha: null });
      const destination = `${nextLocation.directory}${entry.path.slice(location.directory.length)}`;
      changes.set(destination, { path: destination, sha: entry.sha });
    }
    changes.set(nextPath, { path: nextPath, content: renameAgentSkillEntryContent(content, location.directory, nextLocation.directory, nextLocation.slug) });

    const references = snapshot.entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && agentWorkspaceFile(entry.path, notebooks) && !entry.path.startsWith(`${location.directory}/`));
    for (const entry of references) {
      const original = (await this.readFile(entry.path)).toString('utf8');
      const updated = rewriteAgentSkillReferences(original, location.directory, nextLocation.directory);
      if (updated !== original) changes.set(entry.path, { path: entry.path, content: updated });
    }
    if (changes.size > 200) throw new SourceError('Skill rename affects more than 200 files.', 413);
    // Opaque companions (e.g. images) may move by blob id with this directory, but cannot be edited as agent files.
    const companions = new Set([...changes.values()].filter(change => change.sha !== undefined).map(change => change.path));
    const receipt = await this.commitMutation([...changes.values()], expected, 'rename', 'agents', `docs(agents): rename ${location.slug} to ${nextLocation.slug}`, snapshot, [], companions);
    return { ...receipt, path: nextPath };
  }

  async saveStudyTransition(content: string, note: { path: string; content: string; }, expected: string) {
    return this.commitChanges([{ path: STUDY_FILE, content }, note], expected, 'review', 'study-transition');
  }

  async saveStudyWorkspace(content: string, expected: string) {
    return this.commitChanges([{ path: STUDY_FILE, content }], expected, 'save', 'study');
  }

  async saveWorkspaceDocument(document: WorkspaceDocument, content: string, expected: string) {
    if (document.retired) throw new SourceError('Legacy bookmark authoring is retired. Export or import the saved source into a new outline.', 410);
    const snapshot = await this.getSnapshot(true);
    await this.assertMutable(snapshot, expected);
    const current = await this.readDocumentSnapshot(document, snapshot);
    await this.validateDocumentChange(document, current, readWorkspaceDocument(document, content), (await this.config()).notebooks, snapshot);
    return this.commitChanges([{ path: document.file, content }], expected, 'save', document.scopes[0], undefined, snapshot);
  }

  private async readDocumentSnapshot(document: WorkspaceDocument, snapshot: RemoteSnapshot) {
    const entry = snapshot.entries.find(entry => entry.path === document.file);
    if (entry && (entry.type !== 'blob' || entry.mode === '120000')) throw new SourceError(`${document.label} must be a regular file.`, 403);
    if (entry?.size && entry.size > document.maxBytes) throw new SourceError(`${document.label} is too large.`, 413);
    const raw = entry ? (await this.readSnapshotFile(snapshot, document.file)).toString('utf8') : null;
    if (raw !== null && Buffer.byteLength(raw) > document.maxBytes) throw new SourceError(`${document.label} is too large.`, 413);
    try {
      return readWorkspaceDocument(document, raw);
    } catch (error) {
      if (error instanceof NewerVersionError) throw new SourceError(error.message, 422);
      throw new SourceError(`Invalid ${document.label} YAML. Fix the file before saving.`, 422);
    }
  }

  private async validateDocumentChange(document: WorkspaceDocument, current: unknown, next: unknown, notebooks: NotebookConfig[], snapshot: RemoteSnapshot, relocation = false) {
    try {
      document.validateChange?.(current, next, notebooks, relocation);
      if (!relocation) {
        await document.validateReferences?.(current, next, notebooks, async file => {
          if (!snapshot.entries.some(entry => entry.path === file)) return null;
          return parseNoteFile((await this.readSnapshotFile(snapshot, file)).toString('utf8'), file).content;
        });
      }
    } catch (error) {
      if (error instanceof BookmarkError) throw Object.assign(new SourceError(error.message, error.code === 'duplicate-target' ? 409 : 400), { code: error.code, existingId: error.existingId });
      throw error;
    }
  }

  /**
   * One commit of `changes` on `expected`, each path checked against what `scope` may write. The message is
   * `requestedMessage`, or one made from the operation; `coAuthors` are named after it in `Co-authored-by` trailers.
   */
  async commitChanges(changes: { path: string; content?: string; base64?: string; sha?: string | null; }[], expected: string, operation: string, scope: CommitScope = 'notes', requestedMessage?: string, knownSnapshot?: RemoteSnapshot, coAuthors: readonly CommitAuthor[] = []) {
    return this.commitMutation(changes, expected, operation, scope, requestedMessage, knownSnapshot, coAuthors);
  }

  private async commitMutation(changes: RemoteChange[], expected: string, operation: string, scope: CommitScope, requestedMessage: string | undefined, knownSnapshot: RemoteSnapshot | undefined, coAuthors: readonly CommitAuthor[], companions?: ReadonlySet<string>) {
    if (!Array.isArray(changes)) throw new SourceError('A mutation requires an array of changed files.', 400);
    const snapshot = knownSnapshot || await this.getSnapshot(true);
    // One note's new text refused because it is checked out tells the writer to read it again; any other change names every checked-out path.
    const single = changes.length === 1 && changes[0]?.content !== undefined ? changes[0].path : undefined;
    await this.assertMutable(snapshot, expected, changes.map(change => change?.path).filter((file): file is string => typeof file === 'string'), single ? () => editedLiveError(single) : undefined);
    if (!changes.length || changes.length > 200) throw new SourceError('A mutation requires between 1 and 200 changed files.');
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new SourceError('Each file may appear only once in a mutation.');
    const config = await this.config();
    const changed = new Set(changes.map(change => change.path));
    let bytes = 0;
    for (const change of changes) {
      const file = change.path;
      const nb = config.notebooks.find(n => file.startsWith(`${n.root}/`));
      const document = workspaceDocument(file);
      const relocation = ['move', 'delete', 'remove-directory', 'mv'].includes(operation) && ['files', 'folders'].includes(scope);
      if (document?.retired && !relocation) throw new SourceError('Legacy bookmark authoring is retired. Export or import the saved source into a new outline.', 410);
      const documentFile = Boolean(document?.scopes.includes(scope));
      // A version file is written with its versions, or with its note's New version, and otherwise only follows its note's move or deletion;
      // a note commit touches one only together with its note, so a note tool cannot edit or delete versions on their own.
      const versioned = versionedPath(file);
      const versionFile = Boolean(versioned) && (scope === 'versions' || scope === 'notes' && changed.has(versioned!) || ['files', 'folders', 'skills', 'agents'].includes(scope) && change.content === undefined && change.base64 === undefined);
      // A `.templates/` template file is written and removed like a note, the only dot path a note commit reaches.
      const templateFile = Boolean(nb) && ['notes', 'folders'].includes(scope) && templateFileId(file.slice(nb!.root.length + 1)) !== undefined;
      const allowed = companions?.has(file) || documentFile || versionFile || scope !== 'versions' && (scope === 'config' ? MANIFEST_FILES.includes(file) : !['study', 'focus', 'config'].includes(scope) && (scope === 'files' ? Boolean(managedNotebook(file, config.notebooks)) : scope === 'study-transition' ? nb && isNotebookContent(file.slice(nb.root.length + 1), nb) && NOTE_EXTENSIONS.test(file) : scope === 'skills' ? Boolean(skillFile(file, config.notebooks)) : scope === 'agents' ? agentFileAllowed(file, config.notebooks) : nb && (scope === 'assets' ? isAssetPath(file, nb) : isNotebookContent(file.slice(nb.root.length + 1), nb) && (isNoteFile(file) || path.posix.basename(file) === '_dir.yml') || templateFile)));
      if (!allowed || file.includes('\\') || file.includes('\0') || file.split('/').some(p => !p || p === '.' || p === '..')) throw new SourceError('Path is not an allowed workspace resource.', 403);
      if (documentFile) {
        validateWorkspaceDocument(document!, change.content);
        if (document!.validateChange) {
          const current = await this.readDocumentSnapshot(document!, snapshot);
          await this.validateDocumentChange(document!, current, readWorkspaceDocument(document!, change.content!), config.notebooks, snapshot, relocation);
        }
      }
      if (snapshot.entries.some(e => (e.path === file || file.startsWith(e.path + '/')) && (e.mode === '120000' || (e.path !== file && e.type !== 'tree')))) throw new SourceError('Path crosses a non-directory or symlink.', 403);
      const existing = snapshot.entries.find(e => e.path === file);
      if (existing && existing.type !== 'blob') throw new SourceError('A directory occupies the target path.', 409);
      if (change.sha === null && !existing) throw new SourceError('File to remove does not exist.', 404);
      if (change.base64 !== undefined) {
        if (scope !== 'assets' && scope !== 'files') throw new SourceError('Binary content requires an asset path.');
        bytes += decodeAsset(change.base64).length;
      } else if (change.content !== undefined) {
        bytes += Buffer.byteLength(change.content);
        if (path.posix.basename(file) === '_dir.yml') parseFolderConfig(change.content, path.posix.basename(path.posix.dirname(file)), file);
      } else if (change.sha !== null) {
        const source = snapshot.entries.find(e => e.sha === change.sha && e.type === 'blob' && e.mode !== '120000');
        if (!source) throw new SourceError('Copy source is unavailable.');
        if (path.posix.basename(file) === '_dir.yml') parseFolderConfig((await this.readFile(source.path)).toString('utf8'), path.posix.basename(path.posix.dirname(file)), file);
      }
    }
    if (bytes > 5 * 1024 * 1024) throw new SourceError('Mutation exceeds the 5 MiB limit.', 413);
    const changedPaths = changes.map(c => c.path).sort();
    const summary = changedPaths.length === 1 ? path.posix.basename(changedPaths[0]) : `${changedPaths.length} files`;
    const author = this.checkedAuthor();
    const message = withCoAuthors(requestedMessage || `docs(${scope}): ${operation.replace(/[^a-z-]/g, '')} ${summary.replace(/[\r\n]/g, ' ')}`, coAuthors, author);
    let revision: string;
    try {
      revision = await this.publishChanges(changes, snapshot, message, author);
      this.announceCommit(changedPaths);
      try {
        this.commitHeard?.(changes, { revision });
      } catch {
        console.warn("[remote-source] the reader's commit listener failed");
      }
    } finally {
      this.invalidate();
      this.snapshot = undefined;
      this.fresh = false;
    }
    return { success: true, committed: true, pushed: true, repository: this.repository, branch: this.branch, revision: revision, changedPaths, commit: { commitHash: revision, message } };
  }
}
