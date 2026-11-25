import { describe, expect, it } from 'vitest';
import { compilationChapters, compilationFile, type CompilationItem, type CompilationRow, parseCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
import { addBeside, addNote, boardNotes, sectionAt } from './add.js';
import { rectsOverlap } from './geometry.js';
import { boardEntries } from './model.js';
import { placeBoard } from './placement.js';

const nb = 'nb';
const note = (id: string, path = `notes/${id}.md`): CompilationItem => ({ id, kind: 'note', notebookId: nb, path });
const heading = (id: string, title = id): CompilationItem => ({ id, kind: 'heading', title });
const custom = (items: CompilationItem[], board?: CompilationRow['board']): CompilationRow => ({ id: 'c', name: 'C', notebookId: nb, path: 'notes/c.compilation.yml', view: 'board', kind: 'custom', items, ...(board ? { board } : {}) });
const place = (row: CompilationRow) => placeBoard(boardEntries(row, row.kind === 'custom' ? row.items : []), row.board?.texts);
const book = (row: CompilationRow) => row.kind === 'custom' ? compilationChapters(row.items).map(chapter => `${chapter.heading?.title ?? '·'}: ${chapter.items.map(item => item.id).join(' ')}`) : [];
const card = (row: CompilationRow, item: string) => row.board?.cards?.find(entry => 'item' in entry && entry.item === item);
const ids = (...values: string[]) => {
  let next = 0;
  return () => values[next++];
};
const ref = (name: string) => ({ notebookId: nb, path: `notes/${name}.md` });

// Two sections side by side: h1 holds a and b, h2 holds c; d stands before the first heading.
const two = () => custom([note('d'), heading('h1', 'One'), note('a'), note('b'), heading('h2', 'Two'), note('c')], { sections: [{ item: 'h1', x: 0, y: 0, w: 288, h: 384 }, { item: 'h2', x: 400, y: 0, w: 560, h: 384 }], cards: [{ item: 'a', x: 24, y: 56 }, { item: 'b', x: 24, y: 216 }, { item: 'c', x: 424, y: 56 }, { item: 'd', x: -400, y: 0 }] });

describe('addNote', () => {
  it('adds a dropped note in the section it lands in, its card centred on the drop point', () => {
    const row = two();
    const result = addNote(row, place(row), ref('new'), { at: { x: 800, y: 300 }, makeId: ids('n1') });
    expect(result.added).toEqual(['n1']);
    expect(book(result.row)).toEqual(['·: d', 'One: a b', 'Two: c n1']);
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 680, y: 236 });
    // The file opens again with the new item and its card.
    const file = parseCompilation(serializeCompilation(compilationFile(result.row)));
    expect(file.items?.find(item => item.id === 'n1')).toEqual({ id: 'n1', kind: 'note', path: 'notes/new.md' });
  });

  it('adds a note dropped outside every section ahead of the first heading, in no chapter', () => {
    const row = two();
    const result = addNote(row, place(row), ref('new'), { at: { x: 200, y: 900 }, makeId: ids('n1') });
    expect(book(result.row)).toEqual(['·: d', '·: n1', 'One: a b', 'Two: c']);
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 80, y: 836 });
  });

  it('adds to a board with no headings at the end', () => {
    const row = custom([note('a')]);
    expect(book(addNote(row, place(row), ref('new'), { at: { x: 0, y: 0 }, makeId: ids('n1') }).row)).toEqual(['·: a', '·: n1']);
  });

  it('puts a note in a named section’s chapter at the point, whichever section the point lands in', () => {
    const row = two();
    const result = addNote(row, place(row), ref('new'), { at: { x: 800, y: 300 }, section: 'h1', clear: true, makeId: ids('n1') });
    expect(book(result.row)).toEqual(['·: d', 'One: a b n1', 'Two: c']);
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 680, y: 236 });
  });

  it('refuses a pending live note, by its virtual path or its live state', () => {
    const row = two();
    expect(addNote(row, place(row), { notebookId: nb, path: 'notes/.live/abc123.md' }, { at: { x: 0, y: 900 } })).toEqual({ row, added: [], refused: 'pendingNote' });
    expect(addNote(row, place(row), { ...ref('new'), live: { pending: true } }).refused).toBe('pendingNote');
  });

  it('moves a card added at a spot down until it covers no other card', () => {
    const row = two();
    const result = addNote(row, place(row), ref('new'), { at: { x: 144, y: 120 }, clear: true, makeId: ids('n1') });
    const added = card(result.row, 'n1')!;
    expect(added.x).toBe(24);
    expect(place(result.row).cards.filter(entry => entry.key !== 'n1').some(other => rectsOverlap(other.rect, { x: added.x, y: added.y, w: 240, h: 128 }))).toBe(false);
  });

  it('finds a note already on the board instead of adding it again, a heading-anchored item included', () => {
    const row = two();
    const result = addNote(row, place(row), ref('b'), { at: { x: 800, y: 300 } });
    expect(result).toEqual({ row, added: [], found: 'b' });
    const anchored = custom([{ ...note('x', 'notes/k.md'), kind: 'note', anchor: 'Intro' } as CompilationItem]);
    expect(addNote(anchored, place(anchored), ref('k')).found).toBe('x');
  });

  it('refuses a note past the item limit of 100, with the limit as the reason', () => {
    const row = custom(Array.from({ length: 100 }, (_, index) => note(`i${index}`)));
    const result = addNote(row, place(row), ref('new'), { at: { x: 0, y: 0 } });
    expect(result).toEqual({ row, added: [], refused: 'itemLimit' });
    // Headings do not count toward it.
    const headed = custom([heading('h'), ...Array.from({ length: 99 }, (_, index) => note(`i${index}`))]);
    expect(addNote(headed, place(headed), ref('new')).added).toHaveLength(1);
  });

  it('refuses on a dynamic board, whose cards come from its query', () => {
    const row: CompilationRow = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 'x', notebookId: nb } };
    expect(addNote(row, place(row), ref('new')).refused).toBe('dynamicItems');
  });
});

