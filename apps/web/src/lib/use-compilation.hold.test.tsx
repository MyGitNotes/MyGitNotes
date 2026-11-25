// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { CompilationHold } from './use-compilation.js';

const create = vi.fn(async () => ({}));
/** The save the controller registers with the editors, which the app runs before a file moves or the page is left. */
let registered: (() => Promise<boolean>) | undefined;
vi.mock('./compilation-actions.js', () => ({ useCompilationActions: () => ({ canWrite: () => true, create, save: vi.fn(), remove: vi.fn() }) }));
vi.mock('./note-editing.js', () => ({
  useEditorRegistry: () => (_key: string, flush: () => Promise<boolean>) => {
    registered = flush;
    return () => {};
  },
}));
vi.mock('./use-note-queries.js', () => ({ useNoteList: () => ({ notes: [], uncommitted: [], loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} }), useNoteLookup: () => ({ notes: [], committed: [], loading: false, error: '' }), useNoteFacets: () => ({ facets: {}, loading: false, error: '' }) }));
const { useCompilations } = await import('./use-compilation.js');

const notebooks = [{ id: 'life', title: 'Life', root: 'notes/life' }];
const board: CompilationRow = { id: 'b1', path: '', notebookId: 'life', name: 'Board', view: 'board', kind: 'custom', items: [] };

it('refuses every other write while held, lets the holder’s through, and writes no rows read before the hold after it', async () => {
  const { result } = renderHook(() => useCompilations('life', notebooks as never));
  const before = result.current.capture()!;
  let hold!: CompilationHold;
  act(() => void (hold = result.current.hold('Wait for the card.')));
  // Another caller's change, save, read for a later write, and the editors' save are refused with the reason.
  act(() => expect(result.current.change({ rows: [board] })).toBe(false));
  expect(result.current.error).toBe('Wait for the card.');
  await act(async () => expect(await result.current.save()).toBe(false));
  act(() => expect(result.current.capture()).toBeUndefined());
  await act(async () => expect(await registered!()).toBe(false));
  // The holder's own edit goes through, and its save writes it.
  act(() => expect(hold.admit(() => result.current.change({ rows: [board] }))).toBe(true));
  await act(async () => expect(await hold.save()).toBe(true));
  expect(create).toHaveBeenCalledOnce();
  act(() => hold.release());
  // Rows read before the hold are not written after it; rows read now are, and the editors' save goes on.
  act(() => expect(before()).toBe(false));
  expect(result.current.capture()!()).toBe(true);
  await act(async () => expect(await registered!()).toBe(true));
});
