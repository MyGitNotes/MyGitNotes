import { describe, expect, it } from 'vitest';
import { compilationFields } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { boardTiles, compilationIndex, isListedBoard } from './listing.js';

const items = 'items:\n  - id: h1\n    kind: heading\n    title: 一、問題\n  - id: n1\n    kind: note\n    path: notes/thesis/a.md\n  - id: n2\n    kind: note\n    path: notes/thesis/b.md\n';
const files: Record<string, string> = {
  board: `version: 1\nid: board\ntitle: 第三章\ndescription: 口試前定稿\narrangement: board\n${items}board:\n  cards:\n    - { item: n1, x: 0, y: 0 }\n`,
  // A lane and a book that hold board data: a board switched to another arrangement stays in the list.
  lane: `version: 1\nid: lane\ntitle: 曾是白板的河道\narrangement: lane\nsize: small\n${items}board:\n  cards:\n    - { item: n1, x: 0, y: 0 }\n`,
  book: `version: 1\nid: book\ntitle: 曾是白板的書\narrangement: book\n${items}board: {}\n`,
  // The graph arrangement a board replaces is read as a board.
  graph: `version: 1\nid: graph\ntitle: 舊關聯圖\narrangement: graph\n${items}`,
  dynamic: 'version: 1\nid: dynamic\ntitle: 標籤白板\narrangement: board\nsource: { kind: tag, tag: thesis }\n',
  plain: `version: 1\nid: plain\ntitle: 只是河道\narrangement: lane\nsize: small\n${items}`,
};
const entry = (id: string, updated: string, raw = files[id]!): NoteListItem => {
  const path = `notes/thesis/${id}.compilation.yml`;
  const fields = compilationFields(raw, path, ['notes/thesis']);
  return { id: path, path, notebookId: 'thesis', title: fields.title, tags: fields.tags, kind: 'compilation', metadata: { ...fields.metadata, updated }, ...(fields.invalid ? { invalid: fields.invalid } : {}) } as NoteListItem;
};
const entries = [entry('plain', '2026-11-25T09:00:00Z'), entry('lane', '2026-11-20T09:00:00Z'), entry('board', '2026-11-24T09:00:00Z'), entry('book', '2026-11-22T09:00:00Z'), entry('graph', '2026-11-01T09:00:00Z'), entry('dynamic', '2026-11-23T09:00:00Z'), entry('broken', '2026-11-25T10:00:00Z', 'version: 1\nid: broken\ntitle: 壞掉的\narrangement: board\nitems: nope\n'), { ...entry('board', '2026-11-25T11:00:00Z'), kind: undefined, path: 'notes/thesis/board.md' }];

describe('the 白板 page list', () => {
  it('lists every compilation arranged as a board or holding board data, newest edit first, and nothing else', () => {
    expect(boardTiles(entries).map(tile => tile.title)).toEqual(['第三章', '標籤白板', '曾是白板的書', '曾是白板的河道', '舊關聯圖']);
    expect(isListedBoard(entry('plain', '').metadata)).toBe(false);
  });

  it('gives a tile its description, card and section counts and last edit; a dynamic board says where its cards come from', () => {
    const [board, dynamic] = boardTiles(entries);
    expect(board).toEqual({ path: 'notes/thesis/board.compilation.yml', notebookId: 'thesis', title: '第三章', description: '口試前定稿', cards: 2, sections: 1, updated: Date.parse('2026-11-24T09:00:00Z') });
    expect(dynamic).toEqual({ path: 'notes/thesis/dynamic.compilation.yml', notebookId: 'thesis', title: '標籤白板', source: 'tag', updated: Date.parse('2026-11-23T09:00:00Z') });
  });

  it('indexes every compilation that opens by id, saying which the list holds, for the former graph addresses', () => {
    expect(compilationIndex(entries)).toEqual(expect.arrayContaining([{ id: 'plain', path: 'notes/thesis/plain.compilation.yml', board: false }, { id: 'lane', path: 'notes/thesis/lane.compilation.yml', board: true }, { id: 'graph', path: 'notes/thesis/graph.compilation.yml', board: true }]));
    expect(compilationIndex(entries).map(row => row.id)).not.toContain('broken');
  });
});
