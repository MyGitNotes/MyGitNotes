// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SORT, getNotebookSort, getSavedSort, getStoredGlobalSort, resolveNoteSort, saveNotebookSort, SORT_FIELD_STORAGE_KEY, SORT_ORDER_STORAGE_KEY } from './note-sort.js';
import { readFilterQuery, writeFilterQuery } from './filter-query.js';
import { metadataSortOptions } from './note-sort-options.js';

afterEach(() => window.localStorage.clear());

describe('which sort a notebook starts with', () => {
  const explicit = { field: 'title', order: 'asc' } as const, defaultSort = { field: 'metadata.date', order: 'desc' } as const, saved = { field: 'created', order: 'asc' } as const;
  it('prefers what the person chose for the notebook, then its default_sort, then the saved browser-wide sort, then DEFAULT_SORT', () => {
    expect(resolveNoteSort({ explicit, defaultSort, saved })).toEqual(explicit);
    expect(resolveNoteSort({ defaultSort, saved })).toEqual(defaultSort);
    expect(resolveNoteSort({ saved })).toEqual(saved);
    expect(resolveNoteSort({})).toEqual(DEFAULT_SORT);
  });
});

describe('sorts saved in the browser', () => {
  it('keeps a choice per notebook key, apart from the browser-wide sort', () => {
    saveNotebookSort('docs~meetings', 'metadata.date', 'desc');
    saveNotebookSort('docs~notes', 'title', 'asc');
    expect(getNotebookSort('docs~meetings')).toEqual({ field: 'metadata.date', order: 'desc' });
    expect(getNotebookSort('docs~notes')).toEqual({ field: 'title', order: 'asc' });
    expect(getNotebookSort('docs~other')).toBeUndefined();
    expect(window.localStorage.getItem(SORT_FIELD_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SORT_ORDER_STORAGE_KEY)).toBeNull();
  });
  it('ignores a saved notebook sort that is not a sort', () => {
    for (const raw of ['not json', '{}', '{"field":"modified","order":"asc"}', '{"field":"title","order":"up"}', 'null']) {
      window.localStorage.setItem('github-notes:sort:docs~a', raw);
      expect(getNotebookSort('docs~a')).toBeUndefined();
    }
  });
  it('tells a saved browser-wide sort from none, and keeps the old fallback for getSavedSort', () => {
    expect(getStoredGlobalSort()).toBeUndefined();
    expect(getSavedSort()).toEqual(DEFAULT_SORT);
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, 'title');
    expect(getStoredGlobalSort()).toEqual({ field: 'title', order: 'desc' });
    window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, 'asc');
    expect(getSavedSort()).toEqual({ field: 'title', order: 'asc' });
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, 'bogus');
    window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, 'bogus');
    expect(getStoredGlobalSort()).toBeUndefined();
  });
});

describe('the sort URL parameters', () => {
  it('read a metadata.<key> sort next to the built-in fields, and drop anything else', () => {
    expect(readFilterQuery('?sortField=metadata.date&sortOrder=asc')).toMatchObject({ sortField: 'metadata.date', sortOrder: 'asc' });
    expect(readFilterQuery('?sortField=title')).toMatchObject({ sortField: 'title' });
    expect(readFilterQuery('?sortField=metadata.').sortField).toBeNull();
    expect(readFilterQuery('?sortField=date').sortField).toBeNull();
  });
  it('are removed by a null, as leaving a notebook does', () => {
    const search = writeFilterQuery('?sortField=metadata.date&sortOrder=asc&view=list', { sortField: null, sortOrder: null });
    expect(new URLSearchParams(search).has('sortField')).toBe(false);
    expect(new URLSearchParams(search).has('sortOrder')).toBe(false);
    expect(new URLSearchParams(search).get('view')).toBe('list');
  });
});

describe('metadata entries of the sort menu', () => {
  const t = ((key: string, params?: Record<string, string>) => `${key}|${params?.key ?? ''}`) as Parameters<typeof metadataSortOptions>[0];
  it('offer both orders of each metadata field, labelled by the key', () => {
    expect(metadataSortOptions(t, ['metadata.date'])).toEqual([{ value: 'metadata.date:desc', label: 'sort.metadataDesc|date' }, { value: 'metadata.date:asc', label: 'sort.metadataAsc|date' }]);
  });
  it('list a field once and ignore anything that is no metadata field', () => {
    expect(metadataSortOptions(t, ['metadata.date', 'metadata.date', 'title', 'metadata.'])).toHaveLength(2);
    expect(metadataSortOptions(t, [])).toEqual([]);
  });
});
