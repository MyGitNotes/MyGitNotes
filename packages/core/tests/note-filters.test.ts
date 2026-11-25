import { describe, expect, it } from 'vitest';
import { filterNotes, type NoteFilters } from '../src/note-filters.js';
import type { NoteItem } from '../src/types.js';

const base: NoteFilters = { notebookId: 'a', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false };
const note = (path: string, tags: string[] = [], content = '', status = 'inbox', metadata = {}): NoteItem => ({ id: path, path, title: path, notebookId: path.startsWith('notes/b/') ? 'b' : 'a', tags, content, status, metadata });
const notes = [note('notes/a/research/one.md', ['red', 'blue'], 'needle [[two]]'), note('notes/a/research/nested/two.md', ['blue'], '[[three]]'), note('notes/a/research-extra/three.md', ['red'], '[[four]]'), note('notes/a/other/four.md', ['green']), note('notes/b/research/five.md', ['blue']), note('notes/a/research/hidden.md', ['red'], '', 'archived'), note('notes/a/research/visible.md', ['red'], '', 'archived', { hiden: false })];
const paths = (filters: Partial<NoteFilters>) => filterNotes(notes, { ...base, ...filters }).map(note => note.path);

describe('shared note filters', () => {
  it('unions folder selections with exact directory boundaries and optional descendants', () => {
    expect(paths({ folders: ['notes/a/research', 'notes/a/other'] })).toEqual([notes[0].path, notes[1].path, notes[3].path, notes[6].path]);
    expect(paths({ folders: ['notes/a/research'], descendants: false })).toEqual([notes[0].path, notes[6].path]);
    expect(paths({ notebookId: 'all', folders: ['notes/a/research'] })).not.toContain(notes[4].path);
    expect(paths({ folders: ['notes/a/missing'] })).toEqual([]);
  });
  it('combines tag any/all, folder, search and status with the notebook search semantics', () => {
    expect(paths({ tags: ['red', 'blue'], tagMode: 'all' })).toEqual([notes[0].path]);
    expect(paths({ tags: ['red', 'blue'], folders: ['notes/a/research'], q: 'needle', status: 'inbox' })).toEqual([notes[0].path]);
    expect(paths({ q: 'green' })).toEqual([notes[3].path]);
    expect(paths({ q: 'nested' })).toEqual([notes[1].path]);
    expect(paths({ q: 'archived' })).toEqual([notes[6].path]);
    expect(paths({ showHidden: true, q: 'archived' })).toEqual([notes[5].path, notes[6].path]);
  });
});
