// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkingNoteCommit } from './useWorkingNoteCommit.js';
import { readWorkingNotes, updateWorkingNote } from '../lib/working-notes.js';
import { draftScope, draftStore, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import type { FileChange, NoteItem } from '../lib/types.js';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { registerDemoRepositories } from '../lib/demo-storage.js';
import { committedLayer, readLocalCommits } from '../lib/local-commits.js';
import { fetchHistory } from '../lib/history-api.js';
import { documentDraftKey } from '../lib/use-workspace-document.js';
import { focusDocumentClient } from '../lib/use-focus-page.js';
import { DemoProvider } from '../lib/demo.js';
import { createElement, type ReactNode } from 'react';

const HEAD = 'a'.repeat(40);
const demo: WorkspaceRepository = { id: 'edition:demo:scenarios@main', alias: 'demo', type: 'edition', branch: 'main', revision: HEAD, write: false, demo: true, notebooks: ['demo~contract-en'], title: 'Demo', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const SERVER_RAW = '---\ntitle: Contract\nstatus: draft\n---\n# Contract\n';
const note = (content: string): NoteItem => ({ id: 'c', path: 'notes/c.md', notebookId: 'demo~contract-en', title: 'Contract', content, metadata: { title: 'Contract', status: 'draft' }, tags: [], status: 'draft', revision: HEAD });
const server = note('# Contract\n');
const change = (path: string): FileChange => ({ path, repository: demo.id, kind: 'modified', tracked: true, revision: '', staged: false, unstaged: true });

let requests: { url: string; method: string; }[];
beforeEach(() => {
  localStorage.clear();
  registerDemoRepositories([demo]);
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? 'GET' });
      if (url === '/api/workspace?fresh=1') return new Response(JSON.stringify({ keyedConfig: null, local: false, defaultRepository: demo.id, repositories: [demo], coreUpdate: false }));
      if (url.startsWith('/api/history/file')) return new Response(JSON.stringify({ blob: 'b'.repeat(40), content: SERVER_RAW }));
      if (url.startsWith('/api/history?')) return new Response(JSON.stringify({ path: 'notes/c.md', repository: demo.id, entries: [{ commit: 'r'.repeat(40), parents: [], date: '2026-01-01T00:00:00.000Z', author: 'a', subject: 'Real', body: '', path: 'notes/c.md', agent: false }], more: false, versions: [], writable: false }));
      throw new Error(`Unexpected request ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function hook(inDemo = false) {
  const stageWorkingNote = (draft: NoteItem, draftBase: NoteItem | null) => {
    updateWorkingNote(draftStore(demo), draft.path, { note: draft, base: draftBase });
    return draft;
  };
  const clearCommittedDrafts = vi.fn();
  const setRepositoryRevision = vi.fn();
  const { result } = renderHook(() => useWorkingNoteCommit({ documents: [], sourceId: demo.id, t: ((key: string) => key) as never, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError: vi.fn() }), { wrapper: ({ children }: { children: ReactNode; }) => createElement(DemoProvider, { value: inDemo ? { scenario: 'contract' } : null }, children) });
  return { ...result.current, clearCommittedDrafts, setRepositoryRevision };
}

it('commits a demo draft in this browser without posting to the server, then lists it in history with its version', async () => {
  updateWorkingNote(draftStore(demo), 'notes/c.md', { note: note('# Contract\n\nNew clause.\n'), base: server });
  const { commitWorkingNotes, clearCommittedDrafts, setRepositoryRevision } = hook();
  await commitWorkingNotes([change('notes/c.md')], 'Add a clause', { path: 'notes/c.md', today: '2026-10-25', name: 'v3' });
  expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(requests.some(request => request.url.startsWith('/api/notes/commit'))).toBe(false);
  expect(clearCommittedDrafts).toHaveBeenCalledOnce();
  expect(setRepositoryRevision).not.toHaveBeenCalled();
  const log = readLocalCommits(draftScope(demo))!;
  expect(log.base).toBe(HEAD);
  expect(log.commits).toHaveLength(1);
  const [commit] = log.commits;
  expect(commit).toMatchObject({ parent: HEAD, message: 'Add a clause', author: 'demo.author' });
  expect(commit.id).toMatch(/^[0-9a-f]{40}$/);
  const entry = committedLayer(log)[noteRefKey({ notebookId: 'demo~contract-en', path: 'notes/c.md' })];
  expect(entry.note.content).toContain('New clause.');
  expect(entry.server?.title).toBe('Contract');
  const history = await fetchHistory({ path: 'notes/c.md', notebookId: 'demo~contract-en' });
  expect(history.entries.map(item => [item.local ?? false, item.subject])).toEqual([[true, 'Add a clause'], [false, 'Real']]);
  expect(history.versions).toEqual([expect.objectContaining({ name: 'v3', sequence: 1, commit: commit.id })]);
  expect(history.localCommits).toBe(true);
});

it('stacks a second commit on the first, taking the first as its parent and as the text it changes', async () => {
  updateWorkingNote(draftStore(demo), 'notes/c.md', { note: note('# Contract\n\nOne.\n'), base: server });
  const { commitWorkingNotes } = hook();
  await commitWorkingNotes([change('notes/c.md')], 'One');
  const first = readLocalCommits(draftScope(demo))!.commits[0];
  const committed = Object.values(committedLayer(readLocalCommits(draftScope(demo))))[0].note;
  updateWorkingNote(draftStore(demo), 'notes/c.md', { note: { ...committed, content: '# Contract\n\nOne.\n\nTwo.\n' }, base: committed });
  await commitWorkingNotes([change('notes/c.md')], 'Two');
  const commits = readLocalCommits(draftScope(demo))!.commits;
  expect(commits.map(commit => commit.message)).toEqual(['One', 'Two']);
  expect(commits[1].parent).toBe(first.id);
  expect(Object.values(committedLayer(readLocalCommits(draftScope(demo))))[0].server?.title).toBe('Contract');
});

it('commits the Focus document page and a deletion locally', async () => {
  updateWorkingNote(draftStore(demo), 'notes/c.md', { note: server, base: server, deleted: true });
  const page = { version: 2, focuses: [] };
  localStorage.setItem(documentDraftKey(focusDocumentClient, demo.id), JSON.stringify({ page, base: page, revision: HEAD, id: 'd1' }));
  const { commitWorkingNotes } = hook();
  await commitWorkingNotes([change('notes/c.md'), change('.github-notes-focus.yaml')], 'Layout');
  const [commit] = readLocalCommits(draftScope(demo))!.commits;
  expect(commit.notes['notes/c.md']).toMatchObject({ deleted: true });
  expect(Object.keys(commit.documents)).toEqual(['.github-notes-focus.yaml']);
  expect(localStorage.getItem(documentDraftKey(focusDocumentClient, demo.id))).toBeNull();
});

it('refuses a blocked draft and a changed draft, writing nothing', async () => {
  updateWorkingNote(draftStore(demo), 'notes/c.md', { note: note('# x\n'), base: server, blocked: 'conflict' });
  const { commitWorkingNotes } = hook();
  await expect(commitWorkingNotes([change('notes/c.md')], 'x')).rejects.toThrow(/conflict/);
  expect(readLocalCommits(draftScope(demo))).toBeNull();
  expect(Object.keys(readWorkingNotes(draftStore(demo)))).toEqual(['notes/c.md']);
});

it('never sends a remote commit from the demo page, whichever repository the answer held', async () => {
  const own: WorkspaceRepository = { ...demo, id: 'github:me/notes@main', alias: 'notes', demo: undefined, write: true, notebooks: ['notes~life'] };
  const ownNote = { ...note('# own\n'), notebookId: 'notes~life', path: 'notes/own.md' };
  updateWorkingNote(draftStore(own), ownNote.path, { note: ownNote, base: null });
  const { commitWorkingNotes } = hook(true);
  const answer = { keyedConfig: null, local: false, defaultRepository: demo.id, repositories: [{ ...own, id: demo.id }, own], coreUpdate: false };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(answer));
  });
  await expect(commitWorkingNotes([{ ...change(ownNote.path), repository: own.id }], 'x')).rejects.toThrow('demo.referrer');
  expect(requests.filter(request => request.method !== 'GET')).toEqual([]);
  expect(Object.keys(readWorkingNotes(draftStore(own)))).toEqual([ownNote.path]);
});
