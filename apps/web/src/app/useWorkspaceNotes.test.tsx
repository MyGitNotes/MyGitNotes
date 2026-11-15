// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import { handleNoteQueryError } from '../lib/use-note-queries.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { useWorkspaceNotes } from './useWorkspaceNotes.js';

const REVISION = 'a'.repeat(40);
const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const repository = (live: boolean): WorkspaceRepository => ({ id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: REVISION, write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '', ...(live ? { live: editor } : {}) }) as WorkspaceRepository;
const ref = { notebookId: 'notes~life', path: 'notes/life/a.md' };
const answer = (live: boolean) => new Response(JSON.stringify({ revisions: { 'github:me/notes@main': REVISION }, notes: [{ id: ref.path, ...ref, title: 'A', tags: [], metadata: {}, content: '# A\n', ...(live ? { live: { since: '2026-11-15T01:00:00.000Z', activeEditors: 1, editorUrl: 'https://live.example.test/abc' } } : {}) }] }), { headers: { 'Content-Type': 'application/json' } });

let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  client = new QueryClient({ queryCache: new QueryCache({ onError: (error, query) => handleNoteQueryError(error, query) }), defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
const notes = (live: boolean) => {
  // The workspace's values keep their identity across renders, as the workspace state's do.
  const params = { sourceId: 'github:me/notes@main', repositories: [repository(live)], activeWorkingNotes: {}, remote: true, refreshWorkspace: async () => {}, readDraft: () => undefined, t: (key: string) => key };
  return renderHook(() => useWorkspaceNotes(params as never), { wrapper });
};

it('reads a live repository note afresh when asked, since a checkout moves no revision', async () => {
  const { result } = notes(true);
  fetchMock.mockResolvedValueOnce(answer(false));
  expect((await act(() => result.current.findCommittedNote(ref)))?.live).toBeUndefined();
  // Someone checks the note out; the cached lookup still says nothing of it.
  fetchMock.mockResolvedValueOnce(answer(true));
  expect((await act(() => result.current.findCommittedNote(ref)))?.live).toBeUndefined();
  expect((await act(() => result.current.findCommittedNote(ref, { fresh: true })))?.live).toBeDefined();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('keeps the cached answer of a repository without a live editor, whose revision says everything', async () => {
  const { result } = notes(false);
  fetchMock.mockResolvedValue(answer(false));
  await act(() => result.current.findCommittedNote(ref));
  await act(() => result.current.findCommittedNote(ref, { fresh: true }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("says the repository changed in the reader's language, not the server's words", async () => {
  const { result } = notes(false);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'The repository changed. Reload to continue from the latest revision.', staleRepositories: ['github:me/notes@main'] }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
  await act(async () => {
    await result.current.findCommittedNote(ref).catch(() => null);
  });
  expect(result.current.staleNotice).toBe('notes.repositoryChanged');
});
