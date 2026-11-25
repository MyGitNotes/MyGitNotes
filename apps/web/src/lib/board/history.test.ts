import { describe, expect, it } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyHistory, type HistoryMove, recordStep, redoStep, undoStep } from './history.js';

const row = (x: number, name = 'C'): CompilationRow => ({ id: 'c', name, notebookId: 'nb', path: 'p', view: 'board', kind: 'custom', items: [{ id: 'a', kind: 'note', notebookId: 'nb', path: 'notes/a.md' }], board: { cards: [{ item: 'a', x, y: 0 }] } });

const moved = (move: HistoryMove | undefined) => {
  if (!move || 'stale' in move) throw new Error('expected a step');
  return move;
};

describe('board history', () => {
  it('undoes and redoes gestures one step each, keeping fields the board does not edit', () => {
    let history = recordStep(emptyHistory, row(0), row(10));
    history = recordStep(history, row(10), row(20));
    const undone = moved(undoStep(history, row(20, 'Renamed')));
    expect(undone.row).toEqual(row(10, 'Renamed'));
    const twice = moved(undoStep(undone.history, undone.row));
    expect(twice.row.board?.cards?.[0]).toEqual({ item: 'a', x: 0, y: 0 });
    expect(undoStep(twice.history, twice.row)).toBeUndefined();
    const redone = moved(redoStep(twice.history, twice.row));
    expect(redone.row.board?.cards?.[0]).toEqual({ item: 'a', x: 10, y: 0 });
    // A new gesture drops what was undone.
    expect(recordStep(redone.history, redone.row, row(5)).future).toEqual([]);
  });

  it('undoes nothing once the items or board changed outside the history, so an add or arrange is never lost', () => {
    const history = recordStep(emptyHistory, row(0), row(10));
    const moved10 = row(10) as Extract<CompilationRow, { kind: 'custom'; }>;
    const added: CompilationRow = { ...moved10, items: [...moved10.items, { id: 'b', kind: 'note', notebookId: 'nb', path: 'notes/b.md' }] };
    expect(undoStep(history, added)).toEqual({ stale: true });
    // The same content read back from the file is not a change.
    expect(moved(undoStep(history, structuredClone(row(10)))).row.board?.cards?.[0]).toEqual({ item: 'a', x: 0, y: 0 });
    const undone = moved(undoStep(history, row(10)));
    expect(redoStep(undone.history, { ...undone.row, board: { cards: [{ item: 'a', x: 99, y: 0 }] } })).toEqual({ stale: true });
  });

  it('puts back a board the row had none of before', () => {
    const before: CompilationRow = { id: 'c', name: 'C', notebookId: 'nb', path: 'p', view: 'board', kind: 'custom', items: [] };
    const after = { ...before, board: { texts: [{ id: 't', x: 0, y: 0, text: 'x' }] } };
    expect(moved(undoStep(recordStep(emptyHistory, before, after), after)).row).toEqual(before);
  });
});
