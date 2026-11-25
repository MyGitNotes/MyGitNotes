// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { useBulkNoteActions } from './useBulkNoteActions.js';
import { useTagWorkspaceOperations } from './useTagWorkspaceOperations.js';

/*
 * A bulk tag change goes on without a compilation that would not open with its new tags: the server leaves it as it
 * was and lists it, the page names it with the reason, and the undo leaves it alone.
 */

const repository: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const note: NoteListItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'A', tags: ['todo'], metadata: {} };
const compilation: NoteListItem = { id: 'c', path: 'notes/life/c.compilation.yml', notebookId: 'notes~life', title: 'C', tags: ['todo'], metadata: {} };
const reason = 'Tags not written: the compilation would not open (arrangement: Required)';
const t = (key: string, params?: Record<string, string | number>) => params ? `${key} ${JSON.stringify(params)}` : key;
const notice = t('sidebar.tagSkippedCompilations', { count: 1, files: `${compilation.path} (${reason})` });

afterEach(() => vi.unstubAllGlobals());

function stubServer() {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const written = body.entries.filter((entry: { path: string; }) => entry.path !== compilation.path).map((entry: { path: string; }) => entry.path);
    return new Response(JSON.stringify({ success: true, changedPaths: written, revision: 'b'.repeat(40), skipped: [{ path: compilation.path, reason }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

it('names the skipped compilation after a bulk tag add, and records only the written notes for undo', async () => {
  stubServer();
  const record = vi.fn();
  const params = { selectedNotes: [note, compilation], clearSelection: vi.fn(), onUpdateNoteStatus: vi.fn(), beforeFileChange: vi.fn(), onFilesChanged: vi.fn(), repositories: [repository], remote: true, canWrite: true, t: t as never, invalidateNotes: vi.fn(), setRepositoryRevision: vi.fn(), setActionError: vi.fn(), tagOperations: { record } as never, config: null };
  const hook = renderHook(() => useBulkNoteActions(params));
  await act(() => hook.result.current.runBulkTag('add', 'done'));
  expect(params.setActionError).toHaveBeenLastCalledWith(notice);
  expect(record).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0][2].affected.map((entry: { path: string; }) => entry.path)).toEqual([note.path]);
  expect(params.clearSelection).toHaveBeenCalled();
});

it('names the skipped compilation after a workspace tag rename', async () => {
  stubServer();
  const queryClient = { fetchQuery: vi.fn(async () => ({ notes: [note, compilation] })) };
  const params = { queryClient: queryClient as never, queryScope: { sourceId: 's', revisions: {}, repositories: { 'notes~life': repository.id } } as never, repositories: [repository], remote: true, canWrite: true, t: t as never, invalidateNotes: vi.fn(), setRepositoryRevision: vi.fn(), setActionError: vi.fn() };
  const hook = renderHook(() => useTagWorkspaceOperations(params));
  await act(() => hook.result.current.handleRenameTag('todo', 'doing'));
  expect(params.setActionError).toHaveBeenLastCalledWith(notice);
  expect(hook.result.current.tagOperations.history[0].plan.affected.map(entry => entry.path)).toEqual([note.path]);
});
