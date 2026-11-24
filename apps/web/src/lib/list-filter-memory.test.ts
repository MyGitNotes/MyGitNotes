// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { rememberListFilters, restoreListFilters } from './list-filter-memory.js';

const vocab = { total: 1, hidden: 0, tags: { present: 1 }, statuses: { active: 1 }, directories: {}, compilations: { total: 0, tags: {}, statuses: {} }, outlines: { total: 0, tags: {}, statuses: {} } };
const save = (search: string) => rememberListFilters('repo', 'book', new URLSearchParams(search));
const restore = (search = '') => restoreListFilters('repo', 'book', search, vocab, []);
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('stores only list filters and prunes retired values using the saved kind’s facets', () => {
  save('tag=present&tag=gone&status=retired&tagMode=all&live=editing&showHidden=true&groupByFolder=true&descendants=false&neighbors=true&q=secret&folders=a&view=list&sortField=title&allNotebooks=true');
  expect(restoreListFilters('repo', 'book', '', undefined, [])).toBeNull();
  expect(Object.fromEntries(new URLSearchParams(restore('q=current')!))).toEqual({ tag: 'present', tagMode: 'all', live: 'editing', showHidden: 'true', groupByFolder: 'true', descendants: 'false', q: 'current' });
  save('kind=outline&tag=present');
  expect(restore()).toBe('kind=outline');
});

it('uses the URL’s complete selection, even when it explicitly selects a default', () => {
  save('groupByFolder=true');
  expect(restore('tag=present')).toBeNull();
  expect(restore()).toBe('tag=present');
  expect(restore('showHidden=false')).toBeNull();
  expect(restore()).toBeNull();
  expect(localStorage.length).toBe(0);
});

it('parses stored values with URL parsers and clears empty preferences', () => {
  localStorage.setItem('github-notes:list-filters:repo:book', '?kind=invalid&live=no&live=editing&q=ignore&tagMode=invalid');
  expect(restore()).toBe('live=editing');
  save('');
  expect(localStorage.length).toBe(0);
});

it('still browses when storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  save('groupByFolder=true');
  expect(restore()).toBeNull();
});
