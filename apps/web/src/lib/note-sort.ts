import { BUILTIN_SORT_FIELDS, isSortField, type SortField, type SortOrder } from '@mygitnotes/core/note-sort';

export { isSortField, metadataSortKey, noteCreatedTime, noteUpdatedTime, type SortField, sortNotes, type SortOrder } from '@mygitnotes/core/note-sort';

export interface SortConfig {
  field: SortField;
  order: SortOrder;
}

export const SORT_FIELD_STORAGE_KEY = 'github-notes:sort-field';
export const SORT_ORDER_STORAGE_KEY = 'github-notes:sort-order';

export const DEFAULT_SORT: SortConfig = { field: 'updated', order: 'desc' };

const validOrders: SortOrder[] = ['asc', 'desc'];

/**
 * The sort saved for the whole browser before notebooks had their own, or undefined when none was saved.
 * It is only read: a sort the person picks is saved for its notebook.
 */
export function getStoredGlobalSort(): SortConfig | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    const rawField = window.localStorage.getItem(SORT_FIELD_STORAGE_KEY);
    const rawOrder = window.localStorage.getItem(SORT_ORDER_STORAGE_KEY);
    const field = (BUILTIN_SORT_FIELDS as readonly string[]).includes(rawField ?? '') ? (rawField as SortField) : undefined;
    const order = validOrders.includes(rawOrder as SortOrder) ? (rawOrder as SortOrder) : undefined;
    return field || order ? { field: field ?? DEFAULT_SORT.field, order: order ?? DEFAULT_SORT.order } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads sort configuration from localStorage with safe fallback to DEFAULT_SORT.
 */
export function getSavedSort(): SortConfig {
  return getStoredGlobalSort() ?? DEFAULT_SORT;
}

export const NOTEBOOK_SORT_STORAGE_PREFIX = 'github-notes:sort:';

/** The sort the person chose for one notebook, by notebook key, or undefined when they chose none (or the saved value is unusable). */
export function getNotebookSort(notebookKey: string): SortConfig | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_SORT_STORAGE_PREFIX + notebookKey);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { field?: unknown; order?: unknown; } | null;
    return value && isSortField(value.field) && validOrders.includes(value.order as SortOrder) ? { field: value.field, order: value.order as SortOrder } : undefined;
  } catch {
    return undefined;
  }
}

/** Persists the sort the person chose for one notebook; other notebooks and the browser-wide sort are left alone. */
export function saveNotebookSort(notebookKey: string, field: SortField, order: SortOrder): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(NOTEBOOK_SORT_STORAGE_PREFIX + notebookKey, JSON.stringify({ field, order }));
  } catch {
    // ignore quota / storage errors
  }
}

/**
 * The sort a notebook's lists start with: what the person chose for that notebook, else the notebook's manifest
 * `default_sort`, else the browser-wide sort saved before notebooks had their own, else DEFAULT_SORT.
 */
export function resolveNoteSort({ explicit, defaultSort, saved }: { explicit?: SortConfig; defaultSort?: SortConfig; saved?: SortConfig; }): SortConfig {
  return explicit ?? defaultSort ?? saved ?? DEFAULT_SORT;
}
