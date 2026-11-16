// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkingNoteCommit } from './useWorkingNoteCommit.js';
import { deletionEntry, readWorkingNotes, updateWorkingNote } from '../lib/working-notes.js';
import { draftStore, repositoryOf, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import type { FileChange, NoteItem } from '../lib/types.js';
import { documentDraftKey } from '../lib/use-workspace-document.js';
import { focusDocumentClient } from '../lib/use-focus-page.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { rememberCreatedGist } from '../lib/created-gists.js';

const home: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const other: WorkspaceRepository = { id: 'github:me/campaign@main', alias: 'campaign', type: 'github', repository: 'me/campaign', branch: 'main', revision: 'b'.repeat(40), write: true, notebooks: ['campaign~trpg'], title: 'campaign', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const repositories = [home, other];
const note = (path: string, notebookId: string, content: string, revision: string): NoteItem => ({ id: path, path, notebookId, title: path, content, metadata: {}, tags: [], revision });
const base = note('notes/life/a.md', 'notes~life', '# A', home.revision);
const change = (path: string, repository: WorkspaceRepository): FileChange => ({ path, repository: repository.id, kind: 'modified', tracked: true, revision: '', staged: false, unstaged: true });

let commits: any[], syncs: any[];
/** What the fake server adds to each commit answer, such as the Gists it did not push. */
let commitExtra: (body: any) => Record<string, unknown> = () => ({});
function stubServer(failFor?: string) {
  commits = [];
  syncs = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url === '/api/workspace?fresh=1') return new Response(JSON.stringify({ keyedConfig: null, local: false, defaultRepository: home.id, repositories, coreUpdate: false }));
      if (url === '/api/notes/read-batch') return new Response(JSON.stringify({ notes: body.paths.map((path: string) => ({ ...base, path })) }));
      if (url === '/api/notes/commit') {
        commits.push(body);
        if (body.repository === failFor) return new Response(JSON.stringify({ error: 'The repository changed.', staleRepositories: [failFor] }), { status: 409 });
        return new Response(JSON.stringify({ revision: `${body.repository}-next`, commit: { commitHash: 'x' }, ...commitExtra(body) }));
      }
      if (url === '/api/gists/sync') {
        syncs.push(body);
        return new Response(JSON.stringify({ gists: body.notes }));
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );
}

function commitHook(confirmGists?: (entries: { path: string; gist: string; }[]) => Promise<boolean>) {
  const stageWorkingNote = (draft: NoteItem, draftBase: NoteItem | null, blocked?: string, deleted?: boolean) => {
    updateWorkingNote(draftStore(repositoryOf(repositories, draft.notebookId)!), draft.path, { note: draft, base: draftBase, ...(blocked ? { blocked } : {}), ...(deleted ? { deleted: true as const } : {}) });
    return draft;
  };
  const clearCommittedDrafts = vi.fn();
  const setRepositoryRevision = vi.fn();
  const { result } = renderHook(() => useWorkingNoteCommit({ documents: [], sourceId: home.id, t: ((key: string, params?: Record<string, string>) => `${key} ${JSON.stringify(params ?? {})}`) as never, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError: vi.fn(), ...(confirmGists ? { confirmGists } : {}) }));
  return { ...result.current, clearCommittedDrafts, setRepositoryRevision };
}

beforeEach(() => {
  localStorage.clear();
  updateWorkingNote(draftStore(home), base.path, { note: { ...base, content: '# A edited' }, base });
  updateWorkingNote(draftStore(other), 'trpg/b.md', { note: note('trpg/b.md', 'campaign~trpg', '# B', other.revision), base: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  commitExtra = () => ({});
});

it('commits the drafts of each repository as one commit on that repository', async () => {
  stubServer();
  const { commitWorkingNotes, clearCommittedDrafts, setRepositoryRevision } = commitHook();
  await commitWorkingNotes([change(base.path, home), change('trpg/b.md', other)], 'docs: update');
  expect(commits.map(commit => [commit.repository, commit.revision, commit.notes.map((item: any) => item.path)])).toEqual([[home.id, home.revision, [base.path]], [other.id, other.revision, ['trpg/b.md']]]);
  expect(clearCommittedDrafts.mock.calls.map(([repository, sent]) => [repository.id, Object.keys(sent)])).toEqual([[home.id, [base.path]], [other.id, ['trpg/b.md']]]);
  expect(setRepositoryRevision.mock.calls).toEqual([[home.id, `${home.id}-next`], [other.id, `${other.id}-next`]]);
});

it('stops at the first repository that fails and names the repositories already committed', async () => {
  stubServer(other.id);
  const { commitWorkingNotes, clearCommittedDrafts, setRepositoryRevision } = commitHook();
  await expect(commitWorkingNotes([change(base.path, home), change('trpg/b.md', other)], 'docs: update')).rejects.toThrow(/changes\.partialCommit .*me\/notes.*The repository changed/);
  expect(clearCommittedDrafts.mock.calls.map(([repository]) => repository.id)).toEqual([home.id]);
  expect(setRepositoryRevision.mock.calls).toEqual([[home.id, `${home.id}-next`]]);
  expect(Object.keys(readWorkingNotes(draftStore(other)))).toEqual(['trpg/b.md']);
});

it('refuses a repository the requester may not write', async () => {
  stubServer();
  repositories[1] = { ...other, write: false };
  try {
    const { commitWorkingNotes } = commitHook();
    await expect(commitWorkingNotes([change('trpg/b.md', other)], 'docs: update')).rejects.toThrow(/write access/);
    expect(commits).toEqual([]);
  } finally {
    repositories[1] = other;
  }
});

it('commits equal paths of two repositories to their own repositories', async () => {
  stubServer();
  const twin = note(base.path, 'campaign~trpg', '# Twin', other.revision);
  updateWorkingNote(draftStore(other), base.path, { note: twin, base: null });
  const { commitWorkingNotes } = commitHook();
  await commitWorkingNotes([change(base.path, other)], 'docs: update');
  expect(commits.map(commit => [commit.repository, commit.notes.map((item: any) => item.content)])).toEqual([[other.id, ['# Twin']]]);
  expect(Object.keys(readWorkingNotes(draftStore(home)))).toEqual([base.path]);
});

it('commits a document draft with the group of the repository that holds it', async () => {
  stubServer();
  const page = { version: 2, focuses: [{ id: 'reading', notebookId: 'trpg', name: 'Reading', root: { kind: 'pane', id: 'p1', tabs: [] } }] };
  localStorage.setItem(documentDraftKey(focusDocumentClient, other.id), JSON.stringify({ page, base: { version: 2, focuses: [] }, revision: other.revision }));
  const { commitWorkingNotes } = commitHook();
  await commitWorkingNotes([change('.github-notes-focus.yaml', other)], 'docs: focus');
  expect(commits.map(commit => [commit.repository, commit.documents.map((document: any) => document.path)])).toEqual([[other.id, ['.github-notes-focus.yaml']]]);
  // A draft saved before notebook keys stores the local id; the commit names the notebook by key for the server to store locally again.
  expect(commits[0].documents[0].page.focuses[0].notebookId).toBe('campaign~trpg');
  expect(localStorage.getItem(documentDraftKey(focusDocumentClient, other.id))).toBeNull();
});

it('commits a deletion as a delete entry when the note is as it was deleted', async () => {
  stubServer();
  updateWorkingNote(draftStore(home), base.path, deletionEntry(base));
  const { commitWorkingNotes, clearCommittedDrafts } = commitHook();
  await commitWorkingNotes([change(base.path, home)], 'docs: remove a');
  expect(commits[0].notes).toEqual([{ path: base.path, delete: true }]);
  expect(Object.keys(clearCommittedDrafts.mock.calls[0][1])).toEqual([base.path]);
});

it('blocks a deletion of a note that changed remotely since, keeping it in the trash', async () => {
  stubServer();
  updateWorkingNote(draftStore(home), base.path, deletionEntry({ ...base, content: '# Older A' }));
  const { commitWorkingNotes } = commitHook();
  await expect(commitWorkingNotes([change(base.path, home)], 'docs: remove a')).rejects.toThrow(/changed remotely after it was deleted/);
  expect(commits).toEqual([]);
  expect(readWorkingNotes(draftStore(home))[base.path]).toMatchObject({ deleted: true, blocked: expect.stringContaining('Restore it from the trash') });
});

/*
 * A Gist the app did not create for a note, or one an agent changed last, is pushed only once the person confirms it
 * (todo #31). A Gist this browser created for the note is its own confirmation.
 */
it('sends the Gist this app created for a note as its confirmation, and asks nothing', async () => {
  stubServer();
  rememberCreatedGist(home.id, base.path, 'new456');
  updateWorkingNote(draftStore(home), base.path, { note: { ...base, content: '# A edited', metadata: { gist: 'new456' } }, base });
  updateWorkingNote(draftStore(home), 'notes/life/c.md', { note: note('notes/life/c.md', 'notes~life', '# C', home.revision), base: null });
  const confirm = vi.fn(async () => true);
  const { commitWorkingNotes } = commitHook(confirm);
  await commitWorkingNotes([change(base.path, home), change('notes/life/c.md', home)], 'docs: update');
  expect(commits[0].confirmedGists).toEqual([{ path: base.path, gist: 'new456' }]);
  expect(confirm).not.toHaveBeenCalled();
  expect(syncs).toEqual([]);
});

it('confirms no Gist the note no longer names, nor one created for another repository', async () => {
  stubServer();
  rememberCreatedGist(home.id, base.path, 'old789');
  rememberCreatedGist(other.id, base.path, 'new456');
  updateWorkingNote(draftStore(home), base.path, { note: { ...base, content: '# A edited', metadata: { gist: 'new456' } }, base });
  const { commitWorkingNotes } = commitHook(vi.fn(async () => false));
  await commitWorkingNotes([change(base.path, home)], 'docs: update');
  expect(commits[0].confirmedGists).toBeUndefined();
});

it('asks about the Gists a commit did not push and sends the ones the person confirms, naming that commit', async () => {
  stubServer();
  commitExtra = body => ({ gistsNeedConfirm: [{ path: base.path, gist: 'victim' }], gists: [], revision: `${body.repository}-next` });
  const confirm = vi.fn(async () => true);
  const { commitWorkingNotes } = commitHook(confirm);
  await commitWorkingNotes([change(base.path, home)], 'docs: update');
  expect(confirm).toHaveBeenCalledWith([{ path: base.path, gist: 'victim' }]);
  expect(syncs).toEqual([{ repository: home.id, revision: `${home.id}-next`, notes: [{ path: base.path, gist: 'victim' }] }]);
});

it('sends nothing when the person does not publish', async () => {
  stubServer();
  commitExtra = () => ({ gistsNeedConfirm: [{ path: base.path, gist: 'victim' }] });
  const confirm = vi.fn(async () => false);
  const { commitWorkingNotes } = commitHook(confirm);
  await commitWorkingNotes([change(base.path, home)], 'docs: update');
  expect(confirm).toHaveBeenCalledOnce();
  expect(syncs).toEqual([]);
});

/*
 * Collab-first (docs/specs/2026-11-16-collab-first-self-host A3.2.3): a draft of a note that is live now is merged into
 * the live note instead of committed, which the server would refuse as checked out; the rest of the drafts are committed.
 */
it('merges a draft of a note that is live now into the live note, and commits the rest', async () => {
  const live = { ...home, live: { kind: 'builtin' as const } };
  repositories[0] = live;
  try {
    updateWorkingNote(draftStore(live), 'notes/life/b.md', { note: note('notes/life/b.md', 'notes~life', '# B edited', home.revision), base: note('notes/life/b.md', 'notes~life', '# B', home.revision) });
    commits = [];
    const merges: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url === '/api/workspace?fresh=1') return new Response(JSON.stringify({ keyedConfig: null, local: false, defaultRepository: home.id, repositories, coreUpdate: false }));
        if (url === '/api/notes/read-batch') return new Response(JSON.stringify({ notes: body.paths.map((path: string) => path === base.path ? { ...base, live: { since: '2026-11-16T01:00:00.000Z', activeEditors: 1, editorUrl: 'http://localhost/a' } } : { ...base, path, content: '# B' }) }));
        if (url === '/api/live/merge') {
          merges.push(body);
          return new Response(JSON.stringify({ applied: true, contentHash: 'h'.repeat(64), checkout: {}, outcome: 'joined' }));
        }
        if (url === '/api/notes/commit') {
          commits.push(body);
          return new Response(JSON.stringify({ revision: `${body.repository}-next`, commit: { commitHash: 'x' } }));
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const { commitWorkingNotes, clearCommittedDrafts } = commitHook();
    await commitWorkingNotes([change(base.path, live), change('notes/life/b.md', live)], 'docs: update');
    expect(merges.map(merge => [merge.path, merge.text.includes('# A edited')])).toEqual([[base.path, true]]);
    expect(commits.map(commit => commit.notes.map((item: any) => item.path))).toEqual([['notes/life/b.md']]);
    expect(clearCommittedDrafts.mock.calls.flatMap(([, sent]) => Object.keys(sent)).sort()).toEqual([base.path, 'notes/life/b.md']);
  } finally {
    repositories[0] = home;
  }
});

// cf16-F012: a live note's conflict draft in a commit is named in the app's words, not by its raw reason.
it('names a conflict draft of a live note in the app’s words when it is in a commit', async () => {
  stubServer();
  updateWorkingNote(draftStore(home), base.path, { note: { ...base, content: '# A mine' }, base, blocked: 'live-merge-conflict' });
  const { commitWorkingNotes } = commitHook();
  const error = await commitWorkingNotes([change(base.path, home)], 'docs: update').catch((thrown: Error) => thrown);
  expect((error as Error).message).toBe(`${base.path}: live.mergeConflict {}`);
  expect(commits).toEqual([]);
});