describe('addBeside', () => {
  it('adds the notes to the card’s chapter in a column to its right, clear of other cards, text and other sections', () => {
    const row = custom([heading('h1', 'One'), note('a'), note('b'), heading('h2', 'Two'), note('c')], { sections: [{ item: 'h1', x: 0, y: 0, w: 560, h: 384 }, { item: 'h2', x: 0, y: 500, w: 288, h: 176 }], cards: [{ item: 'a', x: 24, y: 56 }, { item: 'b', x: 288, y: 56 }, { item: 'c', x: 24, y: 556 }] });
    const result = addBeside(row, place(row), 'a', [ref('p'), ref('q')], ids('n1', 'n2'));
    expect(result.added).toEqual(['n1', 'n2']);
    expect(book(result.row)).toEqual(['One: a b n1 n2', 'Two: c']);
    // b stands right of a, so the column goes one further.
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 552, y: 56 });
    expect(card(result.row, 'n2')).toEqual({ item: 'n2', x: 552, y: 208 });
    const drawn = place(result.row).cards;
    for (const added of drawn.filter(entry => entry.key.startsWith('n'))) expect(drawn.filter(other => other.key !== added.key).some(other => rectsOverlap(other.rect, added.rect))).toBe(false);
  });

  it('adds beside a card in no chapter ahead of the first heading, skipping notes the board shows and repeats', () => {
    const row = two();
    const result = addBeside(row, place(row), 'd', [ref('p'), ref('a'), ref('p')], ids('n1'));
    expect(result.added).toEqual(['n1']);
    expect(book(result.row)).toEqual(['·: d', '·: n1', 'One: a b', 'Two: c']);
    // Right of d stand both sections, so the column goes on past them, top aligned with d.
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 984, y: 0 });
  });

  it('keeps the column right of the card when another section stands beside its own, past that section and its cards', () => {
    const row = two();
    const result = addBeside(row, place(row), 'a', [ref('p')], ids('n1'));
    expect(book(result.row)).toEqual(['·: d', 'One: a b n1', 'Two: c']);
    // Past Two (to 960), top aligned with a.
    expect(card(result.row, 'n1')).toEqual({ item: 'n1', x: 984, y: 56 });
    const drawn = place(result.row), added = drawn.cards.find(entry => entry.key === 'n1')!.rect;
    expect(drawn.cards.filter(other => other.key !== 'n1').some(other => rectsOverlap(other.rect, added))).toBe(false);
    expect(rectsOverlap(drawn.sections.find(section => section.key === 'h2')!.rect, added)).toBe(false);
  });

  it('skips pending live notes', () => {
    const row = two();
    const result = addBeside(row, place(row), 'a', [{ notebookId: nb, path: 'notes/.live/abc123.md' }, ref('p')], ids('n1'));
    expect(result.added).toEqual(['n1']);
    expect(book(result.row)).toEqual(['·: d', 'One: a b n1', 'Two: c']);
  });

  it('keeps the column clear of free text', () => {
    const row = custom([note('a')], { cards: [{ item: 'a', x: 0, y: 0 }], texts: [{ id: 't1', x: 300, y: 40, text: 'note to self' }] });
    // Shifted right past the text's 240 units from 300.
    expect(card(addBeside(row, place(row), 'a', [ref('p')], ids('n1')).row, 'n1')).toEqual({ item: 'n1', x: 564, y: 0 });
  });

  it('refuses notes that would take the board past its item limit', () => {
    const row = custom(Array.from({ length: 99 }, (_, index) => note(`i${index}`)));
    expect(addBeside(row, place(row), 'i0', [ref('p'), ref('q')]).refused).toBe('itemLimit');
  });
});

describe('boardNotes and sectionAt', () => {
  it('maps each note on the board to its first card, and a point to the section that holds it', () => {
    const row = two();
    const placed = place(row);
    expect([...boardNotes(placed)]).toEqual([['nb:notes/d.md', 'd'], ['nb:notes/a.md', 'a'], ['nb:notes/b.md', 'b'], ['nb:notes/c.md', 'c']]);
    expect(sectionAt(placed, { x: 100, y: 100 })).toBe('h1');
    expect(sectionAt(placed, { x: 500, y: 100 })).toBe('h2');
    expect(sectionAt(placed, { x: 350, y: 100 })).toBeUndefined();
  });
});
