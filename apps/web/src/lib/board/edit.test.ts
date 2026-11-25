import { describe, expect, it } from 'vitest';
import { compilationChapters, compilationFile, type CompilationItem, type CompilationRow, compilationRow, parseCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
import { addArrow, addText, boardId, createSection, editText, endOf, labelArrow, moveSelection, removeSelection, renameSection, resizeSection, setTextColor, usedLabels } from './edit.js';
import { boardEntries } from './model.js';
import { placeBoard } from './placement.js';

const nb = 'nb';
const note = (id: string, path = `notes/${id}.md`): CompilationItem => ({ id, kind: 'note', notebookId: nb, path });
const heading = (id: string, title = id): CompilationItem => ({ id, kind: 'heading', title });
const custom = (items: CompilationItem[], board?: CompilationRow['board']): CompilationRow => ({ id: 'c', name: 'C', notebookId: nb, path: 'notes/c.compilation.yml', view: 'board', kind: 'custom', items, ...(board ? { board } : {}) });
const place = (row: CompilationRow, items = row.kind === 'custom' ? row.items : []) => placeBoard(boardEntries(row, items), row.board?.texts);
const ids = (row: CompilationRow) => row.kind === 'custom' ? row.items.map(item => item.id) : [];
/** The book's chapters: each heading's title and its items, `·` for an item before the first heading. */
const book = (row: CompilationRow) => row.kind === 'custom' ? compilationChapters(row.items).map(chapter => `${chapter.heading?.title ?? '·'}: ${chapter.items.map(item => item.id).join(' ')}`) : [];
const card = (row: CompilationRow, item: string) => row.board?.cards?.find(entry => 'item' in entry && entry.item === item);
/** The row written and read back, as the file would hold it. */
const written = (row: CompilationRow) => parseCompilation(serializeCompilation(compilationFile(row)));

// Two sections side by side: h1 holds a and b, h2 holds c; d stands before the first heading.
const two = () => custom([note('d'), heading('h1', 'One'), note('a'), note('b'), heading('h2', 'Two'), note('c')], { sections: [{ item: 'h1', x: 0, y: 0, w: 288, h: 384 }, { item: 'h2', x: 400, y: 0, w: 560, h: 384 }], cards: [{ item: 'a', x: 24, y: 56 }, { item: 'b', x: 24, y: 216 }, { item: 'c', x: 424, y: 56 }, { item: 'd', x: -400, y: 0 }], arrows: [{ id: 'ar1', from: { item: 'a' }, to: { item: 'c' }, label: '提出' }, { id: 'ar2', from: { item: 'h1' }, to: { item: 'h2' } }] });

describe('moveSelection', () => {
  it('moves a card inside its section without changing its chapter', () => {
    const row = two();
    const { row: next } = moveSelection(row, place(row), ['card:a'], 8, 40);
    expect(card(next, 'a')).toEqual({ item: 'a', x: 32, y: 96 });
    expect(ids(next)).toEqual(ids(row));
  });

  it('moves a card dropped across sections to the end of that chapter, and the book follows', () => {
    const row = two();
    const { row: next } = moveSelection(row, place(row), ['card:a'], 680, 160);
    expect(book(next)).toEqual(['·: d', 'One: b', 'Two: c a']);
    expect(card(next, 'a')).toEqual({ item: 'a', x: 704, y: 216 });
    expect(book(compilationRow(written(next), { notebookId: nb, path: 'p' }))).toEqual(['·: d', 'One: b', 'Two: c a']);
  });

  it('moves a card dropped outside every section ahead of the first heading, after the items already there', () => {
    const row = two();
    const { row: next } = moveSelection(row, place(row), ['card:b'], 0, 600);
    expect(book(next)).toEqual(['·: d', '·: b', 'One: a', 'Two: c']);
  });

  it('moves a free card dropped into a section into its chapter, and several in their order', () => {
    const row = custom([note('x'), note('y'), heading('h', 'H'), note('a')], { sections: [{ item: 'h', x: 0, y: 0, w: 800, h: 400 }], cards: [{ item: 'x', x: 0, y: 600 }, { item: 'y', x: 300, y: 600 }, { item: 'a', x: 24, y: 56 }] });
    const { row: next } = moveSelection(row, place(row), ['card:y', 'card:x'], 0, -400);
    expect(book(next)).toEqual(['H: a x y']);
  });

  it('carries a section’s cards, auto-placed ones included, and keeps its size', () => {
    const row = custom([heading('h', 'H'), note('a'), note('b')], { sections: [{ item: 'h', x: 0, y: 0, w: 560, h: 200 }], cards: [{ item: 'a', x: 24, y: 48 }] });
    const placed = place(row);
    const b = placed.cards.find(entry => entry.key === 'b')!;
    const { row: next } = moveSelection(row, placed, ['section:h'], 100, 50);
    expect(next.board?.sections).toEqual([{ item: 'h', x: 100, y: 50, w: 560, h: 200 }]);
    expect(card(next, 'a')).toEqual({ item: 'a', x: 124, y: 98 });
    expect(card(next, 'b')).toEqual({ item: 'b', x: b.rect.x + 100, y: b.rect.y + 50 });
    expect(ids(next)).toEqual(ids(row));
  });

  it('stores a section that had no rectangle at the one it is drawn with', () => {
    const row = custom([heading('h', 'H'), note('a')], { cards: [{ item: 'a', x: 24, y: 48 }] });
    const placed = place(row);
    const { row: next } = moveSelection(row, placed, ['section:h'], 10, 0);
    const drawn = placed.sections[0].frame;
    expect(next.board?.sections).toEqual([{ item: 'h', x: drawn.x + 10, y: drawn.y, w: drawn.w, h: drawn.h }]);
  });

  it('moves texts and writes nothing for no movement', () => {
    const row = custom([note('a')], { texts: [{ id: 't1', x: 10, y: 10, text: 'hi' }] });
    const placed = place(row);
    expect(moveSelection(row, placed, ['text:t1'], 0, 0).row).toBe(row);
    expect(moveSelection(row, placed, ['text:t1'], -8.4, 40).row.board?.texts).toEqual([{ id: 't1', x: 2, y: 50, text: 'hi' }]);
  });

  it('on a dynamic board grouped by folder, refuses a card leaving its folder’s section, unless previewing the drag', () => {
    const row: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'folder', path: 'notes', recursive: true, notebookId: nb }, group: 'folder', board: { sections: [{ folder: 'notes/a', x: 0, y: 0 }] } };
    const items: CompilationItem[] = [{ id: 'g1', kind: 'heading', title: 'A' }, note('m1', 'notes/a/one.md'), note('m2', 'notes/a/two.md')];
    const placed = place(row, items);
    const moved = moveSelection(row, placed, ['card:m1', 'card:m2'], 2000, 0);
    expect(moved.refused).toBe('folderSection');
    expect(moved.row.board?.cards ?? []).toEqual([]);
    const inside = moveSelection(row, placed, ['card:m1'], 4, 4);
    expect(inside.refused).toBeUndefined();
    expect(inside.row.board?.cards).toEqual([{ path: 'notes/a/one.md', x: placed.cards[0].rect.x + 4, y: placed.cards[0].rect.y + 4 }]);
    expect(moveSelection(row, placed, ['card:m1'], 2000, 0, { preview: true }).row.board?.cards).toHaveLength(1);
    // Its section moves, by position only.
    expect(moveSelection(row, placed, ['section:g1'], 20, 0).row.board?.sections).toEqual([{ folder: 'notes/a', x: 20, y: 0 }]);
  });
});

