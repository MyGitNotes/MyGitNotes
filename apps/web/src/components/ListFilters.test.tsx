// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import type { FolderItem } from '../lib/types.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { Sidebar } from './Sidebar.js';
import { StatusFilterBody, TagFilterBody } from './ListFilters.js';

const kind = { total: 0, statuses: {}, tags: {} };
const manyTags = { work: 9, home: 8, reading: 7, writing: 6, thesis: 5, ideas: 4, travel: 3, music: 2, garden: 1 };
const facets: Record<string, NotebookFacets> = { life: { total: 12, hidden: 0, statuses: { todo: 5, done: 7 }, tags: manyTags, directories: {}, outlines: kind, compilations: kind } };
const folders: FolderItem[] = [{ notebookId: 'life', path: 'projects', title: 'Projects', order: 0 }, { notebookId: 'life', path: 'inbox', title: 'Inbox', order: 1 }];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const controls = (value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}, liveAvailable?: boolean): FilterControls => ({ value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }], folders: [], tags: Object.keys(manyTags), statuses: ['todo', 'done'], count: 12, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {}, ...(liveAvailable === undefined ? {} : { liveAvailable }) });

/** The Status and Tags panels of the list column's filter buttons, which took the chips the browse dock showed beside a Focus. */
function panels(filters = controls(), tagFacets: Record<string, number> = manyTags) {
  const counts = { total: 12, statuses: { todo: 5, done: 7 }, tags: tagFacets };
  const view = (next: FilterControls) => createElement(I18nProvider, null, createElement('div', { role: 'group', 'aria-label': 'Status' }, createElement(StatusFilterBody, { filters: next, counts })), createElement('div', { role: 'group', 'aria-label': 'Tags' }, createElement(TagFilterBody, { filters: next, counts, notebookId: 'life' })));
  const result = render(view(filters));
  return { ...result, rerenderWith: (next: FilterControls) => result.rerender(view(next)) };
}

const tree = () => screen.getByRole('navigation', { name: 'Notebooks' });
const statusGroup = () => screen.getByRole('group', { name: 'Status' });
const tagGroup = () => screen.getByRole('group', { name: 'Tags' });
const shownTags = () => [...tagGroup().querySelectorAll('[data-tag-filter]')].map(button => button.getAttribute('data-tag-filter'));

it('shows every status with its count and every tag with its count, All in force at first', () => {
  panels();
  expect(within(statusGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(statusGroup()).getByRole('button', { name: /^All/ })).toHaveTextContent('12');
  expect(within(statusGroup()).getByRole('button', { name: /^todo/ })).toHaveTextContent('5');
  expect(within(tagGroup()).getByRole('button', { name: /^work/ })).toHaveTextContent('9');
  expect(document.querySelector('.sidebar-rail')).toBeNull();
  expect(document.querySelector('details')).toBeNull();
});

it('reports a status and a tag picked', () => {
  const onChange = vi.fn();
  panels(controls({}, onChange));
  fireEvent.click(within(statusGroup()).getByRole('button', { name: /^done/ }));
  expect(onChange).toHaveBeenCalledWith({ status: 'done' });
  fireEvent.click(within(tagGroup()).getByRole('button', { name: /^home/ }));
  expect(onChange).toHaveBeenLastCalledWith({ tags: ['home'] });
});

it('marks the status and tags in force', () => {
  panels(controls({ status: 'todo', tags: ['home'] }));
  expect(within(statusGroup()).getByRole('button', { name: /^todo/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(statusGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
  expect(within(tagGroup()).getByRole('button', { name: /^home/ })).toHaveAttribute('aria-pressed', 'true');
});

it('lists the most used tags first when asked, and narrows the tags by their search, keeping a tag in force reachable', () => {
  window.localStorage.setItem('github-notes:tag-sort', 'count-desc');
  panels(controls({ tags: ['garden'] }));
  expect(shownTags()).toEqual(['work', 'home', 'reading', 'writing', 'thesis', 'ideas', 'travel', 'music', 'garden']);
  fireEvent.change(within(tagGroup()).getByRole('searchbox', { name: 'Search tags' }), { target: { value: 'ing' } });
  expect(shownTags()).toEqual(['reading', 'writing']);
  // The tag in force but out of the search's reach stays one press away from clearing.
  expect(within(tagGroup()).getByRole('button', { name: /garden/ })).toBeInTheDocument();
});

it('offers no More… now that the panel lists every tag', () => {
  panels(controls(), { work: 2, home: 1 });
  expect(within(tagGroup()).queryByRole('button', { name: 'More…' })).toBeNull();
  expect(shownTags()).toEqual(['home', 'work']);
});

it('shows the live editing group in the status panel when the repository is live', () => {
  const onChange = vi.fn();
  panels(controls({}, onChange, true));
  const live = screen.getByRole('group', { name: 'Live editing' });
  fireEvent.click(within(live).getByRole('button', { name: 'Editing' }));
  expect(onChange).toHaveBeenCalledWith({ live: ['editing'] });
  cleanup();
  panels(controls({}, () => {}, false));
  expect(screen.queryByRole('group', { name: 'Live editing' })).toBeNull();
});

it("holds only the folder tree on a phone's list screen", () => {
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters: controls(), facets, folders, selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: () => {}, workspaceTagNames: Object.keys(manyTags), dock: 'folders' })));
  expect(within(tree()).getByText('Projects')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
});

/** Roles and names of a phone's drawer, which the three columns leave unchanged. */
function landmarks() {
  return [...document.querySelectorAll('aside, nav, section[aria-label], details, [role="tree"], [role="group"], [role="status"]')].map(element => {
    const summary = element.tagName === 'DETAILS' ? element.querySelector(':scope > summary')?.textContent : undefined;
    return [element.tagName.toLowerCase(), element.getAttribute('role'), element.getAttribute('aria-label'), summary].filter(Boolean).join(' ');
  });
}

it("leaves a phone's drawer of notebooks and filters as it was", () => {
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters: controls(), facets, folders, selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: () => {}, workspaceTagNames: ['work'] })));
  expect(landmarks()).toMatchInlineSnapshot(`
    [
      "aside Status Filter",
      "section Filters",
      "div group Notebooks",
      "span status",
      "details Notebooks",
      "nav Notebooks",
      "section Folders",
      "nav Folders",
      "div status",
      "details Status",
      "details Tags Tags",
      "p status",
      "div group Match tags",
    ]
  `);
});
