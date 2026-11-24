import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH, boardCompilation, boardsContaining, compilationFields, compilationFile, type CompilationRow, compilationRow, copyCompilation, parseCompilation, relocateCompilation, serializeCompilation } from './compilation.js';

// The example of the whiteboard spec's file format, byte for byte.
const example = `version: 1
id: chapter-3
title: 第三章：德性與依據
arrangement: board
items:
  - id: h1
    kind: heading
    title: 一、問題
  - id: n1
    kind: note
    path: notes/thesis/第三章導論.md
  - id: n2
    kind: note
    path: notes/thesis/依據關係的因果條件.md
  - id: h2
    kind: heading
    title: 二、德性知識論
  - id: n3
    kind: note
    path: notes/thesis/德性與能力的區分.md
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
  arrows:
    - { id: a3f9q, from: { item: n1 }, to: { item: n2 }, label: 提出 }
    - { id: b7c1z, from: { item: n2 }, to: { item: n3 }, label: 需要 }
`;
const dynamicBoard = `version: 1
id: clues
title: Clues
arrangement: board
source: { kind: folder, path: notes/one/cases }
group: folder
board:
  sections:
    - { folder: notes/one/cases/a, x: 0, y: 0 }
  cards:
    - { path: notes/one/cases/a/x.md, x: 24, y: 56 }
    - { path: notes/one/cases/b/y.md, x: 400, y: 56 }
  texts:
    - { id: t1, x: 0, y: 600, text: Open }
  arrows:
    - { id: a1, from: { path: notes/one/cases/a/x.md }, to: { path: notes/one/cases/b/y.md } }
    - { id: a2, from: { text: t1 }, to: { path: notes/one/cases/a/x.md } }
`;
const owner = { notebookId: 'thesis', path: 'notes/thesis/chapter-3.compilation.yml' };
const scope = ['notes/thesis', 'notes/one'];
const custom = (row: CompilationRow) => {
  if (row.kind !== 'custom') throw new Error('expected a custom row');
  return row;
};