describe('sections', () => {
  it('creates a section from a drawn rectangle: its heading last, the cards centred inside joining its chapter in order', () => {
    const row = custom([note('x'), note('y'), heading('h', 'H'), note('a'), note('z')], { sections: [{ item: 'h', x: 0, y: 0, w: 560, h: 200 }], cards: [{ item: 'x', x: 0, y: 600 }, { item: 'y', x: 300, y: 600 }, { item: 'a', x: 24, y: 48 }, { item: 'z', x: 600, y: 900 }] });
    const placed = place(row);
    const { row: next } = createSection(row, placed, { x: -20, y: 560, w: 600, h: 200 }, { id: 'new1', title: '新區塊' });
    expect(book(next)).toEqual(['H: a z', '新區塊: x y']);
    expect(next.board?.sections?.at(-1)).toEqual({ item: 'new1', x: -20, y: 560, w: 600, h: 200 });
    expect(written(next).items?.at(-3)).toEqual({ id: 'new1', kind: 'heading', title: '新區塊' });
  });

  it('pins the auto-placed cards it takes where they are drawn, and grows a small rectangle to the minimum size', () => {
    const row = custom([note('a')]);
    const placed = place(row);
    const at = placed.cards[0].rect;
    const { row: next } = createSection(row, placed, { x: at.x + 100, y: at.y + 40, w: 20, h: 20 }, { id: 's', title: 'S' });
    expect(next.board?.sections).toEqual([{ item: 's', x: at.x + 100, y: at.y + 40, w: 288, h: 176 }]);
    expect(book(next)).toEqual(['S: a']);
    expect(card(next, 'a')).toEqual({ item: 'a', x: at.x, y: at.y });
  });

  it('refuses sections on a dynamic board, and past the heading limit', () => {
    const dynamic: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 't', notebookId: nb } };
    expect(createSection(dynamic, place(dynamic, []), { x: 0, y: 0, w: 300, h: 300 }, { id: 's', title: 'S' }).refused).toBe('dynamicSections');
    const full = custom(Array.from({ length: 100 }, (_, index) => heading(`h${index}`)));
    expect(createSection(full, place(full), { x: 0, y: 0, w: 300, h: 300 }, { id: 's', title: 'S' }).refused).toBe('sectionLimit');
  });

  it('resizes and renames a section, which renames its chapter', () => {
    const row = two();
    expect(resizeSection(row, 'h1', { x: 0, y: 0, w: 100.4, h: 900.6 }).row.board?.sections?.[0]).toEqual({ item: 'h1', x: 0, y: 0, w: 288, h: 901 });
    expect(book(renameSection(row, 'h2', '  二、德性  ').row)).toEqual(['·: d', 'One: a b', '二、德性: c']);
    expect(renameSection(row, 'h2', '   ').row).toBe(row);
  });
});

