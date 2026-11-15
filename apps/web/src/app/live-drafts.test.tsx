// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useDeletionUndo } from './useDeletionUndo.js';
import { useBulkNoteActions } from './useBulkNoteActions.js';

/*
 * Delete and move of a pending live note (docs/specs/2026-11-15-builtin-live-editor §20): every delete entry discards
 * the draft (asking first when someone typed in it), and a multi-select move retargets the pending notes it holds.
 */

const files = vi.hoisted(() => ({ mutateFile: vi.fn(), fetchFiles: vi.fn() }));
vi.mock('../lib/files-api.js', () => files);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const live = { since: '2026-11-15T00:00:00.000Z', activeEditors: 0, pending: true as const, editorUrl: 'http://localhost/x', pathRule: '{{title}}.md' };
const pending: NoteListItem = { id: 'p', path: 'notes/.live/live-1.md', notebookId: 'nb', title: 'Draft', tags: [], metadata: {}, live };
const plain: NoteListItem = { id: 'a', path: 'notes/a.md', notebookId: 'nb', title: 'A', tags: [], metadata: {} };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('deleting a pending note', () => {
  const setup = (editingNote: NoteListItem | null = null, remote = true) => {
    const params = { canWriteNotebook: () => true, revisionFor: () => 'r1', setNotebookRevision: vi.fn(), updateDraft: vi.fn(), editingNote, setEditingNote: vi.fn(), navigate: vi.fn(), returnTo: '/notebooks/nb', remote, setActionError: vi.fn(), readNoteForChange: vi.fn(), invalidateNotes: vi.fn(), gitStatus: null, setGitStatus: vi.fn(), repositoryFor: () => undefined };
    const hook = renderHook(() => useDeletionUndo(params as never));
    return { params, remove: (note: NoteListItem) => act(() => hook.result.current.handleDeleteNote(note)) };
  };

  it('discards an untyped draft at once, commits nothing, and leaves its editor', async () => {
    fetchMock.mockResolvedValue(json({ discarded: true }));
    const { params, remove } = setup(pending);
    await remove(pending);
    expect(fetchMock).toHaveBeenCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'nb', path: pending.path }) }));
    expect(files.mutateFile).not.toHaveBeenCalled();
    expect(params.invalidateNotes).toHaveBeenCalled();
    expect(params.setEditingNote).toHaveBeenCalledWith(null);
    expect(params.navigate).toHaveBeenCalledWith('/notebooks/nb', { replace: true });
  });

  it('takes the armed delete of a remote workspace’s lists as the one confirmation of a typed draft', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    fetchMock.mockResolvedValueOnce(json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409)).mockResolvedValueOnce(json({ discarded: true }));
    const { params, remove } = setup();
    await remove(pending);
    expect(confirm).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'nb', path: pending.path, confirm: true }) }));
    expect(params.invalidateNotes).toHaveBeenCalled();
  });

  it('asks before it discards a typed draft where the lists do not arm, and keeps it when the person says no', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    fetchMock.mockResolvedValue(json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409));
    const { params, remove } = setup(null, false);
    await remove(pending);
    expect(confirm).toHaveBeenCalledWith('Discard this draft? Its text will not be saved to Git.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(params.invalidateNotes).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409)).mockResolvedValueOnce(json({ discarded: true }));
    await remove(pending);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'nb', path: pending.path, confirm: true }) }));
    expect(params.invalidateNotes).toHaveBeenCalled();
  });

  it('says why a draft was kept', async () => {
    fetchMock.mockResolvedValue(json({ discarded: false, reason: 'active', activeEditors: 2 }));
    const { params, remove } = setup();
    await remove(pending);
    expect(params.setActionError).toHaveBeenLastCalledWith('The draft was kept: someone is still editing.');
  });
});

describe('a multi-select move holding pending notes', () => {
  it('retargets each pending note and moves the rest as files', async () => {
    files.fetchFiles.mockResolvedValue({ revision: 'r1' });
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/a.md': 'notes/work/a.md' }, deletedPaths: [] });
    fetchMock.mockResolvedValue(json({ checkout: {}, destination: { folder: 'work', name: '{{title}}.md' } }));
    const params = { selectedNotes: [pending, plain], clearSelection: vi.fn(), onUpdateNoteStatus: vi.fn(), beforeFileChange: vi.fn(async () => {}), onFilesChanged: vi.fn(async () => {}), repositories: [], remote: true, canWrite: true, t: ((key: string) => key) as never, invalidateNotes: vi.fn(), setRepositoryRevision: vi.fn(), setActionError: vi.fn(), tagOperations: {} as never, config: { notebooks: [{ id: 'nb', root: 'notes' }] } as never };
    const hook = renderHook(() => useBulkNoteActions(params));
    await act(() => hook.result.current.runBulkMove('nb', 'work'));
    expect(fetchMock).toHaveBeenCalledWith('/api/live/retarget', expect.objectContaining({ body: JSON.stringify({ notebookId: 'nb', path: pending.path, folder: 'work' }) }));
    expect(files.mutateFile).toHaveBeenCalledTimes(1);
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/a.md', destination: 'notes/work/a.md' }, 'r1');
    expect(params.beforeFileChange).toHaveBeenCalledWith({ notebookId: 'nb', paths: ['notes/a.md', 'notes/work/a.md'] });
    expect(params.invalidateNotes).toHaveBeenCalled();
    expect(params.clearSelection).toHaveBeenCalled();
  });
});
