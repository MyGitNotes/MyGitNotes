import { describe, expect, it } from 'vitest';
import type { LiveNoteState, NotebookConfig, WorkspaceConfig } from '../src/types.js';
import { DEFAULT_NOTE_QUERY, type NoteListItem, noteMatchesQuery, noteQuerySearch, noteSearchTerms, withoutSearchToken } from '../src/note-query.js';
import { filterNotes } from '../src/note-filters.js';
import { type CatalogRepository, parseNoteQuery, queryNotes, workspaceCatalog } from '../src/note-catalog.js';

const editing: LiveNoteState = { since: '2026-11-15T00:00:00Z', activeEditors: 1, editorUrl: 'https://editor.test/a' };
const pending: LiveNoteState = { ...editing, pending: true };
const note = (path: string, live?: LiveNoteState, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: path, path, notebookId: 'work', title: path.split('/').pop()!.replace('.md', ''), tags: [], metadata: {}, content: 'body text', ...(live ? { live } : {}), ...extra });
const notes = [note('notes/work/plain.md'), note('notes/work/checked-out.md', editing), note('notes/work/.live/new.md', pending)];
const query = (overrides: Partial<typeof DEFAULT_NOTE_QUERY> = {}) => ({ ...DEFAULT_NOTE_QUERY, ...overrides });
const matching = (overrides: Partial<typeof DEFAULT_NOTE_QUERY>) => notes.filter(item => noteMatchesQuery(item, query(overrides))).map(item => item.path);

describe('live state filter', () => {
  it('keeps checked-out notes for editing, pending notes for pending, both for both, and every note when empty', () => {
    expect(matching({ live: ['editing'] })).toEqual(['notes/work/checked-out.md']);
    expect(matching({ live: ['pending'] })).toEqual(['notes/work/.live/new.md']);
    expect(matching({ live: ['editing', 'pending'] })).toEqual(['notes/work/checked-out.md', 'notes/work/.live/new.md']);
    expect(matching({ live: [] })).toEqual(notes.map(item => item.path));
  });

  it('agrees with filterNotes', () => {
    for (const live of [['editing'], ['pending'], ['editing', 'pending']] as const) {
      expect(filterNotes(notes.map(item => ({ ...item, content: item.content! })), { ...query(), live: [...live] }).map(item => item.path)).toEqual(matching({ live: [...live] }));
    }
  });

  it('round trips through the query string and refuses unknown states', () => {
    const search = noteQuerySearch(query({ notebookId: 'work', live: ['editing', 'pending'] }));
    expect(search.getAll('live')).toEqual(['editing', 'pending']);
    expect(noteQuerySearch(query({ notebookId: 'work' })).has('live')).toBe(false);
    expect(parseNoteQuery(Object.fromEntries([['notebookId', 'work'], ['live', search.getAll('live')]])).query.live).toEqual(['editing', 'pending']);
    expect(parseNoteQuery({ notebookId: 'work' }).query.live).toEqual([]);
    expect(() => parseNoteQuery({ notebookId: 'work', live: 'archived' })).toThrow(/Invalid query option/);
  });
});

describe('live search tokens', () => {
  it('takes is:live and is:pending out of the free text, in any case', () => {
    expect(noteSearchTerms('alpha is:live  beta')).toMatchObject({ text: 'alpha beta', parts: ['alpha', 'beta'], tokens: ['is:live'] });
    expect(noteSearchTerms('IS:PENDING')).toMatchObject({ text: '', tokens: ['is:pending'] });
    expect(noteSearchTerms('is:pending is:live is:live')).toMatchObject({ text: '', tokens: ['is:pending', 'is:live'] });
    expect(noteSearchTerms('plain  text')).toMatchObject({ text: 'plain  text', tokens: [] });
    expect(noteSearchTerms('this:live is:liveish')).toMatchObject({ text: 'this:live is:liveish', tokens: [] });
  });

  it('keeps the free text as typed around a token, and does not join its neighbours into a phrase', () => {
    expect(noteSearchTerms('foo  bar is:live')).toMatchObject({ parts: ['foo  bar'], tokens: ['is:live'] });
    expect(noteSearchTerms('a is:pending b').parts).toEqual(['a', 'b']);
    expect(noteSearchTerms('plain  text').parts).toEqual(['plain  text']);
    const spaced = [note('notes/work/spaced.md', editing, { title: 'foo  bar' }), note('notes/work/apart.md', pending, { title: 'alpha x omega', content: '' })];
    const hits = (q: string) => spaced.filter(item => noteMatchesQuery(item, query({ q }))).map(item => item.path);
    expect(hits('foo  bar is:live')).toEqual(['notes/work/spaced.md']);
    expect(hits('alpha is:pending omega')).toEqual(['notes/work/apart.md']);
    expect(filterNotes(spaced.map(item => ({ ...item, content: item.content! })), query({ q: 'alpha is:live omega' })).map(item => item.path)).toEqual(['notes/work/apart.md']);
  });

  it('removes one token and keeps the rest of the search', () => {
    expect(withoutSearchToken('alpha is:live beta is:pending', 'is:live')).toBe('alpha beta is:pending');
    expect(withoutSearchToken('IS:LIVE', 'is:live')).toBe('');
  });

  it('filters: is:live keeps any live note, is:pending only pending ones', () => {
    expect(matching({ q: 'is:live' })).toEqual(['notes/work/checked-out.md', 'notes/work/.live/new.md']);
    expect(matching({ q: 'is:pending' })).toEqual(['notes/work/.live/new.md']);
    expect(matching({ q: 'is:live', live: ['editing'] })).toEqual(['notes/work/checked-out.md']);
  });

  it('matches the free text without the tokens', () => {
    expect(matching({ q: 'body is:live' })).toEqual(['notes/work/checked-out.md', 'notes/work/.live/new.md']);
    expect(matching({ q: 'checked is:live' })).toEqual(['notes/work/checked-out.md']);
    expect(matching({ q: 'is:live', match: 'title' })).toEqual(['notes/work/checked-out.md', 'notes/work/.live/new.md']);
  });

  it('answers a token-only query from the index, without reading any body or snippet', async () => {
    const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test', default_notebook: 'work' }, notebooks: [{ id: 'work', title: 'Work', root: 'notes/work' }] as NotebookConfig[] };
    const contentReads: string[] = [];
    const repository: CatalogRepository = {
      id: 'github:owner/work@main',
      alias: 'w',
      notebooks: config.notebooks,
      catalog: {
        revision: async () => 'a'.repeat(40),
        index: async () => notes.map(({ content: _content, ...item }) => item),
        contents: async items => {
          contentReads.push(...items.map(item => item.path));
          return new Map(items.map(item => [item.path, 'body is:pending text']));
        },
        memo: (_kind, _notebooks, compute) => compute(),
        folders: async () => [],
      },
    };
    const catalog = await workspaceCatalog(config, [repository], {});
    const page = await queryNotes(catalog, query({ q: 'is:pending' }), { limit: 50 });
    expect(page.notes.map(item => item.path)).toEqual(['notes/work/.live/new.md']);
    expect(page.notes[0]?.matchSnippet).toBeUndefined();
    expect(contentReads).toEqual([]);
    const searched = await queryNotes(catalog, query({ q: 'body is:live' }), { limit: 50 });
    expect(searched.notes.map(item => item.path).sort()).toEqual(['notes/work/.live/new.md', 'notes/work/checked-out.md']);
    expect(searched.notes.every(item => item.matchSnippet && !item.matchSnippet.includes('is:live'))).toBe(true);
  });
});
