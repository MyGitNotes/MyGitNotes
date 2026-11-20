// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { createElement, createRef, useState } from 'react';
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

function SearchingBar() {
  const [query, setQuery] = useState('');
  return createElement(PhoneListBar, props({ query, onQueryChange: setQuery }));
}

it('keeps one ✕: with a search it clears and keeps the cursor, pressed again it closes and returns to the button', () => {
  render(createElement(I18nProvider, null, createElement(SearchingBar)));
  const search = document.getElementById('note-toolbar-search')!;
  const toggle = screen.getByRole('button', { name: 'Search notes, tags, content...', expanded: false });
  fireEvent.click(toggle);
  const input = within(search).getByRole('searchbox');
  expect(input).toHaveClass('note-search-input');
  fireEvent.change(input, { target: { value: 'plan' } });
  expect(within(search).getAllByRole('button')).toHaveLength(1);
  const clear = within(search).getByRole('button', { name: 'Clear search' });
  expect(clear).toHaveAttribute('title', 'Clear search');
  fireEvent.click(clear);
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(search).toHaveAttribute('data-open');
  const close = within(search).getByRole('button', { name: 'Close' });
  expect(close).toHaveAttribute('title', 'Close');
  fireEvent.click(close);
  expect(search).not.toHaveAttribute('data-open');
  expect(toggle).toHaveFocus();
});

it('takes Esc the same two steps: clear, then close', () => {
  render(createElement(I18nProvider, null, createElement(SearchingBar)));
  const search = document.getElementById('note-toolbar-search')!;
  fireEvent.click(screen.getByRole('button', { name: 'Search notes, tags, content...' }));
  const input = within(search).getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'plan' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input).toHaveValue('');
  expect(search).toHaveAttribute('data-open');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(search).not.toHaveAttribute('data-open');
});

it("hides the browser's own clear on the phone field and keeps the ✕ a 44px target", () => {
  const css = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css('note-toolbar.css')).toMatch(/\.note-search-input::-webkit-search-cancel-button[^{]*\{[^}]*-webkit-appearance: none/);
  expect(css('phone-notes.css')).toMatch(/\.phone-list-bar \.note-toolbar-search\[data-query\] \.note-search-close \{[^}]*width: 44px; height: 44px/);
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

it("lists the notebook's metadata sort field in the filter sheet's sort menu", () => {
  const onSortChange = vi.fn();
  render(createElement(
    I18nProvider,
    null,
    (<PhoneFilterSheet onClose={vi.fn()} sortField='metadata.date' sortOrder='desc' metadataSortFields={['metadata.date']} onSortChange={onSortChange} viewMode='flat' setViewMode={vi.fn()} showHidden={false} hiddenNoteCount={0} onShowHiddenChange={vi.fn()}>
      <p>filters</p>
    </PhoneFilterSheet>),
  ));
  const sort = within(screen.getByRole('dialog', { name: 'Filter and sort' })).getByRole('combobox', { name: 'Sort' });
  expect(sort).toHaveTextContent('date (descending)');
  fireEvent.keyDown(sort, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'date (ascending)' }));
  expect(onSortChange).toHaveBeenCalledWith('metadata.date', 'asc');
});
