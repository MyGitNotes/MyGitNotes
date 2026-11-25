import { describe, expect, it } from 'vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { draggedNote, drawerRows, droppedNote, dynamicSource, linkedCandidates, linkedNotes, linkedOffBoard, otherBoardCounts } from './drawer.js';

const nb = 'nb';
const key = (name: string) => `${nb}:notes/${name}.md`;
const member = (name: string, extra: { status?: string; tags?: string[]; metadata?: Record<string, unknown>; } = {}) => ({ notebookId: nb, path: `notes/${name}.md`, tags: extra.tags ?? [], metadata: extra.metadata ?? {}, ...(extra.status ? { status: extra.status } : {}) });
// a → b, c → a, b → d, e → f: a links with b and c, b with a and d.
const links = [{ source: key('a'), target: key('b') }, { source: key('c'), target: key('a') }, { source: key('b'), target: key('d') }, { source: key('e'), target: key('f') }];
const custom = (path: string, notes: string[]): CompilationRow => ({ id: path, name: path, notebookId: nb, path, view: 'board', kind: 'custom', items: notes.map(name => ({ id: name, kind: 'note', notebookId: nb, path: `notes/${name}.md` })) });

describe('linkedNotes', () => {
  it('keeps the notes linked to or from any given note, in either direction, without the given ones', () => {
    expect([...linkedNotes(links, new Set([key('a')]))].sort()).toEqual([key('b'), key('c')]);
    expect([...linkedNotes(links, new Set([key('a'), key('b')]))].sort()).toEqual([key('c'), key('d')]);
    expect([...linkedNotes(links, new Set())]).toEqual([]);
  });
});

describe('drawerRows', () => {
  const notes = ['a', 'b', 'c', 'd', 'e'].map(name => member(name));
  const names = (rows: { path: string; }[]) => rows.map(row => row.path.slice(6, -3));
  it('lists every note the search found with no chip on', () => {
    expect(names(drawerRows(notes, {}))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('「不在這塊白板」 leaves out the notes on the board', () => {
    expect(names(drawerRows(notes, { offBoard: new Set([key('a'), key('d')]) }))).toEqual(['b', 'c', 'e']);
  });
  it('「連到選取的卡片」 keeps the notes linked to or from the selected cards against the note graph', () => {
    expect(names(drawerRows(notes, { linked: linkedNotes(links, new Set([key('a')])) }))).toEqual(['b', 'c']);
    expect(names(drawerRows(notes, { linked: linkedNotes(links, new Set([key('a'), key('b')])) }))).toEqual(['c', 'd']);
  });
  it('applies both chips together', () => {
    expect(names(drawerRows(notes, { offBoard: new Set([key('c')]), linked: linkedNotes(links, new Set([key('a')])) }))).toEqual(['b']);
  });
});

describe('linkedOffBoard', () => {
  it('offers the linked notes the board does not show, leaving hidden notes out', () => {
    const known = [member('b'), member('c', { metadata: { hiden: true } }), member('d')];
    expect(linkedOffBoard(links, member('a'), new Set(), known).map(note => note.path)).toEqual(['notes/b.md']);
    expect(linkedOffBoard(links, member('b'), new Set([key('a')]), [member('a'), member('d')]).map(note => note.path)).toEqual(['notes/d.md']);
  });
  it('names the candidates to look up', () => {
    expect(linkedCandidates(links, member('a'), new Set([key('b')]))).toEqual([{ notebookId: nb, path: 'notes/c.md' }]);
  });
});

describe('otherBoardCounts', () => {
  it('counts the other boards holding each note, custom and dynamic, leaving the shown board out', () => {
    const tagged: CompilationRow = { id: 't', name: 't', notebookId: nb, path: 'notes/t.compilation.yml', view: 'board', kind: 'dynamic', source: { kind: 'tag', tag: 'x', notebookId: nb } };
    const boards = [custom('notes/one.compilation.yml', ['a', 'b']), custom('notes/two.compilation.yml', ['a']), tagged];
    const counts = otherBoardCounts([member('a'), member('b', { tags: ['x'] }), member('c')], boards, { notebookId: nb, path: 'notes/one.compilation.yml' });
    expect([...counts]).toEqual([[key('a'), 1], [key('b'), 1]]);
  });
});

describe('dynamicSource', () => {
  it('names a tag, or a folder from its notebook’s root', () => {
    const base = { id: 'd', name: 'D', notebookId: nb, path: 'notes/d.compilation.yml', view: 'board' as const, kind: 'dynamic' as const };
    expect(dynamicSource({ ...base, source: { kind: 'tag', tag: '論文', notebookId: nb } }, [])).toEqual({ kind: 'tag', name: '論文' });
    expect(dynamicSource({ ...base, source: { kind: 'folder', path: 'notes/thesis/ch3', recursive: true, notebookId: nb } }, [{ id: nb, root: 'notes' }])).toEqual({ kind: 'folder', name: 'thesis/ch3' });
    expect(dynamicSource(custom('p', []), [])).toBeUndefined();
  });
});

describe('draggedNote and droppedNote', () => {
  it('carries a note through a drag, and nothing else', () => {
    expect(droppedNote(draggedNote({ notebookId: nb, path: 'notes/a.md' }))).toEqual({ notebookId: nb, path: 'notes/a.md' });
    expect(droppedNote('not json')).toBeUndefined();
    expect(droppedNote('{"path":"x"}')).toBeUndefined();
  });
});