describe('board format', () => {
  it('reads the example and writes it back byte for byte, through the file and the lane model', () => {
    const file = parseCompilation(example, scope);
    expect(file.arrangement).toBe('board');
    expect(file.board).toMatchObject({ sections: [{ item: 'h1', w: 288 }, { item: 'h2' }], cards: [{ item: 'n1', x: 24, y: 56 }, {}, {}], texts: [{ id: 't8k2m', text: '口試前要定案：\n德性是否必要？', color: 'teal' }], arrows: [{ id: 'a3f9q', from: { item: 'n1' }, to: { item: 'n2' }, label: '提出' }, {}] });
    expect(parseCompilation(serializeCompilation(file), scope)).toEqual(file);
    const row = compilationRow(file, owner);
    expect(row.view).toBe('board');
    expect(compilationFile(row)).toEqual(file);
    expect(serializeCompilation(compilationFile(row))).toBe(example);
    const dynamicFile = parseCompilation(dynamicBoard, scope);
    expect(compilationFile(compilationRow(dynamicFile, owner))).toEqual(dynamicFile);
    expect(parseCompilation(serializeCompilation(dynamicFile), scope)).toEqual(dynamicFile);
  });
  it('writes each board entry as one line after the known fields and before external ones, so a move changes one line', () => {
    const file = compilationFile(compilationRow(parseCompilation(`${example}translationKey: ch3\n`, scope), owner));
    const text = serializeCompilation(file);
    expect(text.indexOf('board:')).toBeGreaterThan(text.indexOf('items:'));
    expect(text.trimEnd().endsWith('translationKey: ch3')).toBe(true);
    const row = custom(compilationRow(file, owner));
    const moved = serializeCompilation(compilationFile({ ...row, board: { ...row.board, cards: row.board!.cards!.map(card => 'item' in card && card.item === 'n2' ? { ...card, x: 48, y: 240 } : card) } }));
    const before = text.split('\n'), after = moved.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual(['    - { item: n2, x: 48, y: 240 }']);
    const arrowed = serializeCompilation(compilationFile({ ...row, board: { ...row.board, arrows: [...row.board!.arrows!, { id: 'c9d2e', from: { item: 'n3' }, to: { text: 't8k2m' } }] } })).split('\n');
    expect(arrowed.filter(line => !before.includes(line))).toEqual(['    - { id: c9d2e, from: { item: n3 }, to: { text: t8k2m } }']);
    // Items and the other fields keep their block style.
    expect(text).toContain('items:\n  - id: h1\n    kind: heading\n');
  });
  it('keeps a long text with line breaks on its entry’s one line', () => {
    const row = custom(compilationRow(parseCompilation(example, scope), owner));
    const text = ` line ${'a'.repeat(70)}\n${'b'.repeat(70)}\n end `;
    const written = serializeCompilation(compilationFile({ ...row, board: { ...row.board, texts: [{ id: 't1', x: 0, y: 0, text }] } }));
    expect(written.split('\n').filter(line => line.includes('id: t1'))).toHaveLength(1);
    expect(written).toContain(`    - { id: t1, x: 0, y: 0, text: " line ${'a'.repeat(70)}\\n${'b'.repeat(70)}\\n end " }\n`);
    expect(parseCompilation(written, scope).board!.texts![0].text).toBe(text);
    // A move rewrites such a board in place without spreading the entry over lines.
    const dynamic = dynamicBoard.replace('text: Open', `text: ${JSON.stringify(text)}`);
    const moved = relocateCompilation(dynamic, path => path.replace('notes/one/cases/a', 'notes/one/moved'))!;
    expect(moved.split('\n').filter(line => line.includes('id: t1'))).toHaveLength(1);
  });
  it('rejects every misfit of the board, naming the field', () => {
    const custom = (board: string) => example.slice(0, example.indexOf('board:')) + board;
    const dynamic = (board: string, group = 'group: folder\n') => `version: 1\nid: d\ntitle: D\narrangement: board\nsource: { kind: tag, tag: t }\n${group}${board}`;
    const cases: [string, string | RegExp][] = [[custom('board:\n  cards:\n    - { path: notes/thesis/a.md, x: 0, y: 0 }\n'), 'board.cards.0.path: A custom compilation names a card by item'], [custom('board:\n  sections:\n    - { folder: notes/thesis/sub, x: 0, y: 0 }\n'), 'board.sections.0.folder: A custom compilation names a section by heading item'], [custom('board:\n  arrows:\n    - { id: a, from: { path: notes/thesis/a.md }, to: { item: n1 } }\n'), 'board.arrows.0.from.path: A custom compilation names an arrow end by item'], [dynamic('board:\n  cards:\n    - { item: n1, x: 0, y: 0 }\n'), 'board.cards.0.item: A dynamic compilation names a card by path'], [dynamic('board:\n  sections:\n    - { item: h1, x: 0, y: 0, w: 288, h: 176 }\n'), 'board.sections.0.item: A dynamic compilation names a section by folder'], [dynamic('board:\n  arrows:\n    - { id: a, from: { item: n1 }, to: { path: notes/one/a.md } }\n'), 'board.arrows.0.from.item: A dynamic compilation names an arrow end by path'], [dynamic('board:\n  sections:\n    - { folder: notes/one/sub, x: 0, y: 0 }\n', ''), 'board.sections.0.folder: A folder section needs group: folder'], [custom('board:\n  cards:\n    - { item: h1, x: 0, y: 0 }\n'), 'board.cards.0.item: Card names no content item: h1'], [custom('board:\n  cards:\n    - { item: gone, x: 0, y: 0 }\n'), 'board.cards.0.item: Card names no content item: gone'], [custom('board:\n  sections:\n    - { item: n1, x: 0, y: 0, w: 288, h: 176 }\n'), 'board.sections.0.item: Section names no chapter heading: n1'], [custom('board:\n  arrows:\n    - { id: a, from: { item: n1 }, to: { item: gone } }\n'), 'board.arrows.0.to.item: Arrow end names no item: gone'], [custom('board:\n  cards:\n    - { item: n1, x: 0, y: 0 }\n    - { item: n1, x: 9, y: 9 }\n'), 'board.cards.1.item: Duplicate card for item n1'], [dynamic('board:\n  cards:\n    - { path: notes/one/a.md, x: 0, y: 0 }\n    - { path: notes/one/a.md, x: 9, y: 9 }\n'), 'board.cards.1.path: Duplicate card for path notes/one/a.md'], [custom('board:\n  sections:\n    - { item: h1, x: 0, y: 0, w: 288, h: 176 }\n    - { item: h1, x: 0, y: 0, w: 288, h: 176 }\n'), 'board.sections.1.item: Duplicate section for heading h1'], [dynamic('board:\n  sections:\n    - { folder: notes/one/a, x: 0, y: 0 }\n    - { folder: notes/one/a, x: 0, y: 0 }\n'), 'board.sections.1.folder: Duplicate section for folder notes/one/a'], [custom('board:\n  texts:\n    - { id: t, x: 0, y: 0, text: A }\n    - { id: t, x: 0, y: 0, text: B }\n'), 'board.texts.1.id: Duplicate text id t'], [custom('board:\n  arrows:\n    - { id: a, from: { item: n1 }, to: { item: n2 } }\n    - { id: a, from: { item: n2 }, to: { item: n3 } }\n'), 'board.arrows.1.id: Duplicate arrow id a'], [custom('board:\n  arrows:\n    - { id: a, from: { text: nope }, to: { item: n2 } }\n'), 'board.arrows.0.from.text: Arrow end names no text: nope'], [custom('board:\n  arrows:\n    - { id: a, from: { item: n1 }, to: { item: n1 } }\n'), 'board.arrows.0.to: An arrow cannot start and end on the same element'], [custom('board:\n  cards:\n    - { item: n1, x: 1000001, y: 0 }\n'), 'board.cards.0'], [custom('board:\n  cards:\n    - { item: n1, x: 1.5, y: 0 }\n'), 'board.cards.0'], [custom('board:\n  sections:\n    - { item: h1, x: 0, y: 0, w: 287, h: 176 }\n'), 'board.sections.0'], [custom('board:\n  sections:\n    - { item: h1, x: 0, y: 0, w: 288, h: 175 }\n'), 'board.sections.0'], [custom('board:\n  texts:\n    - { id: t, x: 0, y: 0, w: 79, text: A }\n'), 'board.texts.0.w'], [custom(`board:\n  texts:\n    - { id: t, x: 0, y: 0, text: ${'x'.repeat(2001)} }\n`), 'board.texts.0.text'], [custom('board:\n  texts:\n    - { id: t, x: 0, y: 0, text: "" }\n'), 'board.texts.0.text'], [custom('board:\n  texts:\n    - { id: t, x: 0, y: 0, text: A, color: orange }\n'), 'board.texts.0.color'], [custom('board:\n  texts:\n    - { id: "bad id", x: 0, y: 0, text: A }\n'), 'board.texts.0.id'], [custom(`board:\n  arrows:\n    - { id: a, from: { item: n1 }, to: { item: n2 }, label: ${'x'.repeat(61)} }\n`), 'board.arrows.0.label'], [custom('board:\n  arrows:\n    - { id: a, from: { item: n1, path: notes/thesis/a.md }, to: { item: n2 } }\n'), 'board.arrows.0.from'], [custom('board:\n  cards:\n    - { item: n1, x: 0, y: 0, w: 240 }\n'), 'board.cards.0'], [custom('board:\n  shapes: []\n'), 'board'], [custom(`board:\n  texts: [${Array.from({ length: 301 }, (_, n) => `{ id: t${n}, x: 0, y: 0, text: A }`).join(', ')}]\n`), 'board.texts']];
    for (const [raw, field] of cases) expect(() => parseCompilation(raw, scope), String(field)).toThrow(field);
    // Path ends and dynamic card paths are not checked against membership, nor against the notebooks.
    expect(() => parseCompilation(dynamic('board:\n  cards:\n    - { path: elsewhere/gone.md, x: 0, y: 0 }\n  arrows:\n    - { id: a, from: { path: elsewhere/gone.md }, to: { path: notes/one/b.md } }\n'), scope)).not.toThrow();
    // An arrow may end on a section's heading item.
    expect(() => parseCompilation(custom('board:\n  arrows:\n    - { id: a, from: { item: h1 }, to: { item: n3 } }\n'), scope)).not.toThrow();
  });
  it('keeps the board through a lane or a book edit, so switching back restores it', () => {
    const row = custom(compilationRow(parseCompilation(example, scope), owner));
    const lane = compilationFile({ ...row, view: 'medium', name: 'Renamed' });
    expect(lane).toMatchObject({ arrangement: 'lane', size: 'medium', board: row.board });
    const book = compilationFile({ ...compilationRow(lane, owner), view: 'book' });
    expect(book).toMatchObject({ arrangement: 'book', board: row.board });
    // Reordering chapters in the book moves nothing on the board.
    const reordered = custom(compilationRow(book, owner));
    expect(compilationFile({ ...reordered, items: [...reordered.items.slice(3), ...reordered.items.slice(0, 3)] }).board).toEqual(row.board);
    expect(parseCompilation(serializeCompilation(book), scope).board).toEqual(row.board);
    expect(compilationRow(compilationFile({ ...compilationRow(book, owner), view: 'board' }), owner)).toMatchObject({ view: 'board', board: row.board });
    // Tag and status edits keep it too.
    const file = parseCompilation(example, scope);
    expect(compilationRow(compilationFile({ ...compilationRow(file, owner), tags: ['x'] }), owner).board).toEqual(file.board);
  });
});

