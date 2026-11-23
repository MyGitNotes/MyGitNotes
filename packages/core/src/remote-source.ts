import { NewerVersionError } from './newer-version-error.js';
import { STUDY_FILE } from './study.js';
import { BookmarkError } from './bookmark-error.js';
import { managedNotebook, retitleNoteFile } from './file-manager.js';
import { relocateLinks } from './folder-plan.js';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { assetInfo, assetPath, assetRoot, decodeAsset, isAssetPath } from './assets.js';
import { MANIFEST_FILES } from './remote-manifest.js';
import { type RepositoryId, type RepositoryScope, StaleRevisionError } from './repository.js';
import { parseNoteContent } from './frontmatter.js';
import { isCompilationPath } from './compilation.js';
import { isOutlinePath } from './outline.js';
import { isNoteFile, NOTE_EXTENSIONS, parseNoteFile, serializeNoteFile } from './note-file.js';
import { describeNoteTemplate, formatTemplateDate, formatTemplateTime, isTemplateFile, lastUseOf, type ListedNoteTemplate, notebookTemplateEntries, type NoteTemplateEntry, type NoteTemplateInfo, type RenderedNoteTemplate, renderNoteTemplate, templateFileId, templateLastUse, TEMPLATES_FOLDER, templateValues } from './templates.js';
import { isNotebookContent, parseFolderConfig, sortFolders } from './folders.js';
import { FolderItem, NotebookConfig, NoteItem, NoteMetadata, WorkspaceConfig } from './types.js';
import { SourceError } from './github-api.js';
import { agentFileAllowed, agentWorkspaceFile } from './agent-workspace.js';
import { agentSkillLocation, renameAgentSkillEntryContent, renamedAgentSkillPath, rewriteAgentSkillReferences } from './agent-skill-metadata.js';
import { skillFile } from './agent-system.js';
import { type CommitScope, readWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument, workspaceDocument, writeWorkspaceDocument } from './workspace-documents.js';
import { gitBlobId, hashJson, REMOTE_CACHE_BATCH_BYTES, REMOTE_CACHE_MAX_VALUE, REMOTE_CACHE_TTL, type RemoteCache } from './remote-cache.js';
import type { RepositoryCatalog } from './note-catalog.js';
import type { NoteListItem } from './note-query.js';
import { addVersion, agentEditMessage, type HistoryEntry, isAgentEdit, readVersionFile, serializeVersionFile, versionedPath, versionFilePath, type VersionLabel } from './note-versions.js';
import { CASE_COLLISION_ERROR, differsOnlyInCase } from './case-collision.js';
import { type CommitAuthor, commitAuthor, withCoAuthors } from './commit-author.js';
import { CheckedOutError, isLiveNotePath, LIVE_MAX_BYTES, liveContentHash, LiveNotLiveError, LiveStaleError, LiveTooLargeError, normalizeLiveText, parseLivePendingPath } from './live-notes.js';
import type { LiveCheckInResult } from './live-checkin.js';
import { editedLiveError, type LiveLink, liveNoteState, type LiveRecord, type LiveRepository, parseLiveBase } from './live-repository.js';
import { notebookOfPath } from './workspace-links.js';
import { type CommitRenames, type LastCommit, RemoteEditDates } from './remote-edit-dates.js';
import { type EditDated, type NoteEditFact, withEditDate } from './edit-dates.js';

export { SourceError } from './github-api.js';
const CACHEABLE_FILE = /\.(md|markdown|mdx|txt|ya?ml)$/i;
const INDEX_VERSION = 'v4';
/** The shape of a cached template list; a change of `NoteTemplateInfo` or of how a template is described raises it. */
const TEMPLATES_VERSION = 'v1';
/** Blobs kept in memory for one request. */
const LOADED_MAX_BYTES = 64 * 1024 * 1024;
export interface RemoteEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
export interface RepositoryInfo {
  private: boolean;
  permissions?: { push?: boolean; };
  default_branch: string;
}
export interface RemoteSnapshot {
  sha: string;
  treeSha: string;
  entries: RemoteEntry[];
  info: RepositoryInfo;
}
export type RemoteChange = { path: string; content?: string; base64?: string; sha?: string | null; };
/**
 * A live note a relocation could not wholly take along ({@link RemoteSource.followLiveRelocation}): by the path reads
 * know it by, where it was to go, and why, in words. `linksBroken`: its own links to the relocated files still lead to
 * where those were. `moved`: it goes to `destination` all the same; without it, it stays where it lies.
 */
export interface LiveRelocationLeft {
  path: string;
  destination?: string;
  reason: string;
  linksBroken?: true;
  moved?: true;
}

/**
 * What a move of a filed live note answers (docs/specs/2026-11-15-builtin-live-editor §20.4): its Git path now, where its
 * next check-in moves it (null: nowhere, as it lies there or the move was taken back), and the check-in it got at once
 * when nobody else edits it, with the head that check-in left.
 */
export interface LiveMoveResult {
  path: string;
  target: string | null;
  checkIn?: LiveCheckInResult & { revision: string; };
}
/** What a reader's commit listener hears beside the changes ({@link RemoteSource.onCommit}). */
export interface RemoteCommitHeard {
  /** The commit's id. */
  revision: string;
}
/** A commit as a provider lists it in a file's history. */
export interface RemoteCommit {
  sha: string;
  parents: string[];
  date: string;
  author: string;
  message: string;
}
/** A file's content in a past commit, or why it is not shown. */
export type HistoryRead = { blob: string; content: string; } | { blob: string; notice: 'binary' | 'too-large'; };
/** History reads show at most this much of a file. */
const HISTORY_MAX_BYTES = 1024 * 1024;
/** How many renames or moves a file's history follows back, each costing the provider a few more requests. */
const MAX_FOLLOWED_RENAMES = 50;
/** The shape of a remembered history fact; a change of `HistorySpan` or of what a fact means raises it. */
const HISTORY_FACTS_VERSION = 'v1';
/** How many history facts a process remembers per backend, the least recently used going first. */
const HISTORY_MEMO_ENTRIES = 10_000;
/** History facts this process remembers, by the backend its readers share (see `historyMemoOwner`). */
const historyMemos = new WeakMap<object, Map<string, string>>();
/** A path's commits from a head, once listed to the end: how many, the oldest, and that one's first parent ('' for none). */
interface HistorySpan {
  count: number;
  oldest: string;
  parent: string;
}
const OBJECT_ID = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
/** Shared-cache keys of live texts, each value the text whose sha256 the key ends with. */
const LIVE_TEXT_VERSION = 'v1';
/**
 * Adapter reads of one live link in flight in this process, by repository, link id and listed hash, so concurrent
 * misses read it once. A read is shared only with requests that listed the same link: two links with equal text never
 * share one, since either may change after it was listed.
 */
const liveReadsInFlight = new Map<string, Promise<{ content: string; contentHash: string; }>>();

/** Hears of every commit this process publishes to a remote repository: its identity, as `RemoteSource.id`, and the changed paths. */
export type RemoteCommitListener = (repository: RepositoryId, paths: string[]) => void;
const commitListeners = new Set<RemoteCommitListener>();

/** Subscribes to the commits this process publishes, so open pages can read history again; returns the unsubscribe. */
export function onRemoteCommit(listener: RemoteCommitListener): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

/** Shared workspace rules, independent of the Git hosting provider. */
/** A working note to write in `commitNotes`. */
export interface CommitNoteWrite {
  path: string;
  content: string;
  metadata: NoteMetadata;
  createOnly?: boolean;
  delete?: false;
}
/** A working note's deletion in `commitNotes`. */
export interface CommitNoteDeletion {
  path: string;
  delete: true;
}
export type CommitNoteChange = CommitNoteWrite | CommitNoteDeletion;

