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

function dock(filters = controls(), extra: Record<string, unknown> = {}) {
  const onSelectFolder = vi.fn();
  const props = { filters, facets, folders, selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder, workspaceTagNames: Object.keys(manyTags), dock: 'filters' as 'filters' | 'folders', ...extra };
  const view = render(createElement(I18nProvider, null, createElement(Sidebar, props)));
  return { ...view, onSelectFolder, rerenderWith: (next: FilterControls) => view.rerender(createElement(I18nProvider, null, createElement(Sidebar, { ...props, filters: next }))) };
}

const tree = () => screen.getByRole('navigation', { name: 'Notebooks' });
const statusGroup = () => screen.getByRole('group', { name: 'Status' });
const tagGroup = () => screen.getByRole('group', { name: 'Tags' });

it('shows the folder tree, the status chips and the tag chips together, with no rail and no collapsible sections', () => {
  dock();
  expect(within(tree()).getByText('Projects')).toBeInTheDocument();
  expect(within(statusGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(statusGroup()).getByRole('button', { name: /^todo/ })).toHaveTextContent('5');
  expect(within(tagGroup()).getByRole('button', { name: /^work/ })).toHaveTextContent('9');
  expect(document.querySelector('.sidebar-rail')).toBeNull();
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Filter by/ })).toBeNull();
  expect(document.querySelector('details')).toBeNull();
});

it('keeps the tree in view while a folder, a status and a tag are picked, and reports each', () => {
  const onChange = vi.fn();
  const { onSelectFolder } = dock(controls({}, onChange));
  fireEvent.click(within(tree()).getByRole('button', { name: /^Projects/ }));
  expect(onSelectFolder).toHaveBeenCalledWith('projects');
  expect(within(tree()).getByText('Projects')).toBeVisible();
  fireEvent.click(within(statusGroup()).getByRole('button', { name: /^done/ }));
  expect(onChange).toHaveBeenCalledWith({ status: 'done' });
  fireEvent.click(within(tagGroup()).getByRole('button', { name: /^home/ }));
  expect(onChange).toHaveBeenLastCalledWith({ tags: ['home'] });
  expect(within(tree()).getByText('Projects')).toBeVisible();
  expect(statusGroup()).toBeVisible();
});

it('marks the status and tags in force', () => {
  dock(controls({ status: 'todo', tags: ['home'] }));
  expect(within(statusGroup()).getByRole('button', { name: /^todo/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(statusGroup()).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
  expect(within(tagGroup()).getByRole('button', { name: /^home/ })).toHaveAttribute('aria-pressed', 'true');
});

it('lists the most used tags and keeps the rest behind More…, which shows them all', () => {
  dock(controls({ tags: ['garden'] }));
  const shown = () => [...tagGroup().querySelectorAll('[data-tag-filter]')].map(button => button.getAttribute('data-tag-filter'));
  // The six most used, then a tag in force even though it is used least.
  expect(shown()).toEqual(['work', 'home', 'reading', 'writing', 'thesis', 'ideas', 'garden']);
  const more = within(tagGroup()).getByRole('button', { name: 'More…' });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  expect(shown()).toEqual(['work', 'home', 'reading', 'writing', 'thesis', 'ideas', 'travel', 'music', 'garden']);
  expect(within(tagGroup()).getByRole('button', { name: 'Fewer' })).toHaveAttribute('aria-expanded', 'true');
});

it('offers no More… when every tag fits', () => {
  dock(controls(), { facets: { life: { ...facets.life, tags: { work: 2, home: 1 } } } });
  expect(within(tagGroup()).queryByRole('button', { name: 'More…' })).toBeNull();
});

it('shows the live editing group among the status chips when the repository is live', () => {
  const onChange = vi.fn();
  dock(controls({}, onChange, true));
  const live = screen.getByRole('group', { name: 'Live editing' });
  fireEvent.click(within(live).getByRole('button', { name: 'Editing' }));
  expect(onChange).toHaveBeenCalledWith({ live: ['editing'] });
  cleanup();
  dock(controls({}, () => {}, false));
  expect(screen.queryByRole('group', { name: 'Live editing' })).toBeNull();
});

it("holds only the folder tree on a phone's list screen", () => {
  dock(controls(), { dock: 'folders' });
  expect(within(tree()).getByText('Projects')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Tags' })).toBeNull();
});

/** Roles and names of the usual sidebar, which normal browsing keeps unchanged. */
function landmarks() {
  return [...document.querySelectorAll('aside, nav, section[aria-label], details, [role="tree"], [role="group"], [role="status"]')].map(element => {
    const summary = element.tagName === 'DETAILS' ? element.querySelector(':scope > summary')?.textContent : undefined;
    return [element.tagName.toLowerCase(), element.getAttribute('role'), element.getAttribute('aria-label'), summary].filter(Boolean).join(' ');
  });
}

it('leaves the usual sidebar as it was without the dock', () => {
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
