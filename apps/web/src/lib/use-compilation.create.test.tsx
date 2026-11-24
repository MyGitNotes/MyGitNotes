// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';

const create = vi.fn(async () => ({}));
vi.mock('./compilation-actions.js', () => ({ useCompilationActions: () => ({ canWrite: () => true, create, save: vi.fn(), remove: vi.fn() }) }));
vi.mock('./note-editing.js', () => ({ useEditorRegistry: () => () => () => {} }));
let statuses: Record<string, number> = {};
vi.mock('./use-note-queries.js', () => ({ useNoteList: () => ({ notes: [], uncommitted: [], loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} }), useNoteLookup: () => ({ notes: [], committed: [], loading: false, error: '' }), useNoteFacets: () => ({ facets: { life: { statuses } }, loading: false, error: '' }) }));
const { useCompilations } = await import('./use-compilation.js');

const notebooks = [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['inbox', 'done'] }];
const lane: CompilationRow = { id: 'g1', path: '', notebookId: 'life', name: 'Lane', view: 'graph', kind: 'custom', items: [] };

afterEach(() => {
  vi.useRealTimers();
  create.mockClear();
  statuses = {};
});

it('gives a compilation created from the graph the first status of its notebook, as a new note gets', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCompilations('life', notebooks as never));
  act(() => result.current.change({ rows: [lane] }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(create).toHaveBeenCalledTimes(1);
  const [, , content, metadata] = create.mock.calls[0] as unknown as [string, string, string, Record<string, unknown>];
  expect(metadata).toMatchObject({ status: 'inbox' });
  expect(content).toContain('status: inbox');
});

it('keeps a status the row already has', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCompilations('life', notebooks as never));
  act(() => result.current.change({ rows: [{ ...lane, status: 'done' }] }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect((create.mock.calls[0] as unknown as unknown[])[3]).toMatchObject({ status: 'done' });
});

it('creates a board row as a board', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCompilations('life', notebooks as never));
  act(() => result.current.change({ rows: [{ ...lane, view: 'board' }] }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect((create.mock.calls[0] as unknown as unknown[])[2]).toContain('arrangement: board\n');
});

it('refuses a row whose file would not open again, writing nothing and saying why', async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCompilations('life', notebooks as never));
  const cards = Array.from({ length: 2000 }, (_, index) => ({ path: `notes/life/${index}-${'n'.repeat(215)}.md`, x: 0, y: index * 152 }));
  const huge: CompilationRow = { id: 'big', path: '', notebookId: 'life', name: 'Big', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 'x', notebookId: 'life' }, board: { cards } };
  act(() => result.current.change({ rows: [huge] }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(create).not.toHaveBeenCalled();
  expect(result.current.page.rows).toEqual([]);
  expect(result.current.error).toMatch(/Big: not saved, the file would not open \(Compilation file exceeds 512 KiB\)/);
});
