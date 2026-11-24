import { createLoader, createSerializer } from 'nuqs/server';
import { type NotebookFacets, noteQueryStatuses } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from './types.js';
import { LIST_FILTER_PREFIX, noteDemoViewWriteIn, storageOwner } from './demo-storage.js';
import { filterParsers } from './filter-query.js';

const { tag, tagMode, status, live, showHidden, groupByFolder, kind, descendants } = filterParsers;
const parsers = { tag, tagMode, status, live, showHidden, groupByFolder, kind, descendants };
const parse = createLoader(parsers);
const serialize = createSerializer(parsers);
const keys = Object.keys(parsers);
export const changesListFilters = (patch: object) => keys.some(key => Object.hasOwn(patch, key));
const keyFor = (repository: string, notebook: string) => `${LIST_FILTER_PREFIX}${storageOwner(repository)}:${notebook}`;

export function removeListFilters(query: URLSearchParams) {
  for (const key of keys) query.delete(key);
}

export function rememberListFilters(repository: string, notebook: string, query: URLSearchParams) {
  try {
    const key = keyFor(repository, notebook);
    const value = serialize(parse(query));
    if (!value) localStorage.removeItem(key);
    else if (localStorage.getItem(key) !== value && noteDemoViewWriteIn(repository)) localStorage.setItem(key, value);
  } catch {
    // The URL still works when browser storage is unavailable.
  }
}

/** An explicit URL replaces the preference as a whole. Only restored values are pruned against notebook data. */
export function restoreListFilters(repository: string, notebook: string, search: string, facets: NotebookFacets | undefined, notebooks: NotebookConfig[]): string | null {
  const query = new URLSearchParams(search);
  if (keys.some(key => query.has(key))) {
    rememberListFilters(repository, notebook, query);
    return null;
  }
  let saved: string | null;
  try {
    saved = localStorage.getItem(keyFor(repository, notebook));
  } catch {
    return null;
  }
  if (!saved) return null;
  const filters = parse(new URLSearchParams(saved));
  if (filters.tag.length || filters.status) {
    if (!facets) return null; // Wait for this notebook's full vocabulary, including hidden notes.
    const vocab = filters.kind === 'outline' ? facets.outlines : filters.kind === 'compilation' ? facets.compilations : facets;
    filters.tag = filters.tag.filter(name => Object.hasOwn(vocab.tags, name));
    if (filters.status && !noteQueryStatuses(notebooks, notebook, Object.keys(vocab.statuses)).includes(filters.status)) filters.status = null;
  }
  const restored = serialize(filters);
  rememberListFilters(repository, notebook, new URLSearchParams(restored));
  if (!restored) return null;
  for (const [key, value] of new URLSearchParams(restored)) query.append(key, value);
  return query.toString();
}
