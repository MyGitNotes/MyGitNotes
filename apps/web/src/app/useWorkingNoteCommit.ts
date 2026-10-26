import { readWorkingNotes, type WorkingNote, type WorkingNotes } from '../lib/working-notes.js';
import { serializeNoteFile } from '@mygitnotes/core/note-file';
import { addVersion } from '@mygitnotes/core/note-versions';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { mergeNote, sameValue } from '../lib/merge-note.js';
import { ApiError, commitRemoteNotes, fetchWorkspace, type GistSync, type PublishSync, readNotes } from '../lib/api.js';
import { draftScope, draftStore, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { appendLocalCommit, committedLayer, localCurrentRaw, localVersions, type NoteChangeInput, readLocalCommits } from '../lib/local-commits.js';
import { readDocumentDraft, settleDocumentDraft, type WorkspaceDocumentClient } from '../lib/use-workspace-document.js';
import { documentClientOf } from '../lib/workspace-document-clients.js';
import type { FileChange, NoteItem } from '../lib/types.js';
import { announceHistoryChange, fetchHistoryContent, fetchServerVersions, type NewVersionRequest } from '../lib/history-api.js';
import { useDemo } from '../lib/demo.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  documents: WorkspaceState['documents'];
  sourceId: WorkspaceState['sourceId'];
  t: I18nContextValue['t'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  clearCommittedDrafts: WorkspaceState['clearCommittedDrafts'];
  setRepositoryRevision: WorkspaceState['setRepositoryRevision'];
  /** Reports what a successful commit could not finish, such as a Gist it did not update. */
  setActionError: WorkspaceState['setActionError'];
}

/** A note without its text, as a local commit keeps the server's note it replaces. */
const withoutContent = ({ content: _content, ...rest }: NoteItem) => rest;
/** The text of a note at the repository head, as the server stores it; undefined when it cannot be read. */
const headText = (revision: string, path: string, notebookId: string) => fetchHistoryContent({ path, notebookId }, { commit: revision }).then(read => 'content' in read ? read.content : undefined, () => undefined);

/** A document draft read from one repository's storage for its commit. */
interface PreparedDocument {
  client: WorkspaceDocumentClient<unknown>;
  path: string;
  page: unknown;
  base: unknown;
  id?: string;
}
interface CommitGroup {
  repository: WorkspaceRepository;
  entries: WorkingNote[];
  documents: PreparedDocument[];
}

/** Commits selected drafts one repository at a time, one commit each, stopping at the first repository that fails. */
export function useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError }: Params) {
  const inDemo = useDemo() !== null;
  /**
   * Demo mode: records the selected drafts as one commit in this browser. Nothing is sent to the server; the commit joins
   * the repository's history in the version panel and is cleared with the rest of the visitor's demo data after 24 hours.
   */
  const commitLocally = async ({ repository, entries, documents: sentDocuments }: CommitGroup, message: string, version?: NewVersionRequest): Promise<{ gists: GistSync[]; published: PublishSync[]; }> => {
    const store = draftStore(repository), scope = draftScope(repository);
    const sent: WorkingNotes = {};
    const changes: Record<string, NoteChangeInput> = {};
    const layer = committedLayer(readLocalCommits(scope));
    for (const entry of entries) {
      if (entry.blocked) throw new Error(`${entry.note.path}: ${entry.blocked}`);
      if (!sameValue(readWorkingNotes(store)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
      const { path, notebookId } = entry.note;
      sent[path] = entry;
      // The server's note this change replaces: the one an earlier local commit already replaced, else the draft's own base.
      const known = layer[noteRefKey(entry.note)];
      const server = known ? known.server : entry.base;
      const serverNote = server ? withoutContent(server) : null;
      if (entry.deleted) {
        changes[path] = { notebookId, server: serverNote, deleted: true };
        continue;
      }
      const stored = localCurrentRaw(scope, path);
      const existing = stored ?? (entry.base ? await headText(repository.revision, path, notebookId) : undefined);
      changes[path] = { notebookId, server: serverNote, raw: serializeNoteFile(path, entry.note.metadata, entry.note.content, !entry.base, new Date(), existing) };
    }
    const pages = Object.fromEntries(sentDocuments.map(document => [document.path, document.page]));
    if (!Object.keys(changes).length && !sentDocuments.length) return { gists: [], published: [] };
    const onVersion = version && changes[version.path];
    const serverVersions = onVersion ? await fetchServerVersions({ path: version.path, notebookId: onVersion.notebookId }).catch(() => []) : [];
    await appendLocalCommit(scope, repository.revision, { message, author: t('demo.author'), notes: changes, documents: pages, ...(version && onVersion ? { version: { path: version.path, numberVersion: ({ id, date, blob }) => addVersion({ versions: [...serverVersions, ...localVersions(scope, version.path)] }, { blob, commit: id, authored: date }, { name: version.name, note: version.note }, version.today) } } : {}) });
    for (const document of sentDocuments) {
      if (!settleDocumentDraft(document.client, repository, document, repository.revision)) setActionError(t('changes.reviewRequired'));
      documents.find(live => live.client === document.client && live.repository === repository.id)?.refresh();
    }
    clearCommittedDrafts(repository, sent);
    announceHistoryChange({ repositories: [repository.id], paths: [...Object.keys(changes), ...Object.keys(pages)] });
    return { gists: [], published: [] };
  };

  /** One repository's drafts, merged onto its latest revision and committed as one commit; answers the Gists it failed to update. */
  const commitGroup = async (group: CommitGroup, message: string, version?: NewVersionRequest): Promise<{ gists: GistSync[]; published: PublishSync[]; }> => {
    if (group.repository.demo) return commitLocally(group, message, version);
    // The demo page says a commit stays in this browser: a repository of the signed-in person's own never gets one sent from it.
    if (inDemo) throw new Error(t('demo.referrer'));
    const { repository, entries, documents: sentDocuments } = group;
    if (!repository.write) throw new Error('Sign in with write access to this workspace before committing.');
    const store = draftStore(repository);
    const expected = repository.revision;
    const sent: WorkingNotes = {};
    let reviewRequired = false;
    const existingPaths = entries.filter(entry => entry.base).map(entry => entry.note.path);
    const latestNotes = existingPaths.length ? await readNotes(repository.id, existingPaths, expected) : [];
    const latestByPath = new Map(latestNotes.map(note => [note.path, note]));
    for (const entry of entries) {
      if (entry.blocked) throw new Error(`${entry.note.path}: ${entry.blocked}`);
      let prepared = entry;
      if (entry.base) {
        let latest: NoteItem;
        try {
          latest = latestByPath.get(entry.note.path)!;
          if (!latest) throw new ApiError('Note moved or deleted remotely.', 404);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) {
            const blocked = 'Moved or deleted remotely. Open the note and refresh after it is restored.';
            stageWorkingNote(entry.note, entry.base, blocked);
          }
          throw error;
        }
        if (latest.revision !== expected) throw new Error('Remote changed during review. Retry Commit to check the latest revision.');
        if (entry.deleted) {
          // A deletion removes the note it was made from; a note changed since then is the person's to look at again.
          if (!sameValue({ content: latest.content, metadata: latest.metadata }, { content: entry.base.content, metadata: entry.base.metadata })) {
            const blocked = 'The note changed remotely after it was deleted here. Restore it from the trash and delete it again.';
            stageWorkingNote(entry.note, entry.base, blocked, true);
            throw new Error(`${entry.note.path}: ${blocked}`);
          }
          if (!sameValue(readWorkingNotes(store)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
          sent[entry.note.path] = entry;
          continue;
        }
        const merged = mergeNote(entry.base, entry.note, latest);
        if (merged.conflict) {
          const blocked = 'Remote changes conflict with this draft. Open the note and Refresh remote version.';
          stageWorkingNote(entry.note, entry.base, blocked);
          throw new Error(`${entry.note.path}: ${blocked}`);
        }
        if (!sameValue(merged.draft, { content: entry.note.content, metadata: entry.note.metadata })) reviewRequired = true;
        prepared = { base: latest, note: { ...entry.note, ...merged.draft, revision: latest.revision } };
      }
      // Compare again after network reads so another tab's newer draft survives.
      if (!sameValue(readWorkingNotes(store)[entry.note.path], entry)) throw new Error('Local draft changed during review. Retry Commit.');
      stageWorkingNote(prepared.note, prepared.base);
      const persisted = readWorkingNotes(store)[entry.note.path];
      if (persisted) sent[entry.note.path] = persisted;
    }
    if (reviewRequired) throw new Error(t('changes.reviewRequired'));
    if (!Object.keys(sent).length && !sentDocuments.length) return { gists: [], published: [] };
    const result = await commitRemoteNotes(repository.id, Object.values(sent).map(entry => entry.deleted ? { path: entry.note.path, delete: true as const } : { path: entry.note.path, content: entry.note.content, metadata: entry.note.metadata, createOnly: !entry.base }), expected, message, sentDocuments.map(({ path, page, base }) => ({ path, page, base })), version);
    for (const document of sentDocuments) {
      if (!settleDocumentDraft(document.client, repository, document, result.revision)) setActionError(t('changes.reviewRequired'));
      // The open notebook's document shows the committed page and any edit made meanwhile.
      documents.find(live => live.client === document.client && live.repository === repository.id)?.refresh();
    }
    clearCommittedDrafts(repository, sent);
    setRepositoryRevision(repository.id, result.revision);
    return { gists: (result.gists ?? []).filter(gist => gist.error), published: (result.published ?? []).filter(entry => entry.error || entry.notices?.length) };
  };

  /** Commits the selected changes, each named by its repository and path. */
  /** With `version`, the one selected note's version file joins its commit. */
  const commitWorkingNotes = async (files: Pick<FileChange, 'path' | 'repository'>[], message: string, version?: NewVersionRequest) => {
    const workspace = await fetchWorkspace(true);
    if ((workspace.defaultRepository ?? '') !== sourceId) throw new Error('Sign in with write access to this workspace before committing.');
    const repositories = workspace.repositories.filter(repository => !repository.unavailable);
    const groups = new Map<string, CommitGroup>();
    for (const file of files) {
      if (file.path === '.mygitnotes-bookmarks.yaml') throw new Error('Legacy bookmark drafts require explicit recovery, not a Changes commit.');
      const repository = repositories.find(candidate => candidate.id === file.repository);
      if (!repository) throw new Error('Pending files changed. Review the selection again.');
      const group = groups.get(repository.id) ?? { repository, entries: [], documents: [] };
      groups.set(repository.id, group);
      const client = documentClientOf(file.path);
      if (client) {
        const draft = readDocumentDraft(client, repository, client.document.empty());
        if (!draft) throw new Error('Pending files changed. Review the selection again.');
        group.documents.push({ client, path: file.path, page: draft.page, base: draft.base, id: draft.id });
        continue;
      }
      const entry = readWorkingNotes(draftStore(repository))[file.path];
      if (!entry) throw new Error('Pending files changed. Review the selection again.');
      group.entries.push(entry);
    }
    const committed: string[] = [];
    const failedGists: GistSync[] = [];
    const publishReports: PublishSync[] = [];
    for (const group of groups.values()) {
      try {
        const reports = await commitGroup(group, message, version);
        failedGists.push(...reports.gists);
        publishReports.push(...reports.published);
      } catch (error) {
        if (!committed.length) throw error;
        throw new Error(t('changes.partialCommit', { repositories: committed.join(', '), error: (error as Error).message }));
      }
      committed.push(group.repository.repository || group.repository.id);
    }
    if (failedGists.length) setActionError(t('editor.gistSyncFailed', { errors: failedGists.map(gist => `${gist.path}: ${gist.error}`).join('; ') }));
    else if (publishReports.length) setActionError(t('editor.publishSyncReport', { details: publishReports.flatMap(entry => [...entry.error ? [entry.error] : [], ...entry.notices ?? []].map(detail => `${entry.path}: ${detail}`)).join('; ') }));
  };

  return { commitWorkingNotes };
}
