import { describe, expect, it } from 'vitest';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import { drawnArrows, noteLinkLines, noteLinkNeighbours } from './connections.js';
import { curvedRoute, nearestSides, textHeight } from './geometry.js';
import { boardEntries } from './model.js';
import { placeBoard } from './placement.js';

const nb = 'nb';
const note = (id: string): CompilationItem => ({ id, kind: 'note', notebookId: nb, path: `notes/${id}.md` });
const items: CompilationItem[] = [{ id: 'h', kind: 'heading', title: 'H' }, note('a'), note('b'), note('c')];
const row: CompilationRow = { id: 'c', name: 'C', notebookId: nb, path: 'notes/c.compilation.yml', view: 'board', kind: 'custom', items, board: { sections: [{ item: 'h', x: 0, y: 0, w: 800, h: 400 }], cards: [{ item: 'a', x: 24, y: 48 }, { item: 'b', x: 400, y: 48 }, { item: 'c', x: 24, y: 240 }], texts: [{ id: 't1', x: 1000, y: 0, text: 'Hi' }], arrows: [{ id: 'x1', from: { item: 'a' }, to: { item: 'b' }, label: '提出' }, { id: 'x2', from: { text: 't1' }, to: { item: 'h' } }, { id: 'x3', from: { item: 'a' }, to: { item: 'gone' } }] } };
const board = placeBoard(boardEntries(row, items), row.board!.texts);

describe('geometry', () => {
  it('routes between the nearest facing sides', () => {
    const left = { x: 0, y: 0, w: 100, h: 50 }, right = { x: 300, y: 0, w: 100, h: 50 }, below = { x: 0, y: 200, w: 100, h: 50 };
    expect(nearestSides(left, right)).toMatchObject({ start: { x: 100, y: 25 }, end: { x: 300, y: 25 } });
    expect(nearestSides(left, below)).toMatchObject({ start: { x: 50, y: 50 }, end: { x: 50, y: 200 } });
    const curve = curvedRoute(left, right);
    expect(curve.path.startsWith('M 100 25 C')).toBe(true);
    expect(curve.middle).toEqual({ x: 200, y: 25 });
  });

  it('estimates text height from its lines and width', () => {
    expect(textHeight('one')).toBeLessThan(textHeight('one\ntwo'));
    expect(textHeight('字'.repeat(40), 200)).toBeGreaterThan(textHeight('字'.repeat(10), 200));
  });
});

describe('drawnArrows', () => {
  it('draws arrows between cards, sections and texts, and skips one whose end is not on the board', () => {
    const arrows = drawnArrows(board, row.board!.arrows);
    expect(arrows.map(arrow => [arrow.id, arrow.from, arrow.to, arrow.label])).toEqual([['x1', 'card:a', 'card:b', '提出'], ['x2', 'text:t1', 'section:h', undefined]]);
  });

  it('finds a dynamic end by member path', () => {
    const dynamic: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 't', notebookId: nb } };
    const placed = placeBoard(boardEntries(dynamic, [{ id: 'dynamic:d:notes/a.md', kind: 'note', notebookId: nb, path: 'notes/a.md' }, { id: 'dynamic:d:notes/b.md', kind: 'note', notebookId: nb, path: 'notes/b.md' }]));
    expect(drawnArrows(placed, [{ id: 'p', from: { path: 'notes/a.md' }, to: { path: 'notes/b.md' } }, { id: 'q', from: { path: 'notes/a.md' }, to: { path: 'notes/left.md' } }]).map(arrow => arrow.id)).toEqual(['p']);
  });
});

describe('noteLinkLines', () => {
  it('draws one line per linked pair, whichever direction, and none to notes off the board', () => {
    const key = (id: string) => `${nb}:notes/${id}.md`;
    const lines = noteLinkLines(board.cards, [{ source: key('a'), target: key('b') }, { source: key('b'), target: key('a') }, { source: key('c'), target: key('a') }, { source: key('a'), target: `${nb}:notes/elsewhere.md` }, { source: key('a'), target: key('a') }]);
    expect(lines.map(line => [line.a, line.b])).toEqual([['a', 'b'], ['c', 'a']]);
    expect(noteLinkNeighbours(lines).get('a')).toEqual(['b', 'c']);
  });
});