describe('graph-arranged files', () => {
  const legacy = `version: 1
id: g
title: G
arrangement: graph
items:
  - { id: a, kind: note, path: notes/one/a.md }
  - { id: b, kind: note, path: notes/one/b.md }
  - { id: c, kind: note, path: notes/one/c.md }
  - { id: h, kind: heading, title: H }
graph:
  nodes:
    - { path: notes/one/a.md, x: 0, y: 0, expanded: true }
    - { path: notes/one/b.md, x: 10, y: 5 }
    - { path: notes/one/c.md, x: 400, y: 300, pinned: true }
    - { path: notes/one/gone.md, x: 0, y: 0 }
`;
  const overlap = (a: { x: number; y: number; }, b: { x: number; y: number; }) => Math.abs(a.x - b.x) < BOARD_CARD_WIDTH && Math.abs(a.y - b.y) < BOARD_CARD_HEIGHT;
  it('reads graph as a board: legacy nodes become cards placed without overlap, matched by path', () => {
    const board = boardCompilation(parseCompilation(legacy, scope));
    expect(board.arrangement).toBe('board');
    expect(board).not.toHaveProperty('graph');
    const cards = board.board!.cards!;
    expect(cards.map(card => 'item' in card && card.item)).toEqual(['a', 'b', 'c']);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i], cards[j]), `${i}/${j}`).toBe(false);
    for (const card of cards) expect(Number.isInteger(card.x) && Number.isInteger(card.y)).toBe(true);
    // A card stands where its node stood unless another one was in the way.
    expect(cards[2]).toEqual({ item: 'c', x: 400 - BOARD_CARD_WIDTH / 2, y: 300 - BOARD_CARD_HEIGHT / 2 });
    // The result is a valid board file without the graph layout.
    const written = serializeCompilation(board);
    expect(written).not.toContain('graph');
    expect(YAML.parse(written)).toMatchObject({ arrangement: 'board', board: { cards: expect.any(Array) } });
    expect(parseCompilation(written, scope)).toEqual(board);
  });
  it('matches a dynamic graph by member path, and lets board win over graph when a file has both', () => {
    const dynamic = boardCompilation(parseCompilation('version: 1\nid: d\ntitle: D\narrangement: graph\nsource: { kind: tag, tag: t }\ngraph: { nodes: [{ path: notes/one/a.md, x: 0, y: 0 }, { path: notes/one/b.md, x: 0, y: 0 }] }\n', scope));
    expect(dynamic.board!.cards!.map(card => 'path' in card && card.path)).toEqual(['notes/one/a.md', 'notes/one/b.md']);
    expect(overlap(dynamic.board!.cards![0], dynamic.board!.cards![1])).toBe(false);
    const both = boardCompilation(parseCompilation(`${legacy}board:\n  cards:\n    - { item: a, x: 7, y: 7 }\n`, scope));
    expect(both).toMatchObject({ arrangement: 'board', board: { cards: [{ item: 'a', x: 7, y: 7 }] } });
    expect(both).not.toHaveProperty('graph');
    // A lane or book keeps its arrangement; only its legacy layout becomes a board.
    expect(boardCompilation(parseCompilation(legacy.replace('arrangement: graph', 'arrangement: book'), scope))).toMatchObject({ arrangement: 'book', board: { cards: expect.any(Array) } });
  });
  it('keeps a converted legacy layout inside the board’s range and card limit', () => {
    const far = boardCompilation(parseCompilation('version: 1\nid: d\ntitle: D\narrangement: graph\nsource: { kind: tag, tag: t }\ngraph: { nodes: [{ path: notes/one/a.md, x: 5000000, y: 0 }, { path: notes/one/b.md, x: 5001000, y: 0 }, { path: notes/one/c.md, x: -9000000, y: -9000000 }] }\n', scope));
    const cards = far.board!.cards!;
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i], cards[j]), `${i}/${j}`).toBe(false);
    expect(parseCompilation(serializeCompilation(far), scope)).toEqual(far);
    const nodes = Array.from({ length: 2001 }, (_, n) => `{ path: notes/one/n${n}.md, x: ${(n % 50) * 300}, y: ${Math.floor(n / 50) * 200} }`).join(', ');
    const many = boardCompilation(parseCompilation(`version: 1\nid: d\ntitle: D\narrangement: graph\nsource: { kind: tag, tag: t }\ngraph: { nodes: [${nodes}] }\n`, scope));
    expect(many.board!.cards).toHaveLength(2000);
    expect(() => parseCompilation(serializeCompilation(many), scope)).not.toThrow();
  });
  it('still writes a graph-arranged file as graph with its layout until the board is drawn, so older readers keep it', () => {
    const file = parseCompilation(legacy, scope);
    const row = compilationRow(file, owner);
    expect(row.view).toBe('graph');
    const written = serializeCompilation(compilationFile(row));
    expect(YAML.parse(written)).toMatchObject({ arrangement: 'graph', graph: { nodes: expect.any(Array) } });
    expect(written).not.toContain('board');
  });
});

