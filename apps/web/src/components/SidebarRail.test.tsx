// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { NOTE_MOVE_DRAG_TYPE } from '../lib/note-drag.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { Sidebar } from './Sidebar.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2, home: 1 }, directories: {}, outlines: kind, compilations: { total: 3, statuses: {}, tags: {} } } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const controls = (value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}): FilterControls => ({ value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }], folders: [], tags: ['work', 'home'], statuses: ['todo', 'done'], count: 7, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} });

function rail(filters = controls(), extra: Record<string, unknown> = {}) {
  const onSelectFolder = vi.fn();
  const onDropNote = vi.fn();
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters, facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder, onDropNote, workspaceTagNames: ['work'], changeCount: 2, rail: true, ...extra })));
  return { onSelectFolder, onDropNote };
}

const button = (section: string) => screen.getByRole('button', { name: `Filter by ${section}` });

it('folds to one icon per section: Notebooks, Status, Tags and Changes, with no section expanded', () => {
  rail();
  expect(['Notebooks', 'Status', 'Tags', 'Changes'].map(name => button(name))).toHaveLength(4);
  expect(document.querySelector('details')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  // Dirty changes show as a count on the Changes icon.
  expect(within(button('Changes')).getByText('2')).toBeInTheDocument();
});

it('opens a section as a flyout beside the rail and closes it on Escape, on an outside press, and on its close button', () => {
  rail();
  fireEvent.click(button('Status'));
  const flyout = screen.getByRole('dialog', { name: 'Status' });
  expect(within(flyout).getByRole('button', { name: /^todo/ })).toBeInTheDocument();
  expect(button('Status')).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(button('Tags'));
  expect(screen.getByRole('dialog', { name: 'Tags' })).toBeInTheDocument();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(button('Notebooks'));
  fireEvent.click(screen.getByRole('button', { name: 'Close filters' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps one flyout at a time and toggles it from its own icon', () => {
  rail();
  fireEvent.click(button('Status'));
  fireEvent.click(button('Tags'));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Tags');
  fireEvent.click(button('Tags'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes after a status is picked, and after a folder or notebook is picked', () => {
  const onChange = vi.fn();
  const { onSelectFolder } = rail(controls({}, onChange));
  fireEvent.click(button('Status'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^done/ }));
  expect(onChange).toHaveBeenCalledWith({ status: 'done' });
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(button('Notebooks'));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Life/ }));
  expect(onSelectFolder).toHaveBeenCalledWith(null);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('stays open while tags are toggled, so several can be picked, and still reports each', () => {
  const onChange = vi.fn();
  rail(controls({}, onChange));
  fireEvent.click(button('Tags'));
  const flyout = screen.getByRole('dialog');
  fireEvent.click(within(flyout).getByRole('button', { name: /^work/ }));
  expect(onChange).toHaveBeenCalledWith({ tags: ['work'] });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('marks the icons whose filter is on, with a count for tags', () => {
  rail(controls({ status: 'todo', tags: ['work', 'home'] }));
  expect(button('Status')).toHaveAttribute('data-active');
  expect(within(button('Tags')).getByText('2')).toBeInTheDocument();
  expect(button('Notebooks')).not.toHaveAttribute('data-active');
});

it('can be opened by its owner, as the list\'s "+ Filter" chip does', () => {
  const onRailSectionChange = vi.fn();
  rail(controls(), { railSection: 'tags', onRailSectionChange });
  expect(screen.getByRole('dialog', { name: 'Tags' })).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(onRailSectionChange).toHaveBeenCalledWith(null);
});

it('holds the Changes section too, with its pending count', () => {
  rail();
  fireEvent.click(button('Changes'));
  expect(within(screen.getByRole('dialog', { name: 'Changes' })).getByText('2 dirty')).toBeInTheDocument();
});

it('opens the notebooks when a note is dragged onto their icon, so it can be dropped on a folder', () => {
  rail();
  act(() => {
    fireEvent.dragEnter(button('Notebooks'), { dataTransfer: { types: [NOTE_MOVE_DRAG_TYPE] } });
  });
  expect(screen.getByRole('dialog', { name: 'Notebooks' })).toBeInTheDocument();
});

it('is the usual expanded sidebar when it is not a rail', () => {
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters: controls(), facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: () => {}, workspaceTagNames: ['work'], changeCount: 0 })));
  expect([...document.querySelectorAll('details.sidebar-filter-section > summary')].map(summary => summary.textContent)).toEqual(['Notebooks', 'Status', 'Tags']);
  expect(screen.queryByRole('button', { name: /^Filter by/ })).toBeNull();
});