describe('removeSelection', () => {
  it('removes a card’s item and the arrows ending on it', () => {
    const row = two();
    const { row: next } = removeSelection(row, place(row), ['card:a']);
    expect(ids(next)).toEqual(['d', 'h1', 'b', 'h2', 'c']);
    expect(card(next, 'a')).toBeUndefined();
    expect(next.board?.arrows?.map(arrow => arrow.id)).toEqual(['ar2']);
  });

  it('deletes a section: its items move ahead of the first heading, their cards stay, its arrows go', () => {
    const row = two();
    const placed = place(row);
    const { row: next } = removeSelection(row, placed, ['section:h1']);
    expect(book(next)).toEqual(['·: d', '·: a', '·: b', 'Two: c']);
    expect(next.board?.sections).toEqual([{ item: 'h2', x: 400, y: 0, w: 560, h: 384 }]);
    expect(card(next, 'a')).toEqual({ item: 'a', x: 24, y: 56 });
    expect(next.board?.arrows?.map(arrow => arrow.id)).toEqual(['ar1']);
    expect(() => written(next)).not.toThrow();
  });

  it('keeps a deleted section’s cards even when the selection holds them too, as a box around the section does', () => {
    const row = two();
    const { row: next } = removeSelection(row, place(row), ['section:h1', 'card:a', 'card:b', 'card:c']);
    expect(book(next)).toEqual(['·: d', '·: a', '·: b', 'Two: ']);
    // Only c (in a section that stays) and the arrows on c and h1 go.
    expect(next.board?.arrows).toBeUndefined();
    expect(card(next, 'a')).toEqual({ item: 'a', x: 24, y: 56 });
  });

  it('removes texts and arrows, pruning arrows that end on a removed text; a dynamic board keeps its cards', () => {
    const row = custom([note('a')], { texts: [{ id: 't1', x: 0, y: 0, text: 'x' }], arrows: [{ id: 'q1', from: { text: 't1' }, to: { item: 'a' } }, { id: 'q2', from: { item: 'a' }, to: { text: 't1' } }] });
    expect(removeSelection(row, place(row), ['text:t1']).row.board).toEqual({});
    expect(removeSelection(row, place(row), ['arrow:q2']).row.board?.arrows?.map(arrow => arrow.id)).toEqual(['q1']);
    const dynamic: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 't', notebookId: nb }, board: { cards: [{ path: 'notes/m.md', x: 0, y: 0 }] } };
    expect(removeSelection(dynamic, place(dynamic, [note('m', 'notes/m.md')]), ['card:m']).row.board?.cards).toHaveLength(1);
  });
});