describe('board references when files and items change', () => {
  it('relocates dynamic card paths, folder sections and path arrow ends', () => {
    const next = relocateCompilation(dynamicBoard, path => path.startsWith('notes/one/cases/a') ? `notes/one/moved${path.slice('notes/one/cases/a'.length)}` : path)!;
    const value = YAML.parse(next);
    expect(value.board.sections[0].folder).toBe('notes/one/moved');
    expect(value.board.cards.map((card: { path: string; }) => card.path)).toEqual(['notes/one/moved/x.md', 'notes/one/cases/b/y.md']);
    expect(value.board.arrows[0]).toMatchObject({ from: { path: 'notes/one/moved/x.md' }, to: { path: 'notes/one/cases/b/y.md' } });
    expect(value.board.arrows[1]).toMatchObject({ from: { text: 't1' }, to: { path: 'notes/one/moved/x.md' } });
    // The rewrite touches only the lines that name a moved path.
    const changed = next.split('\n').filter(line => !dynamicBoard.split('\n').includes(line));
    expect(changed).toEqual(['    - { folder: notes/one/moved, x: 0, y: 0 }', '    - { path: notes/one/moved/x.md, x: 24, y: 56 }', '    - { id: a1, from: { path: notes/one/moved/x.md }, to: { path: notes/one/cases/b/y.md } }', '    - { id: a2, from: { text: t1 }, to: { path: notes/one/moved/x.md } }']);
    expect(relocateCompilation(dynamicBoard, path => path.replace('notes/two', 'notes/three'))).toBeNull();
  });
  it('never rewrites an invalid file with a board, whatever it names, and keeps the older rule for files without one', () => {
    const invalid = dynamicBoard.replace('x: 24, y: 56', 'x: 1000001, y: 56').replace('group: folder\n', 'group: folder\nmanualOrder: [notes/one/cases/a/x.md]\n');
    expect(relocateCompilation(invalid, path => path.replace('notes/one/cases/a', 'notes/one/moved'))).toBeNull();
    expect(relocateCompilation(invalid, path => path.replace('notes/one/cases', 'notes/one/moved'))).toBeNull();
    const withoutBoard = invalid.slice(0, invalid.indexOf('board:')).replace('arrangement: board', 'arrangement: carousel');
    expect(YAML.parse(relocateCompilation(withoutBoard, path => path.replace('notes/one/cases', 'notes/one/moved'))!)).toMatchObject({ source: { path: 'notes/one/moved' }, manualOrder: ['notes/one/moved/a/x.md'] });
  });
  it('leaves a file with a board as it is when the move would make it invalid', () => {
    // A path past the length limit is one the move can produce and the board cannot hold.
    const long = `notes/one/${'x'.repeat(2050)}.md`;
    expect(relocateCompilation(dynamicBoard, path => path === 'notes/one/cases/a/x.md' ? long : path)).toBeNull();
  });
  it('lets a path that moves onto a stale entry keep its own, so the board stays valid', () => {
    // b.md and folder b are not members now; a.md moves onto b.md and folder a onto folder b.
    const stale = `version: 1
id: s
title: S
arrangement: board
source: { kind: tag, tag: t }
group: folder
board:
  sections:
    - { folder: notes/one/b, x: 0, y: 0 }
    - { folder: notes/one/a, x: 400, y: 0 }
  cards:
    - { path: notes/one/b.md, x: 1, y: 1 }
    - { path: notes/one/a.md, x: 2, y: 2 }
    - { path: notes/one/c.md, x: 3, y: 3 }
  arrows:
    - { id: ab, from: { path: notes/one/a.md }, to: { path: notes/one/b.md }, label: 提出 }
    - { id: ac, from: { path: notes/one/a.md }, to: { path: notes/one/c.md } }
    - { id: cb, from: { path: notes/one/c.md }, to: { path: notes/one/b.md } }
`;
    const move = (path: string) => path === 'notes/one/a.md' ? 'notes/one/b.md' : path === 'notes/one/a' ? 'notes/one/b' : path;
    const next = relocateCompilation(stale, move)!;
    const file = parseCompilation(next, scope);
    expect(file.board).toEqual({ sections: [{ folder: 'notes/one/b', x: 400, y: 0 }], cards: [{ path: 'notes/one/b.md', x: 2, y: 2 }, { path: 'notes/one/c.md', x: 3, y: 3 }], arrows: [{ id: 'ac', from: { path: 'notes/one/b.md' }, to: { path: 'notes/one/c.md' } }, { id: 'cb', from: { path: 'notes/one/c.md' }, to: { path: 'notes/one/b.md' } }] });
    // The same when the moved entry comes first.
    const reversed = relocateCompilation(stale.replace('    - { path: notes/one/b.md, x: 1, y: 1 }\n    - { path: notes/one/a.md, x: 2, y: 2 }\n', '    - { path: notes/one/a.md, x: 2, y: 2 }\n    - { path: notes/one/b.md, x: 1, y: 1 }\n'), move)!;
    expect(parseCompilation(reversed, scope).board!.cards).toEqual([{ path: 'notes/one/b.md', x: 2, y: 2 }, { path: 'notes/one/c.md', x: 3, y: 3 }]);
  });
  it('relocates a board whose arrow ends share an alias, giving each use its own path', () => {
    const aliased = dynamicBoard.replace('    - { id: a1, from: { path: notes/one/cases/a/x.md }, to: { path: notes/one/cases/b/y.md } }\n    - { id: a2, from: { text: t1 }, to: { path: notes/one/cases/a/x.md } }\n', '    - { id: a1, from: &x { path: notes/one/cases/a/x.md }, to: { path: notes/one/cases/b/y.md } }\n    - { id: a2, from: { text: t1 }, to: *x }\n');
    expect(parseCompilation(aliased, scope).board!.arrows![1].to).toEqual({ path: 'notes/one/cases/a/x.md' });
    const next = relocateCompilation(aliased, path => path.replace('notes/one/cases/a', 'notes/one/moved'))!;
    const file = parseCompilation(next, scope);
    expect(file.board!.arrows).toEqual([{ id: 'a1', from: { path: 'notes/one/moved/x.md' }, to: { path: 'notes/one/cases/b/y.md' } }, { id: 'a2', from: { text: 't1' }, to: { path: 'notes/one/moved/x.md' } }]);
    expect(file.board!.cards![0]).toEqual({ path: 'notes/one/moved/x.md', x: 24, y: 56 });
    expect(file.source).toEqual({ kind: 'folder', path: 'notes/one/cases', recursive: true });
    expect(next).toContain('    - { id: a2, from: { text: t1 }, to: { path: notes/one/moved/x.md } }\n');
  });
  it('leaves a custom board alone when a pinned note moves: its cards name the item', () => {
    const next = relocateCompilation(example, path => path.replace('第三章導論', '導論'))!;
    expect(YAML.parse(next).items[1].path).toBe('notes/thesis/導論.md');
    expect(next.slice(next.indexOf('board:'))).toBe(example.slice(example.indexOf('board:')));
  });
  it('maps every item reference of the board through the copy’s fresh ids and keeps text and arrow ids', () => {
    const file = parseCompilation(example, scope);
    const copy = copyCompilation(file, [file.id], () => `new-${file.items!.length}-${Math.random().toString(36).slice(2, 8)}`);
    const ids = new Map(file.items!.map((item, index) => [item.id, copy.items![index].id]));
    expect(copy.board).toEqual({ sections: file.board!.sections!.map(section => 'item' in section ? { ...section, item: ids.get(section.item) } : section), cards: file.board!.cards!.map(card => 'item' in card ? { ...card, item: ids.get(card.item) } : card), texts: file.board!.texts, arrows: file.board!.arrows!.map(arrow => ({ ...arrow, from: 'item' in arrow.from ? { item: ids.get(arrow.from.item) } : arrow.from, to: 'item' in arrow.to ? { item: ids.get(arrow.to.item) } : arrow.to })) });
    expect(parseCompilation(serializeCompilation(copy), scope)).toEqual(copy);
    expect(copyCompilation(parseCompilation(dynamicBoard, scope), []).board).toEqual(parseCompilation(dynamicBoard, scope).board);
  });
  it('drops a removed item’s card, section and arrows when the row becomes a file', () => {
    const row = custom(compilationRow(parseCompilation(example, scope), owner));
    const withoutN2 = compilationFile({ ...row, items: row.items.filter(item => item.id !== 'n2') });
    expect(withoutN2.board!.cards!.map(card => 'item' in card && card.item)).toEqual(['n1', 'n3']);
    expect(withoutN2.board!.arrows).toEqual([]);
    expect(withoutN2.board!.texts).toEqual(row.board!.texts);
    const withoutH2 = compilationFile({ ...row, items: row.items.filter(item => item.id !== 'h2'), board: { ...row.board, arrows: [...row.board!.arrows!, { id: 'x', from: { item: 'h2' }, to: { text: 't8k2m' } }] } });
    expect(withoutH2.board!.sections!.map(section => 'item' in section && section.item)).toEqual(['h1']);
    expect(withoutH2.board!.arrows!.map(arrow => arrow.id)).toEqual(['a3f9q', 'b7c1z']);
    expect(() => parseCompilation(serializeCompilation(withoutN2), scope)).not.toThrow();
    // A dynamic board keeps cards of paths that are not members now.
    const dynamicRow = compilationRow(parseCompilation(dynamicBoard, scope), owner);
    expect(compilationFile(dynamicRow).board).toEqual(dynamicRow.board);
    // Without its folder grouping a dynamic board loses its folder sections, which would make the file invalid.
    if (dynamicRow.kind !== 'dynamic') throw new Error('expected a dynamic row');
    const ungrouped = compilationFile({ ...dynamicRow, group: undefined });
    expect(ungrouped.board!.sections).toEqual([]);
    expect(() => parseCompilation(serializeCompilation(ungrouped), scope)).not.toThrow();
  });
});

