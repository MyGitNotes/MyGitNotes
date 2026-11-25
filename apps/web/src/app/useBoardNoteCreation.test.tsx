// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NoteItem } from '../lib/types.js';
import { useBoardNoteCreation } from './useBoardNoteCreation.js';
const api = vi.hoisted(() => ({ saveNote: vi.fn(), deleteNote: vi.fn(), fetchGitStatus: vi.fn() }));
vi.mock('../lib/api.js', () => api);
type Params = Parameters<typeof useBoardNoteCreation>[0];

/** A workspace's browser drafts, as `readDraft` and `updateDraft` keep them. */
function drafts() {
  const store = new Map<string, { note: NoteItem; base: NoteItem | null; }>();
  const key = (notebookId: string, path: string) => `${notebookId}:${path}`;
  return { store, readDraft: ((notebookId: string, path: string) => store.get(key(notebookId, path))) as unknown as Params['readDraft'], updateDraft: ((notebookId: string, path: string, entry: { note: NoteItem; base: NoteItem | null; } | null) => void (entry ? store.set(key(notebookId, path), entry) : store.delete(key(notebookId, path)))) as unknown as Params['updateDraft'], stage: (note: NoteItem, base: NoteItem | null) => (store.set(key(note.notebookId, note.path), { note, base }), note) };
}

function params(overrides: Partial<Params> = {}): Params & { kept: ReturnType<typeof drafts>; } {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'fetchQuery').mockResolvedValue({ notes: [] });
  const kept = drafts();
  return { kept, config: { notebooks: [{ id: 'a', root: 'notes/a', title: 'A' }, { id: 'b', root: 'notes/b', title: 'B', statuses: ['seed', 'done'] }] }, folders: [{ notebookId: 'b', path: 'reading', title: 'Reading', order: 0 }], foldersLoading: false, remote: false, canWriteNotebook: () => true, repositoryFor: (() => ({ id: 'repo', write: true })) as unknown as Params['repositoryFor'], readDraft: kept.readDraft, updateDraft: kept.updateDraft, queryClient, queryScope: { sourceId: 'local:a', revisions: {}, repositories: { a: 'repo', b: 'repo' }, drafts: {} }, stageWorkingNote: vi.fn(kept.stage), revisionFor: () => 'head', invalidateNotes: vi.fn(), setGitStatus: vi.fn(), facets: undefined, t: (key: string) => ({ 'createNote.untitled': 'Untitled', 'createNote.body': 'Write your note here.', 'board.cardLive': 'live', 'outline.readOnly': 'read-only' } as Record<string, string>)[key] ?? key, ...overrides } as Params & { kept: ReturnType<typeof drafts>; };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGitStatus.mockResolvedValue({ status: {} });
  api.saveNote.mockImplementation(async input => ({ note: { ...input, id: 'new', title: 'Untitled', tags: input.metadata.tags } }));
  api.deleteNote.mockResolvedValue({ success: true });
});
afterEach(cleanup);

it('creates the note in the notebook asked, not the selected one, with that notebook’s initial status', async () => {
  const input = params();
  const { result } = renderHook(useBoardNoteCreation, { initialProps: input });
  const { note } = await result.current.createBoardNote({ notebookId: 'b', folder: 'reading', tag: 'virtue' });
  expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b/reading/untitled.md', notebookId: 'b', createOnly: true, noCommit: true }));
  expect(api.saveNote.mock.calls[0][0].metadata).toEqual({ id: 'untitled', tags: ['virtue'], status: 'seed' });
  expect(note.path).toBe('notes/b/reading/untitled.md');
  expect(input.invalidateNotes).toHaveBeenCalled();
});

it('gives the receipt back once the file is written, whatever the page did meanwhile', async () => {
  let written!: () => void;
  api.saveNote.mockImplementation(input => new Promise(resolve => written = () => resolve({ note: { ...input, id: 'new', title: 'Untitled', tags: [] } })));
  const input = params();
  const hook = renderHook(useBoardNoteCreation, { initialProps: input });
  const receipt = hook.result.current.createBoardNote({ notebookId: 'a' });
  await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalled());
  // The page moves to another notebook and workspace scope while the write is out.
  hook.rerender({ ...input, queryScope: { sourceId: 'local:b', revisions: {}, repositories: { b: 'other' }, drafts: {} } });
  written();
  const { note, rollback } = await receipt;
  expect(note.path).toBe('notes/a/untitled.md');
  await rollback();
  expect(api.deleteNote).toHaveBeenCalledWith('notes/a/untitled.md', { noCommit: true, notebookId: 'a' });
});

it('rolls a local note back by deleting its uncommitted file, and says when it could not', async () => {
  const { result } = renderHook(useBoardNoteCreation, { initialProps: params() });
  const { rollback } = await result.current.createBoardNote({ notebookId: 'a' });
  api.deleteNote.mockRejectedValueOnce(new Error('The file is locked.'));
  await expect(rollback()).rejects.toThrow('The file is locked.');
});

it('in a hosted workspace stages a new browser draft, and rolls back by dropping only that draft', async () => {
  const input = params({ remote: true });
  const { result } = renderHook(useBoardNoteCreation, { initialProps: input });
  const { note, rollback } = await result.current.createBoardNote({ notebookId: 'b' });
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/b/untitled.md', notebookId: 'b', status: 'seed' }), null);
  expect(input.kept.store.has(`b:${note.path}`)).toBe(true);
  await rollback();
  // Never in Git, so nothing is deleted there: the draft is simply gone.
  expect(api.deleteNote).not.toHaveBeenCalled();
  expect(input.kept.store.size).toBe(0);
});

it('numbers past existing notes and the hosted workspace’s drafts', async () => {
  const input = params({ remote: true });
  input.kept.stage({ id: 'untitled-2', path: 'notes/a/untitled-2.md', notebookId: 'a', title: 'x', content: '', metadata: {}, tags: [] }, null);
  vi.mocked(input.queryClient.fetchQuery).mockResolvedValue({ notes: [{ path: 'notes/a/untitled.md' }] });
  const { result } = renderHook(useBoardNoteCreation, { initialProps: input });
  expect((await result.current.createBoardNote({ notebookId: 'a' })).note.path).toBe('notes/a/untitled-3.md');
});

it('creates nothing where new notes start live, in a read-only notebook, or in a folder that is not there', async () => {
  const live = params({ repositoryFor: (() => ({ id: 'repo', write: true, live: true })) as unknown as Params['repositoryFor'] });
  const { result } = renderHook(useBoardNoteCreation, { initialProps: live });
  expect(result.current.newNotesLive('a')).toBe(true);
  await expect(result.current.createBoardNote({ notebookId: 'a' })).rejects.toThrow('live');
  const readOnly = renderHook(useBoardNoteCreation, { initialProps: params({ canWriteNotebook: () => false }) });
  await expect(readOnly.result.current.createBoardNote({ notebookId: 'a' })).rejects.toThrow('read-only');
  const missing = renderHook(useBoardNoteCreation, { initialProps: params() });
  await expect(missing.result.current.createBoardNote({ notebookId: 'a', folder: 'reading' })).rejects.toThrow('createNote.invalidFolder');
  expect(api.saveNote).not.toHaveBeenCalled();
});
