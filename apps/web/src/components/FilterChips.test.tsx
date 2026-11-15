// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { FilterChips } from './FilterChips.js';

beforeEach(() => window.localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const controls = (value: Partial<NoteFilters> = {}, extra: Partial<FilterControls> = {}): FilterControls => ({ value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life/' }], folders: [], tags: [], statuses: [], count: 1, onChange: vi.fn(), allNotebooks: false, onAllNotebooksChange: vi.fn(), onClear: vi.fn(), ...extra });
const chips = (filters: FilterControls, onAdd = vi.fn()) => {
  render(createElement(I18nProvider, null, createElement(FilterChips, { filters, onAdd })));
  return onAdd;
};

it('shows the notebook as context, and each folder, status, tag and the search as a removable chip', () => {
  const filters = controls({ folders: ['notes/life/projects'], status: 'todo', tags: ['work', 'home'], q: 'plan' });
  chips(filters);
  const group = screen.getByRole('group', { name: 'Active filters' });
  expect([...group.querySelectorAll('[data-filter-chip]')].map(chip => chip.textContent)).toEqual(['Life', 'projects', 'todo', '#work', '#home', '“plan”']);
  // The notebook is what is listed, not a filter to take off.
  expect(within(group).queryByRole('button', { name: 'Remove Life' })).toBeNull();
  fireEvent.click(within(group).getByRole('button', { name: 'Remove projects' }));
  expect(filters.onChange).toHaveBeenCalledWith({ folders: [] });
  fireEvent.click(within(group).getByRole('button', { name: 'Remove todo' }));
  expect(filters.onChange).toHaveBeenCalledWith({ status: null });
  fireEvent.click(within(group).getByRole('button', { name: 'Remove #work' }));
  expect(filters.onChange).toHaveBeenCalledWith({ tags: ['home'] });
  fireEvent.click(within(group).getByRole('button', { name: 'Remove “plan”' }));
  expect(filters.onChange).toHaveBeenCalledWith({ q: '' });
});

it('shows outlines and compilations, and every notebook, as chips that can be taken off', () => {
  const filters = controls({ kind: 'compilation' }, { allNotebooks: true });
  chips(filters);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Compilations' }));
  expect(filters.onChange).toHaveBeenCalledWith({ kind: 'note' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove All notebooks' }));
  expect(filters.onAllNotebooksChange).toHaveBeenCalledWith(false);
});

it('offers "Clear all" once more than one filter is on', () => {
  const one = controls({ status: 'todo' });
  chips(one);
  expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  cleanup();
  const two = controls({ status: 'todo', tags: ['work'] });
  chips(two);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(two.onClear).toHaveBeenCalled();
});

it('opens the filters from "+ Filter" and from the chip for the notebook', () => {
  const onAdd = chips(controls());
  fireEvent.click(screen.getByRole('button', { name: 'Add a filter' }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Life' }));
  expect(onAdd).toHaveBeenCalledTimes(2);
});
