import { describe, expect, it } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyHistory, recordStep, redoStep, undoStep } from './history.js';

const row = (x: number, name = 'C'): CompilationRow => ({ id: 'c', name, notebookId: 'nb', path: 'p', view: 'board', kind: 'custom', items: [{ id: 'a', kind: 'note', notebookId: 'nb', path: 'notes/a.md' }], board: { cards: [{ item: 'a', x, y: 0 }] } });

describe('board history', () => {
  it('undoes and redoes gestures one step each, keeping fields the board does not edit', () => {
    let history = recordStep(emptyHistory, row(0), row(10));
    history = recordStep(history, row(10), row(20));
    const undone = undoStep(history, row(20, 'Renamed'))!;
    expect(undone.row).toEqual(row(10, 'Renamed'));
    const twice = undoStep(undone.history, undone.row)!;
    expect(twice.row.board?.cards?.[0]).toEqual({ item: 'a', x: 0, y: 0 });
    expect(undoStep(twice.history, twice.row)).toBeUndefined();
    const redone = redoStep(twice.history, twice.row)!;
    expect(redone.row.board?.cards?.[0]).toEqual({ item: 'a', x: 10, y: 0 });
    // A new gesture drops what was undone.
    expect(recordStep(redone.history, redone.row, row(5)).future).toEqual([]);
  });

  it('puts back a board the row had none of before', () => {
    const before: CompilationRow = { id: 'c', name: 'C', notebookId: 'nb', path: 'p', view: 'board', kind: 'custom', items: [] };
    const after = { ...before, board: { texts: [{ id: 't', x: 0, y: 0, text: 'x' }] } };
    expect(undoStep(recordStep(emptyHistory, before, after), after)!.row).toEqual(before);
  });
});