export abstract class RemoteSource {
  private snapshot?: Promise<RemoteSnapshot>;
  protected fresh = false;
  /** Blobs loaded from the shared cache or verified platform reads, by sha. */
  private loaded = new Map<string, Buffer>();
  private loadedBytes = 0;
  private cacheChecked = new Set<string>();
  /** The request's view of the repository's live editor; none for a signed-out request or a repository no editor covers. */
  private live?: LiveRepository;
  /** Live texts this request read, by path (real or virtual). */
  private liveLoaded = new Map<string, { content: string; contentHash: string; }>();
  /** The revision and hash this request last read or wrote of each live note, by path. */
  private liveSeen = new Map<string, LiveRecord>();
  /** Whom this reader tells of each commit `commitChanges` makes ({@link onCommit}). */
  private commitHeard?: (changes: readonly RemoteChange[], commit: RemoteCommitHeard) => void;
  /**
   * `scope` supplies the notebooks this repository serves; the workspace manifest is never read from here. `commitsAs` is
   * who the commits this source publishes are authored by, for a deployment whose `token` is not the person's own;
   * without one a commit's author is the token's account, as the provider has it.
   */
  constructor(public repository: string, public branch: string, protected token: string | undefined, protected cache: RemoteCache | undefined, private readonly scope: RepositoryScope, private readonly commitsAs?: CommitAuthor) {}
  /** The repository's identity within a workspace, as `sourceIdentity` spells it. */
  abstract get id(): RepositoryId;
  protected abstract loadSnapshot(): Promise<RemoteSnapshot>;
  protected abstract readBlob(sha: string): Promise<Buffer>;
  /** Publishes one commit and returns its id. `author` is the source's, already checked; a provider that cannot set a commit's author leaves it out. */
  protected abstract publishChanges(changes: RemoteChange[], snapshot: RemoteSnapshot, message: string, author?: CommitAuthor): Promise<string>;
  /**
   * The author of the commits this source publishes. It is checked when a commit is made, before a provider hears of
   * it, and not when the source opens: a person whose author cannot be written into a commit still reads.
   */
  private checkedAuthor(): CommitAuthor | undefined {
    return commitAuthor(this.commitsAs);
  }
  protected invalidate() {}
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
   * Hands the request's view of the live editor to this reader: from then on every read of a checked-out note by path
   * answers its live text, and Git writes that touch one are refused (docs/specs/2026-11-15-live-notes/spec.md §3, §4).
   */
  useLive(view: LiveRepository) {
    this.live = view;
  }
  /** The request's view of the repository's live editor, which routes reach the editor through; none when no editor is in use. */
  get liveView(): LiveRepository | undefined {
    return this.live;
  }
  /**
   * 「立即簽回」: checks the live note at `file` into Git now and closes it, or says why it stayed open. Any writer may;
   * the person who asks authors the commit, and the note's other editors are its co-authors.
   */
  async checkInLive(file: string) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLinkAt(file);
    if (!link) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    return this.checkInLink(link, 'manual');
  }
  /** Checks a link in; the check-in may have moved the head, and closed, filed or moved the note, so this request reads them again. */
  private async checkInLink(link: LiveLink, mode: 'manual' | 'scheduled') {
    const result = await this.live!.checkIn(link.path, mode);
    for (const file of [link.path, link.checkout.path, result.path]) {
      if (!file) continue;
      this.liveLoaded.delete(file);
      this.liveSeen.delete(file);
    }
    this.snapshot = undefined;
    return { ...result, revision: (await this.getSnapshot(true)).sha };
  }
  /**
   * 「捨棄草稿」: drops the pending note at its virtual path `file` without a commit (docs/specs/2026-11-15-builtin-live-editor
   * §19), or says why it is kept; a draft someone typed content in needs `confirm`. Any writer may.
   */
  async discardLive(file: string, confirm: boolean) {
    if (!this.canWrite(await this.getSnapshot())) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    if (!link) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    try {
      return await this.live!.discard(link.path, confirm);
    } finally {
      this.liveLoaded.delete(link.path);
      this.liveSeen.delete(link.path);
    }
  }
  /**
   * Moves or renames the filed live note (編輯中) at `file` (as reads know it, or its Git path while it moves) to
   * `destination` (docs/specs/2026-11-15-builtin-live-editor §20.4): any writer may, whoever edits it. Nothing is
   * committed: the note's next check-in moves it there, in one commit with the links to it rewritten, and until then it
   * is read at `destination`. A destination where it lies already takes the move back. When nobody but the mover has it
   * open, idle or not (where the adapter cannot tell, nobody but the mover is active: `editing`, the mover has it open),
   * it is checked in at once, so the move lands now. `title` retitles its live text as a rename does. A destination Git
   * holds, or another live note holds or goes to, is refused (409); where the live editor cannot retarget, the move is
   * refused as 編輯中, as before.
   */
  async moveLive(file: string, destination: string, options: { title?: string; editing?: boolean; checkIn?: boolean; } = {}): Promise<LiveMoveResult> {
    const snapshot = await this.getSnapshot(true);
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLinkAt(file);
    if (!link || link.checkout.path === null) throw new LiveNotLiveError('This note is not being edited live (編輯中).');
    if (!this.live!.retargets) throw new CheckedOutError([file]);
    const from = link.checkout.path, root = link.notebook.root;
    const relative = typeof destination === 'string' && destination.startsWith(`${root}/`) ? destination.slice(root.length + 1) : '';
    if (!relative || !isLiveNotePath(relative, link.notebook) || templateFileId(relative) !== undefined || (link.notebook.templates ?? []).some(template => template.file === relative) || /[\\\p{Cc}]/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new SourceError('Choose a note path in the same notebook.', 400);
    if (destination !== from) {
      const existing = snapshot.entries.map(entry => entry.path);
      if (existing.includes(destination) || existing.some(entry => entry.startsWith(`${destination}/`))) throw new SourceError('Destination already exists.', 409);
      if (differsOnlyInCase(existing, destination, entry => entry === from)) throw new SourceError(CASE_COLLISION_ERROR, 409);
      const others = (await this.live!.links()).filter(other => other.checkout.id !== link.checkout.id);
      if (others.some(other => other.path === destination || other.checkout.path === destination)) throw new SourceError('Destination already exists.', 409);
    }
    if (options.title !== undefined) {
      // A rename retitles the live text as it would a file: written on the text just read, over typing since. The title is
      // checked and written on that one read before anything moves, so a block that cannot be read refuses the rename
      // (`retitleNoteFile` throws) with the note where it was, however its text changed since the checks above (FM-F004).
      const read = await this.live!.read(link.checkout.id);
      const retitled = normalizeLiveText(retitleNoteFile(read.content, destination, options.title));
      if (retitled !== read.content) await this.live!.write(link.checkout.id, retitled, read.liveRevision, false);
    }
    const target = destination === from ? null : destination;
    let checkout = target === (link.checkout.target ?? null) ? link.checkout : await this.live!.move(link.path, target);
    for (const path of [link.path, from, destination]) {
      this.liveLoaded.delete(path);
      this.liveSeen.delete(path);
    }
    // Nobody else has it open: it is checked in now, which moves it. The adapter tells who besides the mover is connected,
    // idle or not; one that cannot is judged by who is active, the mover among them when they edit it.
    const changed = target !== (link.checkout.target ?? null) || options.title !== undefined;
    const alone = async () => {
      const others = await this.live!.othersEditing(checkout.id);
      return others !== null ? others === 0 : checkout.activeEditors - (options.editing ? 1 : 0) <= 0;
    };
    if (changed && options.checkIn !== false && await alone()) {
      const moved = (await this.live!.links()).find(entry => entry.checkout.id === checkout.id);
      if (moved) {
        const checkIn = await this.checkInLink(moved, 'scheduled');
        const path = checkIn.path ?? destination;
        const left = (await this.live!.links()).find(entry => entry.checkout.id === checkout.id)?.checkout;
        if (left) checkout = left;
        return { path: left?.path ?? path, target: left?.target ?? null, checkIn };
      }
    }
    return { path: from, target: checkout.target ?? null };
  }
  /**
   * The live notes (編輯中) a Git relocation moves, as `relocate` maps a path (itself when it stays): each filed note,
   * by the path reads know it by, with where it goes. A note already moving elsewhere follows its target. A relocation
   * commits none of them: their Git files stay where they lie (`kept`, the planner's `stays`), so the links to them keep
   * naming them there until each check-in moves it and rewrites those links, and once the commit landed
   * {@link followLiveRelocation} takes them along. Throws a {@link CheckedOutError} for them where the live editor cannot
   * retarget, as before, and a 409 for a destination another live note holds or goes to.
   */
  async liveRelocations(relocate: (file: string) => string): Promise<{ moves: { file: string; destination: string; }[]; kept: Set<string>; }> {
    if (!this.live) return { moves: [], kept: new Set() };
    const links = (await this.live.links()).filter(link => link.checkout.path !== null);
    const moving = links.filter(link => relocate(link.path) !== link.path || relocate(link.checkout.path!) !== link.checkout.path);
    if (!moving.length) return { moves: [], kept: new Set() };
    if (!this.live.retargets) throw new CheckedOutError(moving.map(link => link.checkout.path!));
    const moves = moving.filter(link => relocate(link.path) !== link.path).map(link => ({ file: link.path, destination: relocate(link.path) }));
    const held = new Set(links.filter(link => !moving.includes(link)).flatMap(link => [link.path, link.checkout.path!]));
    const going = new Set<string>();
    for (const { destination } of moves) {
      if (held.has(destination) || going.has(destination)) throw new SourceError('Destination already exists.', 409);
      going.add(destination);
    }
    return { moves, kept: new Set(moving.map(link => link.checkout.path!)) };
  }
  /**
   * Takes the live notes of {@link liveRelocations} along once the relocation's commit landed: each kept note's own links
   * to the files the commit relocated (`relocate`) are rewritten in its live text from where it lies, so they hold there
   * and at its check-in (LM-F002), tried again once on a fresh read when typing or the editor refuses the write; then
   * each of `moves` records where it goes, without a check-in. A note either step fails for is answered in `left` with
   * why, for the caller to say, and the commit stands either way (LM-F003): `linksBroken` when its links to the relocated
   * files still lead where those were, and `moved` when it goes to its destination all the same; without `moved` it
   * stays where it lies, where the links to it lead.
   */
  async followLiveRelocation({ moves, kept }: Awaited<ReturnType<RemoteSource['liveRelocations']>>, relocate: (file: string) => string): Promise<{ moved: { file: string; destination: string; }[]; left: LiveRelocationLeft[]; }> {
    const moved: { file: string; destination: string; }[] = [], left: LiveRelocationLeft[] = [];
    if (!this.live || !kept.size) return { moved, left };
    const live = this.live;
    const relink = (file: string) => kept.has(file) ? file : relocate(file);
    const why = (error: unknown) => error instanceof Error ? error.message : 'The live note could not be taken along.';
    const links = (await live.links()).filter(link => link.checkout.path !== null && kept.has(link.checkout.path));
    for (const link of links) {
      const from = link.checkout.path!;
      const destination = moves.find(entry => entry.file === link.path)?.destination;
      const relinkOnce = async () => {
        const read = await live.read(link.checkout.id);
        const relinked = normalizeLiveText(relocateLinks(read.content, from, from, relink));
        if (relinked !== read.content) await live.write(link.checkout.id, relinked, read.liveRevision, false);
      };
      let linksBroken: string | undefined, stays: string | undefined;
      try {
        await relinkOnce().catch(relinkOnce);
      } catch (error) {
        linksBroken = why(error);
        console.warn(`[live-notes] ${link.checkout.id} keeps its links to the notes a relocation moved from ${from}: ${(error as Error)?.name ?? 'error'}`);
      }
      this.liveLoaded.delete(link.path);
      if (destination !== undefined) {
        try {
          await this.moveLive(link.path, destination, { checkIn: false });
          moved.push({ file: link.path, destination });
        } catch (error) {
          stays = why(error);
          console.warn(`[live-notes] ${link.checkout.id} stays at ${from} after a relocation: ${(error as Error)?.name ?? 'error'}`);
        }
      }
      if (linksBroken === undefined && stays === undefined) continue;
      const reasons = [...(stays !== undefined ? [`It stays where it is: ${stays}`] : []), ...(linksBroken !== undefined ? [`Its links to the notes moved still lead where they were: ${linksBroken}`] : [])];
      left.push({ path: link.path, ...(destination !== undefined ? { destination } : {}), reason: reasons.join(' '), ...(linksBroken !== undefined ? { linksBroken: true as const } : {}), ...(destination !== undefined && stays === undefined ? { moved: true as const } : {}) });
    }
    return { moved, left };
  }
  /**
   * Where a pending note's virtual path went once it was checked in: its Git path, or null when the editor does not
   * know. Undefined for any other path, and for a pending note that is still live.
   */
  async liveFiled(file: string): Promise<string | null | undefined> {
    if (!this.live || typeof file !== 'string') return undefined;
    // A filed note moving elsewhere (§20.4) is read at its target: its Git path leads there until its check-in.
    const at = await this.liveAt(file);
    if (at && 'link' in at) return at.link.path !== file ? at.link.path : undefined;
    // A path a note left while live leads where it went once it is no longer live, as long as Git holds that.
    if (at) return at.left;
    const pending = parseLivePendingPath(file, (await this.config()).notebooks);
    if (!pending) return undefined;
    return this.live.filed(pending.id);
  }
  /** The live link of a path: a checked-out note's or a pending note's virtual path; undefined without one. */
  private async liveLink(file: string): Promise<LiveLink | undefined> {
    if (!this.live || typeof file !== 'string' || !/\.(md|markdown)$/i.test(file)) return undefined;
    return (await this.live.links()).find(link => link.path === file);
  }
  /**
   * The live link at `file` as reads know it, or at the Git path of a note moving elsewhere; else the one that was read
   * at `file` earlier while live (its `formerPaths`: a target a later move replaced, or the path a check-in moved it
   * from), so a tab, address or open editor still there finds it, unless Git holds a file at `file` now, which is that
   * file's. Undefined without one.
   */
  private async liveLinkAt(file: string): Promise<LiveLink | undefined> {
    const at = await this.liveAt(file);
    return at && 'link' in at ? at.link : undefined;
  }
  /**
   * The live link at `file`, as {@link liveLinkAt} finds it; or, for a path a note left that is no longer live, where it
   * went (`left`): the path it was filed at, a note of the same notebook that Git holds. When several notes left
   * `file`, the one that left it last counts (the adapter's `leftFrom`); an adapter that cannot tell is asked only for
   * its live links' former paths, and a path two of them left leads nowhere. Undefined without one.
   */
  private async liveAt(file: string): Promise<{ link: LiveLink; } | { left: string; } | undefined> {
    if (!this.live || typeof file !== 'string' || !/\.(md|markdown)$/i.test(file)) return undefined;
    const links = await this.live.links();
    const at = links.find(link => link.path === file) ?? links.find(link => link.checkout.target !== undefined && link.checkout.path === file);
    if (at) return { link: at };
    const snapshot = await this.getSnapshot();
    const holds = (path: string) => snapshot.entries.some(entry => entry.path === path);
    if (holds(file)) {
      await this.forgetLeft(file, links, holds);
      return undefined;
    }
    const id = await this.live.leftFrom(file);
    if (id === undefined) {
      const listed = links.filter(link => link.checkout.formerPaths?.includes(file));
      return listed.length === 1 ? { link: listed[0] } : undefined;
    }
    if (id === null) return undefined;
    const link = links.find(entry => entry.checkout.id === id);
    if (link) return { link };
    const filed = await this.live.filed(id);
    const notebook = notebookOfPath(file, (await this.config()).notebooks);
    return filed !== null && filed !== file && notebook && notebookOfPath(filed, (await this.config()).notebooks)?.id === notebook.id && holds(filed) ? { left: filed } : undefined;
  }
  /**
   * A file Git holds at `file`, a path a note left, is that file's: the path stops leading to the note for good, so it
   * does not lead there again once the file is deleted or moved away (FLM-F004). Forgotten only while Git also holds the
   * note where it went, live at its Git path or filed: a snapshot read before the note's move holds its old file there.
   */
  private async forgetLeft(file: string, links: readonly LiveLink[], holds: (path: string) => boolean) {
    const id = await this.live!.leftFrom(file);
    if (!id) return;
    const where = links.find(entry => entry.checkout.id === id)?.checkout.path ?? await this.live!.filed(id);
    if (where && where !== file && holds(where)) await this.live!.forgetLeft(file, id);
  }
  /**
   * The live link of a checked-out note or pending note at `file`, also by the Git path of a note moving elsewhere;
   * undefined when it is not live or no editor is in use.
   */
  async liveCheckout(file: string) {
    return (await this.liveLinkAt(file))?.checkout;
  }
  /** The path reads know the live note at `file` by: a moving note's target for its Git path, else `file`; undefined when it is not live. */
  async livePath(file: string) {
    return (await this.liveLinkAt(file))?.path;
  }
  /** What this request last read or wrote of the live note at `file`. */
  liveRecord(file: string): LiveRecord | undefined {
    return this.liveSeen.get(file);
  }
  private liveTextKey(hash: string) {
    return `mgn:live:${LIVE_TEXT_VERSION}:${this.cacheRepository()}:${hash}`;
  }
  /** Keeps live texts in the shared cache, each under its own hash. */
  private async storeLiveTexts(texts: { content: string; contentHash: string; }[]) {
    if (!this.cache) return;
    const values = texts.filter(text => liveContentHash(text.content) === text.contentHash && Buffer.byteLength(text.content) <= REMOTE_CACHE_MAX_VALUE).map(text => [this.liveTextKey(text.contentHash), text.content] as [string, string]);
    if (values.length) await this.cache.set(values, REMOTE_CACHE_TTL);
  }
  /** The live text of a link, fresh from the adapter, kept for this request and in the shared cache. */
  private async readLiveLink(link: LiveLink) {
    const text = await this.live!.read(link.checkout.id);
    this.liveLoaded.set(link.path, text);
    this.liveSeen.set(link.path, { id: link.checkout.id, liveRevision: text.liveRevision, contentHash: text.contentHash });
    await this.storeLiveTexts([text]);
    return text;
  }
  /** The live text of a link: as this request already read it, else fresh. */
  private async liveTextOf(link: LiveLink) {
    return this.liveLoaded.get(link.path) ?? this.readLiveLink(link);
  }
  /** The live note at `file`, read fresh from the adapter; undefined when it is not live. */
  async readLive(file: string) {
    const link = await this.liveLink(file);
    return link ? this.readLiveLink(link) : undefined;
  }
  /**
   * Loads the live texts of links for a bulk read: from the shared cache by each link's hash, checked against it, and
   * from the adapter only for a text no one has read since it last changed.
   */
  private async loadLiveTexts(links: LiveLink[]) {
    const missing = links.filter(link => !this.liveLoaded.has(link.path));
    if (!missing.length) return;
    const hits = this.cache ? await this.cache.get(missing.map(link => this.liveTextKey(link.checkout.contentHash))) : missing.map(() => null);
    const unread: LiveLink[] = [];
    missing.forEach((link, i) => {
      const hit = hits[i];
      // A live text is trusted only when it hashes to the key this request's own list of links named.
      if (hit !== null && liveContentHash(hit) === link.checkout.contentHash) this.liveLoaded.set(link.path, { content: hit, contentHash: link.checkout.contentHash });
      else unread.push(link);
    });
    for (let i = 0; i < unread.length; i += 6) {
      await Promise.all(
        unread.slice(i, i + 6).map(async link => {
          const key = `${this.liveTextKey(link.checkout.contentHash)}:${link.checkout.id}`;
          let pending = liveReadsInFlight.get(key);
          if (!pending) {
            pending = this.live!.read(link.checkout.id).then(async text => {
              await this.storeLiveTexts([text]);
              return { content: text.content, contentHash: text.contentHash };
            });
            liveReadsInFlight.set(key, pending);
            void pending.then(() => liveReadsInFlight.delete(key), () => liveReadsInFlight.delete(key));
          }
          this.liveLoaded.set(link.path, await pending);
        }),
      );
    }
  }
  /** Loads the live texts of those of `files` that are live, for a bulk read that then reads each by path. */
  async prefetchLive(files: string[]) {
    if (!this.live) return;
    const wanted = new Set(files);
    await this.loadLiveTexts((await this.live.links()).filter(link => wanted.has(link.path)));
  }
  /** The live links of one notebook. */
  private async notebookLinks(nb: NotebookConfig): Promise<LiveLink[]> {
    return this.live ? (await this.live.links()).filter(link => link.notebook.id === nb.id) : [];
  }
  /**
   * Refuses, with the checked-out paths, a Git write that would touch a checked-out note or a pending note's virtual
   * path. It is a guard before any commit; the merge at check-in resolves a Git change that races a checkout. Only a
   * note can be live, so a write that touches none asks the editor nothing and goes ahead while it is down.
   */
  async refuseCheckedOut(paths: readonly string[], refusal?: (touched: string[]) => CheckedOutError) {
    if (!this.live || !paths.some(file => /\.(md|markdown)$/i.test(file))) return;
    // A note moving elsewhere holds both its Git path and its target until its check-in moves it.
    const live = new Set((await this.live.links()).flatMap(link => link.checkout.path !== null && link.checkout.path !== link.path ? [link.path, link.checkout.path] : [link.path]));
    const touched = [...new Set(paths.filter(file => live.has(file)))].sort();
    if (touched.length) throw refusal?.(touched) ?? new CheckedOutError(touched);
  }
  /**
   * Writes a whole note text into the live editor on the base a read returned (`live:` revisions, never shown to a
   * caller): the editor rebases it over typing since. The receipt says nothing was committed.
   */
  async writeLive(file: string, content: string, base: LiveRecord, agent: boolean) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    // A note released or checked out again since the read: the caller reads it again.
    if (!link || link.checkout.id !== base.id) throw new LiveStaleError();
    const text = normalizeLiveText(content);
    if (Buffer.byteLength(text) > LIVE_MAX_BYTES) throw new LiveTooLargeError();
    const { liveRevision } = await this.live!.write(link.checkout.id, text, base.liveRevision, agent);
    // The editor may have rebased the text over typing since, so later reads in this request read it again.
    this.liveLoaded.delete(link.path);
    this.liveSeen.set(link.path, { id: link.checkout.id, liveRevision, contentHash: liveContentHash(text) });
    return { success: true as const, committed: false as const, pushed: false as const, live: true as const, liveRevision, repository: this.repository, branch: this.branch, revision: snapshot.sha, changedPaths: [file] };
  }
  /** Appends text to a checked-out note in the live editor; never stale, since nothing is replaced. */
  async appendLive(file: string, content: string, agent: boolean) {
    const snapshot = await this.getSnapshot();
    if (!this.canWrite(snapshot)) throw new SourceError('Write access on the main workspace branch is required.', 403);
    const link = await this.liveLink(file);
    if (!link) throw new LiveStaleError();
    if (Buffer.byteLength(content) > LIVE_MAX_BYTES) throw new LiveTooLargeError();
    const { liveRevision } = await this.live!.append(link.checkout.id, content, agent);
    this.liveLoaded.delete(link.path);
    return { success: true as const, committed: false as const, pushed: false as const, live: true as const, liveRevision, repository: this.repository, branch: this.branch, revision: snapshot.sha, changedPaths: [file] };
  }

  /** Loads cached blobs for the given files; providers extend this with batched platform reads. */
  async prefetchFiles(files: string[]): Promise<void> {
    const { entries } = await this.getSnapshot();
    const wanted = new Set(files);
    await this.loadCached(entries.filter(entry => wanted.has(entry.path) && entry.type === 'blob' && entry.mode !== '120000'));
  }

  /** What shared-cache keys call this repository; a source on a named site adds the site, so one name on two sites never shares an entry, and an edition source is keyed `edition:<platform>:<repository>`. */
  protected cacheRepository(): string {
    // An edition source is namespaced by its platform here, in the base, so no edition adapter can collide with a provider repository of the same name.
    const id: string = this.id;
    if (id.startsWith('edition:') && id.endsWith(`@${this.branch}`)) return id.slice(0, -(this.branch.length + 1)).toLowerCase();
    return this.repository.toLowerCase();
  }
  private blobKey(sha: string) {
    return `mgn:blob:v1:${this.cacheRepository()}:${sha}`;
  }
  protected cacheable(entry: RemoteEntry) {
    return Boolean(this.cache) && CACHEABLE_FILE.test(entry.path) && (entry.size === undefined || entry.size * 4 / 3 <= REMOTE_CACHE_MAX_VALUE);
  }

  /** Keeps this request's blobs available while bounding its memory. */
  private remember(sha: string, bytes: Buffer) {
    this.loaded.set(sha, bytes);
    this.loadedBytes += bytes.length;
    while (this.loadedBytes > LOADED_MAX_BYTES && this.loaded.size > 1) {
      const oldest = this.loaded.keys().next().value!;
      if (oldest === sha) break;
      this.loadedBytes -= this.loaded.get(oldest)!.length;
      this.loaded.delete(oldest);
    }
  }

  /** Fills loaded blobs from the shared cache. Only entries of this reader's authorized tree are looked up. Returns entries still missing. */
  protected async loadCached(entries: RemoteEntry[]): Promise<RemoteEntry[]> {
    const pending = [...new Map(entries.filter(entry => !this.loaded.has(entry.sha) && this.cacheable(entry) && !this.cacheChecked.has(entry.sha)).map(entry => [entry.sha, entry])).values()];
    let batch: RemoteEntry[] = [], bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const hits = await this.cache!.get(batch.map(entry => this.blobKey(entry.sha)));
      batch.forEach((entry, i) => {
        this.cacheChecked.add(entry.sha);
        if (hits[i] === null) return;
        // Content addressing is the authorization rule for this cache, so a value is only trusted when it hashes to its key.
        const bytes = Buffer.from(hits[i]!, 'base64');
        if (gitBlobId(bytes, entry.sha.length) === entry.sha) this.remember(entry.sha, bytes);
      });
      batch = [];
      bytes = 0;
    };
    for (const entry of pending) {
      const size = (entry.size ?? 64 * 1024) * 4 / 3;
      if (batch.length && bytes + size > REMOTE_CACHE_BATCH_BYTES) await flush();
      batch.push(entry);
      bytes += size;
    }
    await flush();
    return entries.filter(entry => !this.loaded.has(entry.sha));
  }

  /** Stores verified platform reads in the shared cache. */
  protected async storeCached(blobs: [RemoteEntry, Buffer][]) {
    const verified = blobs.filter(([entry, bytes]) => gitBlobId(bytes, entry.sha.length) === entry.sha);
    for (const [entry, bytes] of verified) this.remember(entry.sha, bytes);
    const values = verified.filter(([entry]) => this.cacheable(entry)).map(([entry, bytes]) => [this.blobKey(entry.sha), bytes.toString('base64')] as [string, string]).filter(([, value]) => Buffer.byteLength(value) <= REMOTE_CACHE_MAX_VALUE);
    if (values.length) await this.cache!.set(values, REMOTE_CACHE_TTL);
  }
  async getSnapshot(fresh = false): Promise<RemoteSnapshot> {
    if (fresh) {
      this.snapshot = undefined;
      this.fresh = true;
    }
    this.snapshot ??= this.loadSnapshot();
    return this.snapshot;
  }
  /** Whether this reader holds the credential a write needs; an edition adapter overrides it for a signed-in person without a token. */
  protected mayWrite(): boolean {
    return Boolean(this.token);
  }
  /** Whether this reader's credential may commit to the main workspace branch as of `snapshot`. */
  canWrite(snapshot: RemoteSnapshot) {
    return Boolean(this.mayWrite() && snapshot.info.permissions?.push && this.branch === 'main');
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
  /** One page of the commits on the branch head that changed `file`, newest first; a provider lists them by path. */
  protected historyPage(_file: string, _head: string, _page: number, _perPage: number): Promise<{ commits: RemoteCommit[]; more: boolean; }> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The object id and size of `file` in `commit`, or null when that commit does not hold it. */
  protected objectAt(_commit: string, _file: string): Promise<{ sha: string; size: number; } | null> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The author date of `commit` and the paths it changed, renamed paths under their new names; null for an unknown commit. */
  protected commitInfo(_commit: string): Promise<{ date: string; paths: string[]; } | null> {
    throw new SourceError('History is unavailable for this source.', 501);
  }
  /** The path `commit` renamed or moved to `file`, as the provider detects renames; null when it added `file` otherwise. */
  protected renamedFrom(_commit: string, _file: string): Promise<string | null> {
    return Promise.resolve(null);
  }
  /** The newest commit from `head` that changed each of `paths`; a provider may batch them, the default asks per path. */
  protected async lastCommits(head: string, paths: string[]): Promise<Map<string, LastCommit | null>> {
    const found = new Map<string, LastCommit | null>();
    for (let i = 0; i < paths.length; i += 6) {
      await Promise.all(paths.slice(i, i + 6).map(async file => {
        const [commit] = (await this.historyPage(file, head, 1, 1)).commits;
        found.set(file, commit ? { sha: commit.sha, date: commit.date } : null);
      }));
    }
    return found;
  }
  /** The renames `commit` made that kept the text, with its first parent; by default none are known, so a move dates a note. */
  protected async pureRenames(_commit: string): Promise<CommitRenames> {
    return { parent: null, renames: new Map() };
  }
  private editDating?: RemoteEditDates;
  /**
   * What Git tells of the edit dates of `files` as reads know them (`edit-dates.ts`), by path. A checked-out note is
   * dated by its Git file, with the live editor's typing as uncommitted changes; a pending note has no Git date.
   */
  async editFacts(files: string[]): Promise<Map<string, NoteEditFact>> {
    const snapshot = await this.getSnapshot();
    const links = new Map((this.live ? await this.live.links() : []).map(link => [link.path, link]));
    const blobs = new Map(snapshot.entries.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
    const wanted = files.flatMap(file => {
      const link = links.get(file), path = link ? link.checkout.path : file, blob = path === null ? undefined : blobs.get(path);
      return blob ? [{ file, path: path!, blob, uncommitted: Boolean(link && liveNoteState(link.checkout).changed) }] : [];
    });
    this.editDating ??= new RemoteEditDates(this.id, { lastCommits: (head, paths) => this.lastCommits(head, paths), pureRenames: commit => this.pureRenames(commit) }, this.cache, this.historyMemoOwner() ?? this);
    const dates = await this.editDating.dates(snapshot.sha, wanted);
    return new Map(wanted.flatMap(({ file, path, uncommitted }) => dates.has(path) ? [[file, { lastCommitAt: dates.get(path), ...(uncommitted ? { uncommitted } : {}) }]] : []));
  }
  /** The notes with their edit dates resolved (`withEditDate`), as reads answer them. */
  async dated<T extends { path: string; metadata: Record<string, unknown>; }>(notes: T[]): Promise<(Omit<T, keyof EditDated> & EditDated)[]> {
    const facts = await this.editFacts(notes.map(note => note.path));
    return notes.map(note => withEditDate(note, facts.get(note.path)));
  }
  /**
   * The backend whose readers share what this process learned of history, such as a provider's `fetch`; undefined for a
   * reader that remembers only for itself.
   */
  protected historyMemoOwner(): object | undefined {
    return undefined;
  }
  private ownHistoryMemo?: Map<string, string>;
  private historyMemo(): Map<string, string> {
    const owner = this.historyMemoOwner();
    if (!owner) return this.ownHistoryMemo ??= new Map();
    let memo = historyMemos.get(owner);
    if (!memo) historyMemos.set(owner, memo = new Map());
    return memo;
  }
  private historyKey(kind: 'span' | 'renamed', commit: string, file: string) {
    return `mgn:history:${HISTORY_FACTS_VERSION}:${JSON.stringify([this.id, kind, commit, file])}`;
  }
  /**
   * A fact of the history that a commit fixes for good, from this process or the shared cache. A provider's answer
   * hashes to no key of its own, so the shared cache's value is trusted only under the cache's seal over key and value.
   */
  private async knownHistoryFact(key: string): Promise<string | undefined> {
    const memo = this.historyMemo(), remembered = memo.get(key);
    if (remembered !== undefined) {
      memo.delete(key);
      memo.set(key, remembered);
      return remembered;
    }
    if (!this.cache?.sign) return undefined;
    const [stored] = await this.cache.get([key]);
    if (stored === null) return undefined;
    let slot: { value?: unknown; seal?: unknown; };
    try {
      slot = JSON.parse(stored);
    } catch {
      return undefined;
    }
    const { value, seal } = slot || {};
    if (typeof value !== 'string' || typeof seal !== 'string') return undefined;
    const expected = Buffer.from(this.cache.sign(JSON.stringify([key, value])) ?? ''), given = Buffer.from(seal);
    if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
    this.rememberHistoryFact(key, value);
    return value;
  }
  private rememberHistoryFact(key: string, value: string) {
    const memo = this.historyMemo();
    memo.delete(key);
    memo.set(key, value);
    while (memo.size > HISTORY_MEMO_ENTRIES) memo.delete(memo.keys().next().value!);
  }
  private async keepHistoryFact(key: string, value: string) {
    this.rememberHistoryFact(key, value);
    const seal = this.cache?.sign?.(JSON.stringify([key, value]));
    if (seal) await this.cache!.set([[key, JSON.stringify({ value, seal })]], REMOTE_CACHE_TTL);
  }
  /** {@link renamedFrom}, asked of the provider once per commit and path. */
  private async followedFrom(commit: string, file: string): Promise<string | null> {
    const key = this.historyKey('renamed', commit, file), known = await this.knownHistoryFact(key);
    if (known !== undefined) return known || null;
    const former = await this.renamedFrom(commit, file);
    await this.keepHistoryFact(key, former ?? '');
    return former;
  }
  /** How many commits from `head` changed `file` at that path, and the oldest of them with its first parent, once a listing ran out. */
  private async knownSpan(head: string, file: string): Promise<HistorySpan | undefined> {
    const known = await this.knownHistoryFact(this.historyKey('span', head, file));
    if (known === undefined) return undefined;
    try {
      const { count, oldest, parent } = JSON.parse(known) as Partial<HistorySpan>;
      if (typeof count === 'number' && Number.isInteger(count) && count > 0 && typeof oldest === 'string' && typeof parent === 'string') return { count, oldest, parent };
    } catch {
      // A value from an older shape is read again from the provider.
    }
    return undefined;
  }

  /**
   * One page of the commits that changed `file`, newest first, listed from this reader's snapshot so pages never mix
   * branch states. Renames are followed as `git log --follow` does: once the commits at a path run out, the oldest one
   * that renamed or moved the file there continues the list at its former path, from that commit's parent. Each entry
   * carries the file's path in that commit.
   *
   * How many commits each path holds and where it was renamed from are remembered, since commits never change, so a
   * later page starts at the path that holds it instead of listing every path before it again. A read of one entry (a
   * check-in asks for the newest commit) follows no rename, so its `more` speaks only of the current path.
   */
  async fileHistory(file: string, page: number, perPage = 50): Promise<{ entries: HistoryEntry[]; more: boolean; }> {
    const snapshot = await this.getSnapshot();
    const start = (page - 1) * perPage, wanted = start + perPage + 1;
    /** The commits listed so far, from index `skipped` of the whole history, each with the file's path in it. */
    const listed: (RemoteCommit & { path: string; })[] = [];
    let skipped = 0, path = file, head = snapshot.sha;
    /** The index in the whole history of the first commit at `path`. */
    let offset = 0;
    // A provider page that says more follow past a full page answers `more` without reading on (a check-in asks for one entry).
    const full = () => skipped + listed.length >= start + perPage;
    let more = false;
    for (let hop = 0; hop <= MAX_FOLLOWED_RENAMES; hop++) {
      let span = await this.knownSpan(head, path);
      if (!span || offset + span.count > start) {
        // The path's commits continue the listing, or start it where the page begins at this path.
        if (skipped + listed.length !== offset) {
          listed.length = 0;
          skipped = offset;
        }
        let next = 1, first = 1, exhausted = false, fetched = 0, oldest: RemoteCommit | undefined;
        const take = (found: { commits: RemoteCommit[]; more: boolean; }) => {
          listed.push(...found.commits.map(commit => ({ ...commit, path })));
          fetched += found.commits.length;
          oldest = found.commits.at(-1) ?? oldest;
          exhausted = !found.more || !found.commits.length;
          more = !exhausted && full();
        };
        // The provider page of this path that holds the page's first commit, when this path holds it at all.
        const jump = Math.floor(Math.max(0, start - offset) / perPage) + 1;
        if (jump > 1 && (!span || span.count > (jump - 1) * perPage)) {
          const found = await this.historyPage(path, head, jump, perPage);
          if (found.commits.length) {
            listed.length = 0;
            skipped = offset + (jump - 1) * perPage;
            first = jump;
            take(found);
            next = jump + 1;
          }
        }
        while (!exhausted && !more && skipped + listed.length < wanted) take(await this.historyPage(path, head, next++, perPage));
        if (more || skipped + listed.length >= wanted || !exhausted || !oldest) break;
        span = { count: (first - 1) * perPage + fetched, oldest: oldest.sha, parent: oldest.parents[0] ?? '' };
        await this.keepHistoryFact(this.historyKey('span', head, path), JSON.stringify(span));
      }
      if (perPage === 1 && page === 1 && full()) break;
      // The oldest commit at this path added the file there; where it renamed or moved it, the history goes on before it.
      if (!span.parent) break;
      const former = await this.followedFrom(span.oldest, path);
      if (!former || former === path) break;
      offset += span.count;
      path = former;
      head = span.parent;
    }
    const entries = listed.slice(start - skipped, start - skipped + perPage).map(({ sha, parents, date, author, message, path: at }) => {
      const [subject = '', ...rest] = message.replace(/\n+$/, '').split('\n');
      return { commit: sha, parents, date, author, subject, body: rest.join('\n').trim(), path: at, agent: isAgentEdit(message) };
    });
    return { entries, more: more || skipped + listed.length > start + perPage };
  }
  /** `file` as it was in `commit`, or why it is not shown; undefined when that commit does not hold it. */
  async readFileAt(commit: string, file: string): Promise<HistoryRead | undefined> {
    if (!OBJECT_ID.test(commit)) throw new SourceError('Invalid commit.');
    const object = await this.objectAt(commit, file);
    return object ? this.readHistoryBlob(object.sha, object.size) : undefined;
  }
  /**
   * A blob by object id, bounded like every history read unless `limit` sets another bound (a live note's merge base
   * takes the live editor's); `size` skips the read of a blob known to be too large.
   */
  async readHistoryBlob(sha: string, size?: number, limit = HISTORY_MAX_BYTES): Promise<HistoryRead> {
    if (!OBJECT_ID.test(sha)) throw new SourceError('Invalid object id.');
    if (size !== undefined && size > limit) return { blob: sha, notice: 'too-large' };
    let bytes: Buffer;
    try {
      bytes = this.loaded.get(sha) ?? await this.readBlob(sha);
    } catch (error) {
      if (error instanceof SourceError && error.status === 413) return { blob: sha, notice: 'too-large' };
      throw error;
    }
    if (bytes.length > limit) return { blob: sha, notice: 'too-large' };
    return bytes.includes(0) ? { blob: sha, notice: 'binary' } : { blob: sha, content: bytes.toString('utf8') };
  }
  async commitDetails(commit: string): Promise<{ date: string; paths: string[]; } | null> {
    if (!OBJECT_ID.test(commit)) throw new SourceError('Invalid commit.');
    return this.commitInfo(commit);
  }

  /** A file of the branch head; a checked-out note, or a pending note's virtual path, answers its live text. */
  async readFile(file: string): Promise<Buffer> {
    const link = await this.liveLink(file);
    if (link) return Buffer.from((await this.liveTextOf(link)).content, 'utf8');
    return this.readSnapshotFile(await this.getSnapshot(), file);
  }
  /** Read immutable blobs from the exact snapshot used for planning or resolution. */
  async readSnapshotFile(snapshot: RemoteSnapshot, file: string): Promise<Buffer> {
    if (file.startsWith('/') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || !p) || file.includes('\0')) throw new SourceError('Invalid repository path.');
    const entry = snapshot.entries.find(e => e.path === file && e.type === 'blob' && e.mode !== '120000');
    if (!entry) throw new SourceError('File unavailable.', 404);
    if ((entry.size || 0) > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (!this.loaded.has(entry.sha)) await this.loadCached([entry]);
    const loaded = this.loaded.get(entry.sha);
    if (loaded) return loaded;
    const buffer = await this.readBlob(entry.sha);
    if (buffer.length > 5 * 1024 * 1024) throw new SourceError('File exceeds the 5 MiB read limit.', 413);
    if (this.cacheable(entry)) await this.storeCached([[entry, buffer]]);
    return buffer;
  }

  /** The workspace manifest restricted to the notebooks this repository serves. */
  async config(): Promise<WorkspaceConfig> {
    return this.scope();
  }

  /** Commits a serialized manifest to one of the manifest locations. */
  async commitManifest(file: string, content: string, expected: string) {
    if (!MANIFEST_FILES.includes(file)) throw new SourceError('Path is not a workspace manifest.', 403);
    // The same commit subject a local checkout writes, so the history reads the same from either side.
    return this.commitChanges([{ path: file, content }], expected, 'save', 'config', 'chore(workspace): update configuration');
  }

  /** One note; a checked-out note is read fresh from the live editor and carries `live`. */
  async note(file: string): Promise<NoteItem> {
    return this.noteOf(file, true);
  }
  /** One note; with `fresh` false a live text this request already loaded is used, as bulk reads do. */
  private async noteOf(file: string, fresh: boolean): Promise<NoteItem> {
    const config = await this.config();
    const link = await this.liveLink(file);
    // A template file directly in `.templates/` is read like a note, so its editor opens it; no other dot path is but a pending live note's.
    const nb = link?.notebook ?? config.notebooks.find(n => file.startsWith(`${n.root}/`) && (isNotebookContent(file.slice(n.root.length + 1), n) || templateFileId(file.slice(n.root.length + 1)) !== undefined));
    if (!nb || !isNoteFile(file)) throw new SourceError('Path is not a configured note.', 403);
    const raw = link ? (fresh ? await this.readLiveLink(link) : await this.liveTextOf(link)).content : (await this.readFile(file)).toString('utf8');
    const { metadata, content, title, lineNumberOffset, extra } = parseNoteFile(raw, file, config.notebooks.map(item => item.root));
    return { id: typeof metadata.id === 'string' ? metadata.id : file, path: file, notebookId: nb.id, title, metadata, content, lineNumberOffset, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), revision: (await this.getSnapshot()).sha, ...extra, ...(link ? { live: liveNoteState(link.checkout, this.live!.retargets) } : {}) };
  }

  /** Ordinary notes by default; `allKinds` includes outlines and compilations. */
  private notebookFiles(nb: NotebookConfig, entries: RemoteEntry[], allKinds = false) {
    const templateFiles = new Set((nb.templates || []).map(t => t.file));
    return entries.filter(e => e.type === 'blob' && e.mode !== '120000' && e.path.startsWith(`${nb.root}/`) && isNotebookContent(e.path.slice(nb.root.length + 1), nb) && !templateFiles.has(e.path.slice(nb.root.length + 1)) && (NOTE_EXTENSIONS.test(e.path) && (allKinds || !isOutlinePath(e.path)) || allKinds && isCompilationPath(e.path)));
  }

  /** Note paths of one notebook, taken from the snapshot tree without reading any file, and its pending live notes' virtual paths. */
  async notePaths(nb: NotebookConfig): Promise<string[]> {
    const { entries } = await this.getSnapshot();
    const { away, added } = await this.liveOverlay(nb);
    return [...this.notebookFiles(nb, entries).map(entry => entry.path).filter(file => !away.has(file)), ...added.map(link => link.path)];
  }
  /**
   * How the live links of a notebook change its Git listing: the Git paths of notes moving elsewhere leave it (`away`),
   * and pending notes and moving notes join it at the paths reads know them by (`added`).
   */
  private async liveOverlay(nb: NotebookConfig) {
    const links = await this.notebookLinks(nb);
    const moving = links.filter(link => link.checkout.path !== null && link.checkout.target !== undefined);
    return { links, away: new Set(moving.map(link => link.checkout.path!)), added: links.filter(link => link.checkout.path === null || link.checkout.target !== undefined) };
  }

  private notebookKey(kind: string, notebooks: NotebookConfig[], entries: RemoteEntry[]) {
    return `mgn:${kind}:${INDEX_VERSION}:${this.cacheRepository()}:${hashJson(notebooks.map(nb => [nb.id, nb.root, nb.assets || 'assets', (nb.templates || []).map(t => t.file), entries.find(entry => entry.type === 'tree' && entry.path === nb.root)?.sha || null]))}`;
  }

  /** Query read model over this reader's snapshot. Notebook indexes and derived results are cached by notebook content. */
  catalog(): RepositoryCatalog {
    const local = new Map<string, Promise<NoteListItem[]>>();
    let folders: Promise<FolderItem[]> | undefined;
    return {
      folders: async nb => (await (folders ??= this.folders())).filter(folder => folder.notebookId === nb.id),
      revision: async (fresh = false) => (await this.getSnapshot(fresh)).sha,
      dates: notes => this.editFacts(notes.map(note => note.path)),
      template: async (nb, file) => {
        const { entries } = await this.getSnapshot();
        if (!isTemplateFile(file.slice(nb.root.length + 1), nb) || !entries.some(entry => entry.path === file && entry.type === 'blob' && entry.mode !== '120000')) return undefined;
        return this.note(file);
      },
      index: nb => {
        let pending = local.get(nb.id);
        if (!pending) {
          pending = this.notebookIndex(nb).then(items => this.liveIndex(nb, items));
          local.set(nb.id, pending);
        }
        return pending;
      },
      contents: async notes => {
        await this.prefetchFiles(notes.map(note => note.path));
        await this.prefetchLive(notes.map(note => note.path));
        const result = new Map<string, string>();
        for (let i = 0; i < notes.length; i += 6) {
          await Promise.all(notes.slice(i, i + 6).map(async note => result.set(note.path, parseNoteFile((await this.readFile(note.path)).toString('utf8'), note.path).content)));
        }
        return result;
      },
      memo: async <T>(kind: string, notebooks: NotebookConfig[], compute: () => Promise<T>): Promise<T> => {
        const { entries } = await this.getSnapshot();
        if (!this.cache || notebooks.some(nb => !entries.some(entry => entry.type === 'tree' && entry.path === nb.root))) return compute();
        // Derived results of notebooks with live notes are kept per state of their live texts, so none mixes two states.
        const key = this.notebookKey(kind, notebooks, entries) + await this.liveMemoKey(notebooks);
        const [hit] = await this.cache.get([key]);
        if (hit !== null) {
          try {
            return JSON.parse(hit) as T;
          } catch { /* A damaged value is recomputed. */ }
        }
        const value = await compute();
        const text = JSON.stringify(value);
        if (Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
        return value;
      },
    };
  }

  /** What a memo key adds for the live links of `notebooks`: nothing without any. */
  private async liveMemoKey(notebooks: NotebookConfig[]): Promise<string> {
    const links = (await Promise.all(notebooks.map(nb => this.notebookLinks(nb)))).flat();
    if (!links.length) return '';
    return `:live:${hashJson(links.map(link => [link.checkout.id, link.path, link.checkout.contentHash]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))}`;
  }

  /**
   * The index of a notebook with its live links laid over it: a checked-out note takes its title, metadata, tags, status
   * and size from its live text, and a pending note is added at its virtual path. The Git index under it is never changed.
   */
  private async liveIndex(nb: NotebookConfig, items: NoteListItem[]): Promise<NoteListItem[]> {
    const { links, away, added } = await this.liveOverlay(nb);
    if (!links.length) return items;
    const scope = (await this.config()).notebooks.map(item => item.root);
    if (links.length > 500) console.warn(`[live-notes] ${links.length} live links in one notebook; the overlay reads only what a request needs`);
    const listed = new Set(items.map(item => item.path));
    const shown = links.filter(link => added.includes(link) || listed.has(link.path));
    await this.loadLiveTexts(shown);
    const revision = (await this.getSnapshot()).sha;
    const item = (link: LiveLink): NoteListItem => {
      const raw = this.liveLoaded.get(link.path)!.content;
      const { metadata, title, extra } = parseNoteFile(raw, link.path, scope);
      return { id: typeof metadata.id === 'string' ? metadata.id : link.path, path: link.path, notebookId: nb.id, title, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), ...extra, revision, live: liveNoteState(link.checkout, this.live!.retargets) };
    };
    const byPath = new Map(shown.map(link => [link.path, link]));
    return [...items.filter(entry => !away.has(entry.path)).map(entry => byPath.has(entry.path) && !added.includes(byPath.get(entry.path)!) ? item(byPath.get(entry.path)!) : entry), ...added.map(item)];
  }

  /** The Git index of a notebook, cached by its tree: it never holds a live text. */
  private async notebookIndex(nb: NotebookConfig): Promise<NoteListItem[]> {
    const snapshot = await this.getSnapshot();
    const { sha, entries } = snapshot;
    // A compilation's validity depends on every notebook root of the repository, so the index key carries them.
    const scope = (await this.config()).notebooks.map(item => item.root);
    if (!entries.some(entry => entry.type === 'tree' && entry.path === nb.root)) return [];
    const key = this.cache ? `${this.notebookKey('index', [nb], entries)}:${hashJson(scope)}` : '';
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    let items: NoteListItem[] | undefined;
    if (hit !== null) {
      try {
        items = JSON.parse(hit) as NoteListItem[];
      } catch { /* A damaged value is rebuilt. */ }
    }
    if (!Array.isArray(items) || items.some(item => typeof item?.path !== 'string' || typeof item?.title !== 'string' || item?.notebookId !== nb.id || !Array.isArray(item?.tags) || typeof item?.metadata !== 'object' || item?.metadata === null)) items = undefined;
    if (!items) {
      const files = this.notebookFiles(nb, entries, true);
      await this.prefetchFiles(files.map(file => file.path));
      items = [];
      for (let i = 0; i < files.length; i += 6) {
        items.push(
          ...await Promise.all(
            files.slice(i, i + 6).map(async file => {
              const raw = (await this.readSnapshotFile(snapshot, file.path)).toString('utf8');
              const { metadata, title, extra } = parseNoteFile(raw, file.path, scope);
              return { id: typeof metadata.id === 'string' ? metadata.id : file.path, path: file.path, notebookId: nb.id, title, metadata, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: Buffer.byteLength(raw), ...extra } satisfies NoteListItem;
            }),
          ),
        );
      }
      const text = JSON.stringify(items);
      if (this.cache && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    }
    return items.map(item => ({ ...item, revision: sha }));
  }

  /** The notebook's template entries: the manifest's, then the `.templates/` files of this snapshot. */
  private async templateEntries(nb: NotebookConfig): Promise<NoteTemplateEntry[]> {
    const { entries } = await this.getSnapshot();
    const prefix = `${nb.root}/${TEMPLATES_FOLDER}/`;
    return notebookTemplateEntries(nb, entries.filter(entry => entry.type === 'blob' && entry.mode !== '120000' && entry.path.startsWith(prefix)).map(entry => entry.path.slice(nb.root.length + 1)));
  }
  private async readTemplate(nb: NotebookConfig, entry: NoteTemplateEntry) {
    const raw = (await this.readFile(`${nb.root}/${entry.file}`)).toString('utf8');
    const { metadata, content } = parseNoteContent(raw, path.posix.basename(entry.file));
    return { metadata, content, raw };
  }

  /**
   * The parsed template list of one notebook. It is cached by the content of its template files, never by time: the key
   * holds the `.templates` tree and the blobs of the manifest's template files, so an edited template is a new key and a
   * commit that leaves them alone reads no file.
   */
  private async notebookTemplates(nb: NotebookConfig): Promise<NoteTemplateInfo[]> {
    const listed = await this.templateEntries(nb);
    if (!listed.length) return [];
    const { entries } = await this.getSnapshot();
    const blob = (file: string) => entries.find(entry => entry.path === `${nb.root}/${file}` && entry.type === 'blob' && entry.mode !== '120000')?.sha ?? null;
    // A snapshot that lists no tree for the folder is keyed by the folder's files themselves.
    const folder = entries.find(entry => entry.type === 'tree' && entry.path === `${nb.root}/${TEMPLATES_FOLDER}`)?.sha ?? listed.filter(entry => entry.source === 'file').map(entry => [entry.file, blob(entry.file)]);
    const key = this.cache ? `mgn:templates:${TEMPLATES_VERSION}:${this.cacheRepository()}:${hashJson([nb.id, nb.root, folder, (nb.templates || []).map(template => [template.id, template.title, template.file, blob(template.file)])])}` : '';
    const hit = this.cache ? (await this.cache.get([key]))[0] : null;
    if (hit !== null) {
      try {
        const cached = JSON.parse(hit) as NoteTemplateInfo[];
        if (Array.isArray(cached) && cached.every(item => typeof item?.id === 'string' && typeof item?.name === 'string' && typeof item?.file === 'string' && item?.notebookId === nb.id && Array.isArray(item?.placeholders))) return cached;
      } catch { /* A damaged value is rebuilt. */ }
    }
    await this.prefetchFiles(listed.map(entry => `${nb.root}/${entry.file}`));
    const templates: NoteTemplateInfo[] = [];
    // A registered template whose file is missing is described from the manifest alone; any other failed read is not kept, so the next call reads it again.
    let failed = false;
    for (const entry of listed) {
      templates.push(describeNoteTemplate(
        nb,
        entry,
        await this.readTemplate(nb, entry).catch((error: unknown) => {
          if (!(error instanceof SourceError && error.status === 404)) failed = true;
          return undefined;
        }),
      ));
    }
    const text = JSON.stringify(templates);
    if (this.cache && !failed && Buffer.byteLength(text) <= REMOTE_CACHE_MAX_VALUE) await this.cache.set([[key, text]], REMOTE_CACHE_TTL);
    return templates;
  }

  /** The templates of one notebook, or of every notebook this repository serves, each with its placeholders. */
  async templates(notebookId?: string): Promise<NoteTemplateInfo[]> {
    const config = await this.config();
    if (notebookId && !config.notebooks.some(nb => nb.id === notebookId)) throw new SourceError('Notebook is not configured.', 404);
    const listed: NoteTemplateInfo[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) listed.push(...await this.notebookTemplates(nb));
    return listed;
  }

  /**
   * Those templates as `list_templates` answers them: each with its last use, which the notebook's notes index dates from
   * the notes stamped with the template's id. The answer is kept with the index's other derived results, so no note is read for it.
   */
  async listedTemplates(notebookId?: string): Promise<ListedNoteTemplate[]> {
    const config = await this.config();
    if (notebookId && !config.notebooks.some(nb => nb.id === notebookId)) throw new SourceError('Notebook is not configured.', 404);
    const catalog = this.catalog();
    const listed: ListedNoteTemplate[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const templates = await this.notebookTemplates(nb);
      if (!templates.length) continue;
      const used = await catalog.memo('template-use', [nb], async () => templateLastUse(await catalog.index(nb)));
      listed.push(...templates.map(template => ({ ...template, lastUsed: lastUseOf(used, template.id) })));
    }
    return listed;
  }

  /** One template of a notebook, a manifest-registered one or a `.templates/` file, with its frontmatter, body and the file's own text. */
  async template(notebookId: string, templateId: string) {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId);
    const entry = nb && (await this.templateEntries(nb)).find(candidate => candidate.id === templateId);
    if (!nb || !entry) throw new SourceError('Template is not configured for this notebook.', 404);
    return { notebook: nb, entry, ...await this.readTemplate(nb, entry) };
  }

  /**
   * Fills a template for a note titled `title`; `fill` carries the caller's date, time and placeholder values, the clock
   * serving the rest. With `defaults: false` a placeholder without a value stays as written, as the app's New note menu asks.
   */
  async renderTemplate(notebookId: string, templateId: string, title: string, fill: { date?: string; time?: string; values?: unknown; defaults?: boolean; } = {}): Promise<RenderedNoteTemplate> {
    const template = await this.template(notebookId, templateId);
    const now = new Date();
    try {
      return renderNoteTemplate(template, { title, date: fill.date || formatTemplateDate(now), time: fill.time || formatTemplateTime(now), values: templateValues(template, fill.values), defaults: fill.defaults });
    } catch (error) {
      throw new SourceError((error as Error).message);
    }
  }

  async notes(notebookId?: string): Promise<NoteItem[]> {
    return this.readMarkdownNotes(notebookId, false);
  }
  /** All native Markdown bodies, including outlines, for reference safety checks. */
  async markdownNotes(notebookId?: string): Promise<NoteItem[]> {
    return this.readMarkdownNotes(notebookId, true);
  }
  private async readMarkdownNotes(notebookId: string | undefined, includeOutlines: boolean): Promise<NoteItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    const output: NoteItem[] = [];
    for (const nb of config.notebooks.filter(n => !notebookId || n.id === notebookId)) {
      const { links, away, added } = await this.liveOverlay(nb);
      // Pending live notes are listed at their virtual paths after the notebook's Git notes, and notes moving elsewhere at their targets.
      const files = [...this.notebookFiles(nb, entries, includeOutlines).filter(file => NOTE_EXTENSIONS.test(file.path) && !away.has(file.path)).map(file => file.path), ...added.map(link => link.path)];
      await this.prefetchFiles(files);
      await this.loadLiveTexts(links.filter(link => files.includes(link.path)));
      // The shared transport coalesces cache misses and serializes upstream requests.
      for (let i = 0; i < files.length; i += 6) output.push(...await Promise.all(files.slice(i, i + 6).map(file => this.noteOf(file, false))));
    }
    return output;
  }

  async readNotes(files: string[], expected: string): Promise<NoteItem[]> {
    if (!Array.isArray(files) || !files.length || files.length > 200 || files.some(file => typeof file !== 'string' || file.length > 2048)) {
      throw new SourceError('Select between 1 and 200 note paths.');
    }
    const snapshot = await this.getSnapshot(true);
    if (!expected || snapshot.sha !== expected) throw new StaleRevisionError([this.id], 'The repository changed. Review the latest version before committing.');
    await this.prefetchFiles(files);
    const notes: NoteItem[] = [];
    for (const file of files) {
      try {
        notes.push(await this.note(file));
      } catch (error) {
        // A deleted selected note is absent from the result so the browser can preserve and mark its draft.
        if (!(error instanceof SourceError) || error.status !== 404 || snapshot.entries.some(entry => entry.path === file)) throw error;
      }
    }
    return notes;
  }

  async folders(): Promise<FolderItem[]> {
    const config = await this.config();
    const { entries } = await this.getSnapshot();
    await this.prefetchFiles(entries.filter(entry => entry.path.endsWith('/_dir.yml') && config.notebooks.some(nb => entry.path.startsWith(nb.root + '/'))).map(entry => entry.path));
    const folders: FolderItem[] = [];
    for (const nb of config.notebooks) {
      const list: FolderItem[] = [];
      for (const entry of entries.filter(e => e.type === 'tree' && e.path.startsWith(`${nb.root}/`))) {
        const relative = entry.path.slice(nb.root.length + 1);
        if (!isNotebookContent(relative, nb)) continue;
        const file = `${entry.path}/_dir.yml`;
        const raw = entries.some(e => e.path === file && e.mode !== '120000') ? (await this.readFile(file)).toString('utf8') : '';
        list.push({ notebookId: nb.id, path: relative, ...parseFolderConfig(raw, path.posix.basename(relative), file) });
      }
      folders.push(...sortFolders(list));
    }
    return folders;
  }

  async assets(notebookId?: string) {
    const config = await this.config();
    const nb = config.notebooks.find(n => n.id === notebookId) || config.notebooks[0];
    const prefix = assetRoot(nb) + '/';
    const snapshot = await this.getSnapshot();
    return snapshot.entries.filter(e => e.type === 'blob' && e.mode !== '120000' && isAssetPath(e.path, nb)).map(e => ({ ...assetInfo(e.path, prefix.slice(0, -1), e.sha, e.size || 0), revision: snapshot.sha }));
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
            const existingRaw = note.createOnly ? undefined : await this.readFile(note.path).then(b => b.toString('utf8')).catch(() => undefined);
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
    const author = this.checkedAuthor();
    let revision: string;
    try {
      revision = await this.publishChanges([...changes.values()], snapshot, `docs(agents): rename ${location.slug} to ${nextLocation.slug}`, author);
      this.announceCommit([...changes.keys()]);
    } finally {
      this.invalidate();
      this.snapshot = undefined;
      this.fresh = false;
    }
    return { success: true, committed: true, pushed: true, repository: this.repository, branch: this.branch, revision, changedPaths: [...changes.keys()].sort(), path: nextPath, commit: { commitHash: revision, message: `docs(agents): rename ${location.slug} to ${nextLocation.slug}` } };
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
    const snapshot = knownSnapshot || await this.getSnapshot(true);
    // One note's new text refused because it is checked out tells the writer to read it again; any other change names every checked-out path.
    const single = changes.length === 1 && changes[0]?.content !== undefined ? changes[0].path : undefined;
    await this.assertMutable(snapshot, expected, Array.isArray(changes) ? changes.map(change => change?.path).filter((file): file is string => typeof file === 'string') : [], single ? () => editedLiveError(single) : undefined);
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
      const allowed = documentFile || versionFile || scope !== 'versions' && (scope === 'config' ? MANIFEST_FILES.includes(file) : !['study', 'focus', 'config'].includes(scope) && (scope === 'files' ? Boolean(managedNotebook(file, config.notebooks)) : scope === 'study-transition' ? nb && isNotebookContent(file.slice(nb.root.length + 1), nb) && NOTE_EXTENSIONS.test(file) : scope === 'skills' ? Boolean(skillFile(file, config.notebooks)) : scope === 'agents' ? agentFileAllowed(file, config.notebooks) : nb && (scope === 'assets' ? isAssetPath(file, nb) : isNotebookContent(file.slice(nb.root.length + 1), nb) && (isNoteFile(file) || path.posix.basename(file) === '_dir.yml') || templateFile)));
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
