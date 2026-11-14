// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useNoteSort } from './useNoteSort.js';
import { saveNotebookSort, SORT_FIELD_STORAGE_KEY, SORT_ORDER_STORAGE_KEY } from '../lib/note-sort.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const meetings = { default_sort: { field: 'metadata.date', order: 'desc' } } as const;
const router = (search = '') => ({ children }: { children: ReactNode; }) => createElement(MemoryRouter, { initialEntries: [`/notes/docs~meetings${search}`] }, children);
const setup = (key: string, notebook: Parameters<typeof useNoteSort>[1], search = '') => renderHook((props: { key: string; notebook: Parameters<typeof useNoteSort>[1]; }) => ({ sort: useNoteSort(props.key, props.notebook), location: useLocation() }), { wrapper: router(search), initialProps: { key, notebook } });

describe('useNoteSort', () => {
  it('starts with DEFAULT_SORT where nothing else applies', () => {
    const { result } = setup('docs~notes', undefined);
    expect(result.current.sort).toMatchObject({ sortField: 'updated', sortOrder: 'desc' });
  });
  it("starts with the notebook's default_sort", () => {
    const { result } = setup('docs~meetings', meetings);
    expect(result.current.sort).toMatchObject({ sortField: 'metadata.date', sortOrder: 'desc' });
  });
  it('lets the default_sort beat the browser-wide sort saved earlier, which still serves notebooks without one', () => {
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, 'title');
    window.localStorage.setItem(SORT_ORDER_STORAGE_KEY, 'asc');
    expect(setup('docs~meetings', meetings).result.current.sort).toMatchObject({ sortField: 'metadata.date', sortOrder: 'desc' });
    expect(setup('docs~notes', undefined).result.current.sort).toMatchObject({ sortField: 'title', sortOrder: 'asc' });
  });
  it('lets what the person chose for the notebook beat the default_sort and the saved sort', () => {
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, 'created');
    saveNotebookSort('docs~meetings', 'title', 'asc');
    expect(setup('docs~meetings', meetings).result.current.sort).toMatchObject({ sortField: 'title', sortOrder: 'asc' });
  });
  it('lets a sort in the URL beat all of them', () => {
    saveNotebookSort('docs~meetings', 'title', 'asc');
    expect(setup('docs~meetings', meetings, '?sortField=created&sortOrder=asc').result.current.sort).toMatchObject({ sortField: 'created', sortOrder: 'asc' });
    expect(setup('docs~meetings', meetings, '?sortField=metadata.room').result.current.sort).toMatchObject({ sortField: 'metadata.room', sortOrder: 'asc' });
  });
  it('saves a choice for its notebook only, and into the URL', () => {
    window.localStorage.setItem(SORT_FIELD_STORAGE_KEY, 'created');
    const { result } = setup('docs~meetings', meetings);
    act(() => result.current.sort.handleSortChange('title', 'desc'));
    expect(JSON.parse(window.localStorage.getItem('github-notes:sort:docs~meetings')!)).toEqual({ field: 'title', order: 'desc' });
    expect(window.localStorage.getItem('github-notes:sort:docs~notes')).toBeNull();
    expect(window.localStorage.getItem(SORT_FIELD_STORAGE_KEY)).toBe('created');
    expect(new URLSearchParams(result.current.location.search).get('sortField')).toBe('title');
    expect(result.current.sort).toMatchObject({ sortField: 'title', sortOrder: 'desc' });
  });
  it('returns to the metadata field from the menu, newest first', () => {
    const { result } = setup('docs~meetings', meetings);
    act(() => result.current.sort.handleSortChange('title'));
    expect(result.current.sort).toMatchObject({ sortField: 'title', sortOrder: 'asc' });
    act(() => result.current.sort.handleSortChange('metadata.date'));
    expect(result.current.sort).toMatchObject({ sortField: 'metadata.date', sortOrder: 'desc' });
    act(() => result.current.sort.handleSortChange('metadata.date'));
    expect(result.current.sort).toMatchObject({ sortField: 'metadata.date', sortOrder: 'asc' });
  });
  it("follows the notebook it is given, each with its own choice and default", () => {
    saveNotebookSort('docs~notes', 'status', 'asc');
    const { result, rerender } = setup('docs~meetings', meetings);
    expect(result.current.sort.sortField).toBe('metadata.date');
    rerender({ key: 'docs~notes', notebook: undefined });
    expect(result.current.sort).toMatchObject({ sortField: 'status', sortOrder: 'asc' });
    rerender({ key: 'docs~other', notebook: undefined });
    expect(result.current.sort).toMatchObject({ sortField: 'updated', sortOrder: 'desc' });
  });
  it("offers the default_sort's metadata field, and the one in force, in the sort menu", () => {
    expect(setup('docs~meetings', meetings).result.current.sort.metadataSortFields).toEqual(['metadata.date']);
    expect(setup('docs~notes', undefined).result.current.sort.metadataSortFields).toEqual([]);
    expect(setup('docs~meetings', meetings, '?sortField=metadata.room').result.current.sort.metadataSortFields).toEqual(['metadata.date', 'metadata.room']);
    expect(setup('docs~meetings', { default_sort: { field: 'title', order: 'asc' } }).result.current.sort.metadataSortFields).toEqual([]);
  });
});