describe('board listing and membership', () => {
  it('lists the board counts beside the arrangement, and none for a file without a board', () => {
    expect(compilationFields(example, owner.path, scope).metadata).toMatchObject({ arrangement: 'board', itemCount: 3, chapterCount: 2, board: { cards: 3, sections: 2, texts: 1, arrows: 2 } });
    expect(compilationFields(dynamicBoard, owner.path, scope).metadata).toMatchObject({ arrangement: 'board', sourceKind: 'folder', board: { cards: 2, sections: 1, texts: 1, arrows: 2 } });
    const lane = compilationFields('version: 1\nid: x\ntitle: X\narrangement: lane\nitems: []\nboard: {}\n', owner.path, scope);
    expect(lane.metadata).toMatchObject({ arrangement: 'lane', board: { cards: 0, sections: 0, texts: 0, arrows: 0 } });
    expect(compilationFields('version: 1\nid: x\ntitle: X\narrangement: lane\nitems: []\n', owner.path, scope).metadata).not.toHaveProperty('board');
    expect(compilationFields(example.replace('w: 288', 'w: 2'), owner.path, scope).invalid).toContain('board.sections.0');
  });
  it('finds the custom and dynamic boards a note is a card on', () => {
    const note = (path: string, extra: object = {}) => ({ notebookId: 'one', path, tags: [] as string[], metadata: {}, ...extra });
    const notes = [note('notes/one/a.md', { tags: ['clue'] }), note('notes/one/b.md'), note('notes/one/c.md', { tags: ['clue'], status: 'archived' })];
    const make = (raw: string, id: string) => compilationRow(parseCompilation(raw.replace(/^id: .*$/m, `id: ${id}`), scope), { notebookId: 'one', path: `notes/one/${id}.compilation.yml` });
    const customBoard = make('version: 1\nid: x\ntitle: X\narrangement: board\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\n  - { id: b, kind: note, path: notes/one/b.md }\n', 'pinned');
    const tagBoard = make('version: 1\nid: x\ntitle: X\narrangement: board\nsource: { kind: tag, tag: clue }\n', 'tagged');
    const graphRow = make('version: 1\nid: x\ntitle: X\narrangement: graph\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\n', 'graphed');
    const laneWithBoard = make('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\nboard: { cards: [{ item: a, x: 0, y: 0 }] }\n', 'laned');
    const plainLane = make('version: 1\nid: x\ntitle: X\narrangement: lane\nitems:\n  - { id: a, kind: note, path: notes/one/a.md }\n', 'plain');
    const rows = [customBoard, tagBoard, graphRow, laneWithBoard, plainLane];
    expect(boardsContaining({ notebookId: 'one', path: 'notes/one/a.md' }, rows, notes).map(row => row.id)).toEqual(['pinned', 'tagged', 'graphed', 'laned']);
    expect(boardsContaining({ notebookId: 'one', path: 'notes/one/b.md' }, rows, notes).map(row => row.id)).toEqual(['pinned']);
    // A hidden note leaves a dynamic board's query; a note of another notebook is on neither.
    expect(boardsContaining({ notebookId: 'one', path: 'notes/one/c.md' }, rows, notes)).toEqual([]);
    expect(boardsContaining({ notebookId: 'two', path: 'notes/one/a.md' }, rows, [{ ...notes[0], notebookId: 'two' }])).toEqual([]);
    // A note missing from the catalogue is still on the custom boards that pin it.
    expect(boardsContaining({ notebookId: 'one', path: 'notes/one/a.md' }, rows, []).map(row => row.id)).toEqual(['pinned', 'graphed', 'laned']);
  });
});
