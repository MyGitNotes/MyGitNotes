// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { Sidebar } from './Sidebar.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: kind } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function controls(value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}, liveAvailable?: boolean): FilterControls {
  return { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }], folders: [], tags: ['work'], statuses: ['todo', 'done'], count: 7, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {}, ...(liveAvailable === undefined ? {} : { liveAvailable }) };
}

const sidebar = (filters: FilterControls, extra: { filtersOnly?: boolean; } = {}) => render(createElement(I18nProvider, null, createElement(Sidebar, { filters, facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: vi.fn(), workspaceTagNames: ['work'], ...extra })));

it('offers no live editing filter without a live repository', () => {
  sidebar(controls());
  expect(screen.queryByRole('group', { name: 'Live editing' })).toBeNull();
  expect(document.querySelector('[data-live-filter]')).toBeNull();
  cleanup();
  sidebar(controls({}, () => {}, false));
  expect(screen.queryByRole('group', { name: 'Live editing' })).toBeNull();
});

it('lists Editing and Not filed under Live editing, and selects either or both', () => {
  const onChange = vi.fn();
  const { rerender } = sidebar(controls({}, onChange, true));
  const group = screen.getByRole('group', { name: 'Live editing' });
  const editing = within(group).getByRole('button', { name: 'Editing' });
  const pending = within(group).getByRole('button', { name: 'Not filed' });
  expect(editing).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(editing);
  expect(onChange).toHaveBeenLastCalledWith({ live: ['editing'] });

  rerender(createElement(I18nProvider, null, createElement(Sidebar, { filters: controls({ live: ['editing'] }, onChange, true), facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: vi.fn(), workspaceTagNames: ['work'] })));
  expect(within(screen.getByRole('group', { name: 'Live editing' })).getByRole('button', { name: 'Editing' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(screen.getByRole('group', { name: 'Live editing' })).getByRole('button', { name: 'Not filed' }));
  expect(onChange).toHaveBeenLastCalledWith({ live: ['editing', 'pending'] });
  fireEvent.click(within(screen.getByRole('group', { name: 'Live editing' })).getByRole('button', { name: 'Editing' }));
  expect(onChange).toHaveBeenLastCalledWith({ live: [] });
  expect(pending).toBeTruthy();
});

it("shows the live editing filter in a phone's filter sheet too", () => {
  sidebar(controls({}, () => {}, true), { filtersOnly: true });
  expect(screen.getByRole('group', { name: 'Live editing' })).toBeInTheDocument();
});

it('labels the live editing filter in Traditional Chinese', () => {
  window.localStorage.setItem('github-notes:language', 'zh-TW');
  sidebar(controls({}, () => {}, true));
  const group = screen.getByRole('group', { name: '即時編輯' });
  expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['編輯中', '未歸檔']);
});
