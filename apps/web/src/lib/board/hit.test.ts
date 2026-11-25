import { describe, expect, it } from 'vitest';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import { elementAt, elementsInBox, onSectionTitle, spanRect } from './hit.js';
import { boardEntries } from './model.js';
import { placeBoard } from './placement.js';

const items: CompilationItem[] = [{ id: 'h', kind: 'heading', title: 'H' }, { id: 'a', kind: 'note', notebookId: 'nb', path: 'notes/a.md' }, { id: 'b', kind: 'note', notebookId: 'nb', path: 'notes/b.md' }];
const row: CompilationRow = { id: 'c', name: 'C', notebookId: 'nb', path: 'p', view: 'board', kind: 'custom', items, board: { sections: [{ item: 'h', x: 0, y: 0, w: 560, h: 200 }], cards: [{ item: 'a', x: 24, y: 48 }, { item: 'b', x: 288, y: 48 }], texts: [{ id: 't', x: 700, y: 0, text: 'note' }] } };
const board = placeBoard(boardEntries(row, items), row.board?.texts);

describe('board hit testing', () => {
  it('finds the topmost element at a point: text, card, then section', () => {
    expect(elementAt(board, { x: 30, y: 60 })).toBe('card:a');
    expect(elementAt(board, { x: 10, y: 10 })).toBe('section:h');
    expect(elementAt(board, { x: 710, y: 10 })).toBe('text:t');
    expect(elementAt(board, { x: -50, y: -50 })).toBeUndefined();
    expect(onSectionTitle(board, 'h', { x: 10, y: 10 })).toBe(true);
    expect(onSectionTitle(board, 'h', { x: 10, y: 100 })).toBe(false);
  });

  it('frames what a box touches, and a section only when it holds it whole', () => {
    expect(elementsInBox(board, spanRect({ x: 100, y: 100 }, { x: 300, y: 120 }))).toEqual(['card:a', 'card:b']);
    expect(elementsInBox(board, spanRect({ x: 1000, y: 300 }, { x: -10, y: -10 }))).toEqual(['section:h', 'card:a', 'card:b', 'text:t']);
  });
});
