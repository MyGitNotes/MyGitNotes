import { describe, expect, it } from 'vitest';
import { type CompilationItem, type CompilationRow, compilationRow, parseCompilation } from '@mygitnotes/core/compilation';
import { rectsOverlap } from './geometry.js';
import { boardEntries } from './model.js';
import { placeBoard } from './placement.js';

const nb = 'nb';
const note = (id: string, path = `notes/${id}.md`): CompilationItem => ({ id, kind: 'note', notebookId: nb, path });
const heading = (id: string, title = id): CompilationItem => ({ id, kind: 'heading', title });
const custom = (items: CompilationItem[], board?: CompilationRow['board']): CompilationRow => ({ id: 'c', name: 'C', notebookId: nb, path: 'notes/c.compilation.yml', view: 'board', kind: 'custom', items, ...(board ? { board } : {}) });
const place = (row: CompilationRow, items = row.kind === 'custom' ? row.items : []) => placeBoard(boardEntries(row, items), row.board?.texts);
const noOverlap = (rects: { x: number; y: number; w: number; h: number; }[]) => {
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) expect(rectsOverlap(rects[a], rects[b]), `${a} overlaps ${b}`).toBe(false);
};

describe('placeBoard', () => {
  it('draws the spec example where the file places it', () => {
    const raw = `version: 1
id: chapter-3
title: 第三章：德性與依據
arrangement: board
items:
  - { id: h1, kind: heading, title: 一、問題 }
  - { id: n1, kind: note, path: notes/thesis/a.md }
  - { id: n2, kind: note, path: notes/thesis/b.md }
  - { id: h2, kind: heading, title: 二、德性知識論 }
  - { id: n3, kind: note, path: notes/thesis/c.md }
board:
  sections:
    - { item: h1, x: 0, y: 0, w: 288, h: 384 }
    - { item: h2, x: 336, y: 0, w: 560, h: 384 }
  cards:
    - { item: n1, x: 24, y: 56 }
    - { item: n2, x: 24, y: 216 }
    - { item: n3, x: 360, y: 56 }
  texts:
    - { id: t8k2m, x: 960, y: 240, w: 200, text: "口試前要定案：\\n德性是否必要？", color: teal }
`;
    const row = compilationRow(parseCompilation(raw), { notebookId: nb, path: 'notes/thesis/c.compilation.yml' });
    const board = place(row);
    expect(board.cards.map(card => [card.key, card.rect.x, card.rect.y, card.placed, card.section])).toEqual([['n1', 24, 56, true, 'h1'], ['n2', 24, 216, true, 'h1'], ['n3', 360, 56, true, 'h2']]);
    expect(board.sections.map(section => [section.key, section.rect])).toEqual([['h1', { x: 0, y: 0, w: 288, h: 384 }], ['h2', { x: 336, y: 0, w: 560, h: 384 }]]);
    expect(board.texts[0].rect).toMatchObject({ x: 960, y: 240, w: 200 });
    expect(board.bounds).toMatchObject({ x: 0, y: 0 });
  });

  it("flows a section's unplaced cards in rows of its inner width around its stored cards, growing it downward", () => {
    const row = custom([heading('h'), note('a'), note('b'), note('c'), note('d')], { sections: [{ item: 'h', x: 0, y: 0, w: 560, h: 200 }], cards: [{ item: 'a', x: 24, y: 56 }] });
    const board = place(row);
    const at = (key: string) => board.cards.find(card => card.key === key)!;
    expect(at('a').placed).toBe(true);
    // Two columns fit 560 units; the first slot is the stored card's, so the flow fills the slots after it.
    expect([at('b').rect.x, at('b').rect.y]).toEqual([24 + 240 + 24, 48]);
    expect([at('c').rect.x, at('c').rect.y]).toEqual([24, 48 + 128 + 24]);
    expect([at('d').rect.x, at('d').rect.y]).toEqual([288, 200]);
    expect(at('d').placed).toBe(false);
    const section = board.sections[0].rect;
    expect(section).toMatchObject({ x: 0, y: 0, w: 560 });
    expect(section.y + section.h).toBe(at('d').rect.y + 128 + 24);
    noOverlap(board.cards.map(card => card.rect));
  });

  it('grows a section to include a card stored outside it, which stays where it is stored', () => {
    const row = custom([heading('h'), note('a')], { sections: [{ item: 'h', x: 0, y: 0, w: 288, h: 200 }], cards: [{ item: 'a', x: 600, y: 400 }] });
    const board = place(row);
    expect(board.cards[0].rect).toMatchObject({ x: 600, y: 400 });
    expect(board.sections[0].rect).toEqual({ x: 0, y: 0, w: 600 + 240 + 24, h: 400 + 128 + 24 });
  });

  it('puts sections with no stored rectangle in a row below the content, sized to hold their cards', () => {
    const row = custom([heading('h1'), note('a'), heading('h2'), note('b'), note('c'), note('d'), note('e')], { sections: [{ item: 'h1', x: 0, y: 0, w: 288, h: 200 }] });
    const board = place(row);
    const h2 = board.sections.find(section => section.key === 'h2')!;
    expect(h2.rect.y).toBe(200 + 72);
    expect(h2.rect.x).toBe(0);
    // Four cards: three columns, two rows.
    expect(h2.rect.w).toBe(3 * 240 + 2 * 24 + 48);
    expect(h2.rect.h).toBe(48 + 2 * 128 + 24 + 24);
    for (const key of ['b', 'c', 'd', 'e']) expect(rectsOverlap(board.cards.find(card => card.key === key)!.rect, h2.rect)).toBe(true);
    noOverlap(board.sections.map(section => section.rect));
    noOverlap(board.cards.map(card => card.rect));
  });

  it('places cards outside every section in a column grid right of the content, top first', () => {
    const row = custom([note('x'), note('y'), note('z'), heading('h'), note('a')], { sections: [{ item: 'h', x: 0, y: 0, w: 288, h: 320 }] });
    const board = place(row);
    const at = (key: string) => board.cards.find(card => card.key === key)!.rect;
    // The content is 320 high: two rows of cards per column.
    expect([at('x').x, at('x').y]).toEqual([288 + 72, 0]);
    expect([at('y').x, at('y').y]).toEqual([288 + 72, 152]);
    expect([at('z').x, at('z').y]).toEqual([288 + 72 + 264, 0]);
    noOverlap(board.cards.map(card => card.rect));
  });

  it('lays out an empty board deterministically: free cards in a square-ish grid from the origin', () => {
    const row = custom(['a', 'b', 'c', 'd', 'e'].map(id => note(id)));
    const first = place(row), second = place(row);
    expect(first).toEqual(second);
    expect(first.cards.map(card => [card.rect.x, card.rect.y])).toEqual([[0, 0], [0, 152], [0, 304], [264, 0], [264, 152]]);
    expect(first.cards.every(card => !card.placed)).toBe(true);
  });

  it('sizes a dynamic folder section from its cards at its stored position', () => {
    const row: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'folder', path: 'notes', recursive: true, notebookId: nb }, group: 'folder', board: { sections: [{ folder: 'notes/alpha', x: 100, y: 100 }] } };
    const items: CompilationItem[] = [heading('group:alpha', 'Alpha'), note('dynamic:d:notes/alpha/a.md', 'notes/alpha/a.md'), note('dynamic:d:notes/alpha/b.md', 'notes/alpha/b.md'), heading('group:beta', 'Beta'), note('dynamic:d:notes/beta/c.md', 'notes/beta/c.md')];
    const board = placeBoard(boardEntries(row, items));
    expect(board.sections.map(section => section.ref)).toEqual([{ folder: 'notes/alpha' }, { folder: 'notes/beta' }]);
    expect(board.sections[0].rect).toEqual({ x: 100, y: 100, w: 2 * 240 + 24 + 48, h: 48 + 128 + 24 });
    expect(board.sections[1].rect.y).toBe(100 + 200 + 72);
    expect(board.cards.map(card => card.ref)).toEqual([{ path: 'notes/alpha/a.md' }, { path: 'notes/alpha/b.md' }, { path: 'notes/beta/c.md' }]);
  });

  it('gives a dynamic compilation without chapters no sections', () => {
    const row: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 't', notebookId: nb }, board: { cards: [{ path: 'notes/a.md', x: 5, y: 6 }, { path: 'notes/gone.md', x: 0, y: 0 }] } };
    const board = placeBoard(boardEntries(row, [note('dynamic:d:notes/a.md', 'notes/a.md'), note('dynamic:d:notes/b.md', 'notes/b.md')]));
    expect(board.sections).toEqual([]);
    expect(board.cards.map(card => [card.rect.x, card.rect.y, card.placed])).toEqual([[5, 6, true], [5 + 240 + 72, 6, false]]);
  });
});
