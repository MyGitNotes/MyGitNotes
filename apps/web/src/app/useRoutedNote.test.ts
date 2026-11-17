// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseWorkspaceRoute } from '../lib/routes.js';

const lookup = vi.hoisted(() => ({ current: { notes: [] as unknown[], committed: [] as unknown[], loading: true, paused: false, error: '', updatedAt: 0 } }));
const readNote = vi.hoisted(() => vi.fn<(path: string, notebookId?: string) => Promise<unknown>>());
vi.mock('../lib/use-note-queries.js', () => ({ useNoteLookup: () => lookup.current }));
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal<typeof import('../lib/api.js')>()), readNote }));

const { ApiError } = await import('../lib/api.js');
const { useRoutedNote } = await import('./useRoutedNote.js');

const config = { notebooks: [{ id: 'nb', root: 'notes', name: 'Notes' }] } as unknown as Parameters<typeof useRoutedNote>[0]['config'];
const open = (onFiled?: (notebookId: string, path: string) => void) => renderHook(() => useRoutedNote({ config, editorRoute: parseWorkspaceRoute('/notebooks/nb/notes/idea.md', ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn(), onFiled }));

describe('useRoutedNote and a note read that waits for the connection', () => {
  it('says the note cannot be read offline instead of loading for ever, and loads once the read runs again', () => {
    lookup.current = { notes: [], committed: [], loading: true, paused: true, error: '', updatedAt: 0 };
    const hook = open();
    expect(hook.result.current.routedLoading).toBe(false);
    expect(hook.result.current.routeError).toBe('route.noteOffline');
    lookup.current = { ...lookup.current, paused: false };
    hook.rerender();
    expect(hook.result.current.routedLoading).toBe(true);
    expect(hook.result.current.routeError).toBe('');
  });

  it('still loads while a read is running', () => {
    lookup.current = { notes: [], committed: [], loading: true, paused: false, error: '', updatedAt: 0 };
    const hook = open();
    expect(hook.result.current.routedLoading).toBe(true);
    expect(hook.result.current.routeError).toBe('');
  });
});

/*
 * A note address the lists do not show (a reload or a second window at a live note's earlier target, or its Git path
 * while it waits to move: docs/specs/2026-11-15-builtin-live-editor §20.4) is not taken for a missing note: the server is
 * asked where it is, and the note opens there. Not found is said only once the server says the note is gone.
 */
describe('useRoutedNote and a note the lists do not show', () => {
  const listed = () => void (lookup.current = { notes: [], committed: [], loading: false, paused: false, error: '', updatedAt: 1 });
  const asked = () => {
    const answer: { reject: (error: unknown) => void; resolve: (note: unknown) => void; } = { reject: () => {}, resolve: () => {} };
    readNote.mockReset();
    readNote.mockImplementation(() => new Promise((resolve, reject) => Object.assign(answer, { resolve, reject })));
    return answer;
  };

  it('loads while the server is asked, and opens the note where its move took it, even an earlier target that a later move replaced', async () => {
    listed();
    const answer = asked(), onFiled = vi.fn();
    const hook = open(onFiled);
    expect(hook.result.current.routedLoading).toBe(true);
    expect(hook.result.current.routeError).toBe('');
    expect(readNote).toHaveBeenCalledWith('notes/idea.md', 'nb');
    await act(async () => answer.reject(new ApiError('This live note was checked in and filed.', 404, undefined, undefined, false, { movedTo: 'notes/archive/idea.md' })));
    expect(onFiled).toHaveBeenCalledWith('nb', 'notes/archive/idea.md', 'notes/idea.md');
    expect(hook.result.current.routeError).toBe('');
    expect(hook.result.current.routedLoading).toBe(true);
  });

  it('says the note is not found once the server says it is gone', async () => {
    listed();
    const answer = asked(), onFiled = vi.fn();
    const hook = open(onFiled);
    await act(async () => answer.reject(new ApiError('Note not found', 404)));
    expect(hook.result.current.routeError).toBe('route.noteNotFound');
    expect(hook.result.current.routedLoading).toBe(false);
    expect(onFiled).not.toHaveBeenCalled();
  });

  it('says the note is not found when the server says it moved out of its notebook, instead of loading for ever (R5-F001)', async () => {
    listed();
    const answer = asked(), onFiled = vi.fn();
    const hook = open(onFiled);
    await act(async () => answer.reject(new ApiError('This live note was checked in and filed.', 404, undefined, undefined, false, { movedTo: 'elsewhere/idea.md' })));
    expect(hook.result.current.routeError).toBe('route.noteNotFound');
    expect(hook.result.current.routedLoading).toBe(false);
    expect(onFiled).not.toHaveBeenCalled();
  });

  it('opens the note the server reads where the lists have not caught up with it yet', async () => {
    listed();
    const answer = asked();
    const hook = open();
    const note = { notebookId: 'nb', path: 'notes/idea.md', title: 'Idea', content: '# Idea\n', metadata: {} };
    await act(async () => answer.resolve(note));
    expect(hook.result.current.routedNote).toEqual(note);
    expect(hook.result.current.routeError).toBe('');
  });
});

/*
 * Another person moved or renamed the note zoom shows (§20.4): the address follows it there, and the note stays open in
 * zoom, its editor and the person's typing in it, while the lists read it at its new path.
 */
describe('useRoutedNote and a note the address follows to where it moved', () => {
  it('goes on showing the note at its new path while the lists read it there', async () => {
    const { followMovedNote } = await import('./follow-moved-note.js');
    const note = { notebookId: 'nb', path: 'notes/idea.md', title: 'Idea', content: '# Idea\n', metadata: {}, tags: [] };
    lookup.current = { notes: [note], committed: [], loading: false, paused: false, error: '', updatedAt: 1 };
    const hook = renderHook(({ route }) => useRoutedNote({ config, editorRoute: parseWorkspaceRoute(route, ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn() }), { initialProps: { route: '/notebooks/nb/notes/idea.md' } });
    expect(hook.result.current.routedNote).toEqual(note);
    followMovedNote({ note, to: 'notes/archive/idea.md', notebook: { id: 'nb', root: 'notes' }, routedPath: 'notes/idea.md', search: '', relocatePaths: () => {}, navigate: () => {}, refresh: () => {} });
    lookup.current = { notes: [], committed: [], loading: true, paused: false, error: '', updatedAt: 1 };
    hook.rerender({ route: '/notebooks/nb/notes/archive/idea.md' });
    expect(hook.result.current.routedNote).toEqual({ ...note, path: 'notes/archive/idea.md' });
    expect(hook.result.current.routedLoading).toBe(false);
  });

  it('says the note is not found where the server says it is gone, though the address followed it there', async () => {
    const { followMovedNote } = await import('./follow-moved-note.js');
    const note = { notebookId: 'nb', path: 'notes/idea.md', title: 'Idea', content: '# Idea\n', metadata: {}, tags: [] };
    lookup.current = { notes: [note], committed: [], loading: false, paused: false, error: '', updatedAt: 1 };
    const hook = renderHook(({ route }) => useRoutedNote({ config, editorRoute: parseWorkspaceRoute(route, ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn() }), { initialProps: { route: '/notebooks/nb/notes/idea.md' } });
    followMovedNote({ note, to: 'notes/gone/idea.md', notebook: { id: 'nb', root: 'notes' }, routedPath: 'notes/idea.md', search: '', relocatePaths: () => {}, navigate: () => {}, refresh: () => {} });
    readNote.mockReset();
    readNote.mockRejectedValue(new ApiError('Note not found', 404));
    lookup.current = { notes: [], committed: [], loading: false, paused: false, error: '', updatedAt: 2 };
    hook.rerender({ route: '/notebooks/nb/notes/gone/idea.md' });
    await act(async () => {});
    expect(hook.result.current.routedNote).toBeNull();
    expect(hook.result.current.routeError).toBe('route.noteNotFound');
  });

  it('loads another note the address names, which shows nothing of the one before', () => {
    const note = { notebookId: 'nb', path: 'notes/idea.md', title: 'Idea', content: '# Idea\n', metadata: {}, tags: [] };
    lookup.current = { notes: [note], committed: [], loading: false, paused: false, error: '', updatedAt: 1 };
    const hook = renderHook(({ route }) => useRoutedNote({ config, editorRoute: parseWorkspaceRoute(route, ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn() }), { initialProps: { route: '/notebooks/nb/notes/idea.md' } });
    lookup.current = { notes: [], committed: [], loading: true, paused: false, error: '', updatedAt: 1 };
    hook.rerender({ route: '/notebooks/nb/notes/other.md' });
    expect(hook.result.current.routedNote).toBeNull();
    expect(hook.result.current.routedLoading).toBe(true);
  });
});
