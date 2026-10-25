// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PhoneFilterSheet, PhoneListBar, type PhoneListBarProps } from './PhoneListBar.js';
import type { NoteSearchHandle } from './NoteToolbar.js';

beforeAll(() => {
  // Radix Select measures and captures the pointer, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});
beforeEach(() => window.localStorage.setItem('github-notes:language', 'en'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const props = (extra: Partial<PhoneListBarProps> = {}): PhoneListBarProps => ({ notebooks: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }] as never, selectedNotebookId: 'a', onSelectNotebook: vi.fn(), query: '', onQueryChange: vi.fn(), filtersOpen: false, onToggleFilters: vi.fn(), ...extra });
const bar = (extra: Partial<PhoneListBarProps> = {}) => render(createElement(I18nProvider, null, createElement(PhoneListBar, props(extra))));

it('is one bar: the sidebar drawer, the notebook switcher and the search', () => {
  const onToggleFilters = vi.fn();
  bar({ onToggleFilters });
  const group = within(screen.getByRole('group', { name: 'Notes' }));
  fireEvent.click(group.getByRole('button', { name: 'Notebooks and filters' }));
  expect(onToggleFilters).toHaveBeenCalledTimes(1);
  expect(group.getByRole('combobox', { name: 'Notebooks' })).toHaveTextContent('Alpha');
  expect(group.getByRole('button', { name: 'Search notes, tags, content...' })).toBeInTheDocument();
});

it('opens the search over the bar, which sends what is typed, and the command that focuses it opens it first', () => {
  const onQueryChange = vi.fn();
  const searchRef = createRef<NoteSearchHandle>();
  bar({ onQueryChange, searchRef });
  const search = document.getElementById('note-toolbar-search')!;
  expect(search).not.toHaveAttribute('data-open');
  fireEvent.click(screen.getByRole('button', { name: 'Search notes, tags, content...', expanded: false }));
  expect(search).toHaveAttribute('data-open');
  fireEvent.change(within(search).getByRole('searchbox'), { target: { value: 'plan' } });
  expect(onQueryChange).toHaveBeenCalledWith('plan');
  fireEvent.click(within(search).getByRole('button', { name: 'Close' }));
  expect(search).not.toHaveAttribute('data-open');
  act(() => searchRef.current!.focus());
  expect(search).toHaveAttribute('data-open');
});

it("holds the list's view, order and hidden notes in the filter sheet, above the filter sections", () => {
  const onShowHiddenChange = vi.fn(), onSortChange = vi.fn(), onClose = vi.fn(), onChange = vi.fn();
  render(createElement(
    I18nProvider,
    null,
    (<PhoneFilterSheet onClose={onClose} sortField='updated' sortOrder='desc' onSortChange={onSortChange} viewMode='flat' setViewMode={vi.fn()} showHidden={false} hiddenNoteCount={4} onShowHiddenChange={onShowHiddenChange} groupByFolder={{ value: false, onChange }}>
      <p>Status and tags go here</p>
    </PhoneFilterSheet>),
  ));
  const sheet = within(screen.getByRole('dialog', { name: 'Filter and sort' }));
  expect(sheet.getByRole('combobox', { name: 'Sort' })).toBeInTheDocument();
  expect(sheet.getByRole('combobox', { name: 'Note view' })).toBeInTheDocument();
  fireEvent.click(sheet.getByRole('button', { name: /Show hidden notes \(4\)/ }));
  expect(onShowHiddenChange).toHaveBeenCalledWith(true);
  fireEvent.click(sheet.getByRole('button', { name: 'Group by folder' }));
  expect(onChange).toHaveBeenCalledWith(true);
  expect(sheet.getByText('Status and tags go here')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