describe('text and arrows', () => {
  it('adds, rewrites, colours and, emptied, removes a text with its arrows', () => {
    const row = custom([note('a')]);
    expect(addText(row, { id: 't', x: 1.6, y: 2, text: '  ' }).row).toBe(row);
    const added = addText(row, { id: 't', x: 1.6, y: 2, text: '口試前\n要定案' }).row;
    expect(added.board?.texts).toEqual([{ id: 't', x: 2, y: 2, text: '口試前\n要定案' }]);
    expect(editText(added, 't', 'later').row.board?.texts?.[0].text).toBe('later');
    expect(setTextColor(added, 't', 'teal').row.board?.texts?.[0].color).toBe('teal');
    const linked = addArrow(added, { id: 'r', from: { text: 't' }, to: { item: 'a' } }).row;
    expect(editText(linked, 't', ' \n ').row.board).toEqual({});
  });

  it('draws arrows with an optional label, refusing one from an element to itself, and relabels them', () => {
    const row = custom([note('a'), note('b')]);
    expect(addArrow(row, { id: 'r', from: { item: 'a' }, to: { item: 'a' } }).refused).toBe('arrowEnds');
    const drawn = addArrow(row, { id: 'r', from: { item: 'a' }, to: { item: 'b' }, label: '  提出 ' }).row;
    expect(drawn.board?.arrows).toEqual([{ id: 'r', from: { item: 'a' }, to: { item: 'b' }, label: '提出' }]);
    expect(labelArrow(drawn, 'r', '').row.board?.arrows).toEqual([{ id: 'r', from: { item: 'a' }, to: { item: 'b' } }]);
    expect(usedLabels(addArrow(drawn, { id: 's', from: { item: 'b' }, to: { item: 'a' }, label: '回應' }).row)).toEqual(['提出', '回應']);
    expect(addArrow(custom([], { arrows: Array.from({ length: 600 }, (_, index) => ({ id: `a${index}`, from: { text: 'x' }, to: { text: 'y' } })) }), { id: 'z', from: { item: 'a' }, to: { item: 'b' } }).refused).toBe('arrowLimit');
  });

  it('names arrow ends by item, heading, text or member path; a dynamic folder section is no end', () => {
    const row = two();
    const placed = place(row);
    expect(endOf(row, placed, 'card:a')).toEqual({ item: 'a' });
    expect(endOf(row, placed, 'section:h1')).toEqual({ item: 'h1' });
    expect(endOf(row, placed, 'text:none')).toBeUndefined();
    const dynamic: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'folder', path: 'notes', recursive: true, notebookId: nb }, group: 'folder' };
    const items: CompilationItem[] = [{ id: 'g1', kind: 'heading', title: 'A' }, note('m1', 'notes/a/one.md')];
    const dynamicPlaced = place(dynamic, items);
    expect(endOf(dynamic, dynamicPlaced, 'card:m1')).toEqual({ path: 'notes/a/one.md' });
    expect(endOf(dynamic, dynamicPlaced, 'section:g1')).toBeUndefined();
  });

  it('makes ids of eight characters of [a-z0-9] that no item, text or arrow uses', () => {
    const row = custom([note('aaaaaaaa')]);
    const sequence = [0, 0, 0, 0, 0, 0, 0, 0, .99, .99, .99, .99, .99, .99, .99, .99];
    let at = 0;
    expect(boardId(row, () => sequence[at++])).toBe('99999999');
    expect(boardId(row)).toMatch(/^[a-z0-9]{8}$/);
  });
});
