// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { NoteListTools, type NoteSearchHandle, NoteToolbar } from './NoteToolbar.js';
import { NewNoteMenu } from './NewNoteMenu.js';
import { ViewModeMenu } from './ViewModeSwitch.js';

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: !query.includes('max-width: 767px'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  const slot = document.createElement('span');
  slot.id = 'workspace-sidebar-toggle-slot';
  document.body.appendChild(slot);
  window.localStorage.setItem('github-notes:language', 'zh-TW');
  // Radix Select scrolls its chosen option into view, which jsdom does not lay out.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

const baseProps = { showHidden: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, sortField: 'updated' as const, sortOrder: 'desc' as const, onSortChange: () => {}, viewMode: 'flat' as const, setViewMode: () => {}, query: '', onQueryChange: () => {} };
const newNote = { onNewNote: () => {}, onNewCompilation: () => {} };

it('labels the view switcher in Traditional Chinese under the zh-TW locale', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, baseProps)));
  expect(screen.getByRole('combobox', { name: '筆記檢視' })).toBeInTheDocument();
  for (const name of ['攤開', '資料夾檢視', '看板檢視']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
});

it('on the list page holds the list tools, then the view buttons at its right end, and leaves the Focus controls and New to the header', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, groupByFolder: { value: false, onChange: () => {} } })));
  const search = screen.getByRole('search'), group = screen.getByRole('button', { name: '依資料夾分組' }), views = screen.getByRole('button', { name: '看板檢視' });
  expect(search.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(group.compareDocumentPosition(views) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(views.closest('.desktop-views')).toBe(document.querySelector('.header-note-actions')!.lastElementChild);
  expect(screen.queryByRole('button', { name: '新增筆記' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新增選單' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Focus' })).toBeNull();
  // The notebook panel's toggle is the page's own, drawn in the header's slot whether or not this row is there.
  expect(screen.queryByRole('button', { name: '筆記本與篩選' })).toBeNull();
});

it('offers native outline creation in the New menu and hides creation for read-only notebooks', async () => {
  const create = vi.fn();
  const view = render(
    <I18nProvider>
      <NewNoteMenu {...newNote} onNewOutline={create} />
    </I18nProvider>,
  );
  const trigger = screen.getByRole('button', { name: '新增選單' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '新增大綱' }));
  expect(create).toHaveBeenCalledOnce();
  view.rerender(
    <I18nProvider>
      <NoteToolbar {...baseProps} browseCollapsed />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: '新增選單' })).not.toBeInTheDocument();
});

it('renders no New button or menu on a read-only notebook, even in the toolbar left while the header is folded away', () => {
  render(
    <I18nProvider>
      <NoteToolbar {...baseProps} browseCollapsed focusControls={<button type='button'>Focus</button>} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: '新增選單' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新增筆記' })).toBeNull();
  expect(screen.queryByText('保存目前檢視')).toBeNull();
});

it('keeps legacy import in a writable notebook’s New menu', async () => {
  const open = vi.fn();
  render(
    <I18nProvider>
      <NewNoteMenu {...newNote} onImportLegacy={open} />
    </I18nProvider>,
  );
  expect(screen.getByRole('button', { name: '新增筆記' })).toBeInTheDocument();
  const menu = screen.getByRole('button', { name: '新增選單' });
  menu.focus();
  fireEvent.keyDown(menu, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '匯入舊書籤' }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText('保存目前檢視')).toBeNull();
});

it('puts the note search in the toolbar and reports each keystroke as the query', () => {
  const changes: string[] = [];
  render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, query: 'dragon', onQueryChange: value => changes.push(value) })));
  const field = screen.getByRole('searchbox', { name: '搜尋筆記、標籤、內文...' });
  expect(field).toHaveValue('dragon');
  fireEvent.change(field, { target: { value: 'dragons' } });
  expect(changes).toEqual(['dragons']);
});

it('keeps the field behind a button on phones: the button opens it over the toolbar and close hides it', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, baseProps)));
  const toggle = screen.getByRole('button', { name: '搜尋筆記、標籤、內文...' });
  const search = document.getElementById('note-toolbar-search')!;
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(search).not.toHaveAttribute('data-open');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(search).toHaveAttribute('data-open');
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(search).not.toHaveAttribute('data-open');
});

it('lets the "Search note text" command open the field on phones and put the cursor in it', async () => {
  const search = createRef<NoteSearchHandle>();
  render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, searchRef: search })));
  const field = screen.getByRole('searchbox', { name: '搜尋筆記、標籤、內文...' });
  act(() => search.current!.focus());
  expect(document.getElementById('note-toolbar-search')).toHaveAttribute('data-open');
  expect(screen.getByRole('button', { name: '搜尋筆記、標籤、內文...' })).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(document.activeElement).toBe(field));
});

it('names the current order on the icon-only sort menu and offers Group by folder only when given', () => {
  const changes: boolean[] = [];
  const { rerender } = render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, sortField: 'title', sortOrder: 'asc' })));
  expect(screen.getByRole('combobox', { name: '排序: 標題 (A 到 Z)' })).not.toHaveTextContent('標題');
  expect(screen.queryByRole('button', { name: '依資料夾分組' })).toBeNull();
  rerender(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, groupByFolder: { value: false, onChange: value => changes.push(value) } })));
  const toggle = screen.getByRole('button', { name: '依資料夾分組' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  expect(changes).toEqual([true]);
});

it('keeps only the Focus controls, New and the header buttons once the browse region is collapsed', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, browseCollapsed: true, newNote, groupByFolder: { value: false, onChange: () => {} }, focusControls: createElement('button', { type: 'button' }, 'Focus'), utilities: createElement('button', { type: 'button' }, 'Commands') })));
  expect(screen.queryByRole('search')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
  for (const name of ['筆記本與篩選', '顯示隱藏筆記', '依資料夾分組']) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByRole('button', { pressed: true })).toBeNull();
  expect(screen.getByRole('button', { name: '新增筆記' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Commands' })).toBeInTheDocument();
});

it('marks a search still in force once the browse region is collapsed, and reopens it from there', () => {
  const reveal = vi.fn();
  const { rerender } = render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, browseCollapsed: true, onRevealSearch: reveal })));
  expect(screen.queryByRole('button', { name: /^搜尋/ })).toBeNull();
  rerender(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, browseCollapsed: true, onRevealSearch: reveal, query: 'pnpm' })));
  fireEvent.click(screen.getByRole('button', { name: /: pnpm$/ }));
  expect(reveal).toHaveBeenCalledOnce();
});

it('gives the browse dock one view menu, naming the current view, which switches the view, and keeps it out of the dock list tools', async () => {
  const modes: string[] = [];
  const dock = (viewMode: 'flat' | 'list' | 'kanban') => createElement(I18nProvider, null, createElement(NoteListTools, { placement: 'dock', query: '', onQueryChange: () => {}, sortField: 'updated', sortOrder: 'desc', onSortChange: () => {}, sortable: true, showHidden: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, groupByFolder: { value: false, onChange: () => {} } }), createElement(ViewModeMenu, { viewMode, setViewMode: mode => modes.push(mode) }));
  const { rerender } = render(dock('flat'));
  const menu = screen.getByRole('combobox', { name: '筆記檢視: 攤開' });
  expect(document.querySelector('.note-list-tools')).not.toContainElement(menu);
  // One menu stands in for the three buttons, which the dock has no room for.
  for (const name of ['攤開', '資料夾檢視', '看板檢視']) expect(screen.queryByRole('button', { name })).toBeNull();
  act(() => menu.focus());
  fireEvent.keyDown(menu, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '看板' }));
  expect(modes).toEqual(['kanban']);
  rerender(dock('list'));
  expect(screen.getByRole('combobox', { name: '筆記檢視: 資料夾' })).toBeInTheDocument();
});

it('in the browse dock shows the search field itself beside the sort and the toggles, and the search command focuses it', async () => {
  const search = createRef<NoteSearchHandle>();
  const changes: string[] = [];
  const hidden: boolean[] = [];
  const tools = (sortable: boolean) => createElement(I18nProvider, null, createElement(NoteListTools, { placement: 'dock', searchRef: search, query: 'dragon', onQueryChange: value => changes.push(value), sortField: 'updated', sortOrder: 'desc', onSortChange: () => {}, sortable, showHidden: false, hiddenNoteCount: 2, onShowHiddenChange: value => hidden.push(value), groupByFolder: { value: true, onChange: () => {} } }));
  const { rerender } = render(tools(true));
  const field = screen.getByRole('searchbox', { name: '搜尋筆記、標籤、內文...' });
  expect(screen.getByRole('search')).toContainElement(field);
  fireEvent.change(field, { target: { value: 'dragons' } });
  expect(changes).toEqual(['dragons']);
  expect(screen.getByRole('combobox', { name: '排序: 更新時間 (由新到舊)' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '顯示隱藏筆記' }));
  expect(hidden).toEqual([true]);
  expect(screen.getByRole('button', { name: '依資料夾分組' })).toHaveAttribute('aria-pressed', 'true');
  act(() => search.current!.focus());
  await waitFor(() => expect(document.activeElement).toBe(field));
  rerender(tools(false));
  expect(screen.queryByRole('combobox')).toBeNull();
});

it('in a browse dock too narrow for the field shows a search button that opens it over the row, closed by ✕, Esc, or a click outside while empty', async () => {
  const search = createRef<NoteSearchHandle>();
  const dock = (query: string) => createElement(I18nProvider, null, createElement(NoteListTools, { placement: 'dock', searchRef: search, query, onQueryChange: () => {}, sortField: 'updated', sortOrder: 'desc', onSortChange: () => {}, sortable: true, showHidden: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, groupByFolder: { value: false, onChange: () => {} } }));
  const { rerender } = render(dock(''));
  const toggle = screen.getByRole('button', { name: '搜尋筆記、標籤、內文...' });
  const region = screen.getByRole('search');
  const field = screen.getByRole('searchbox');
  // Folded: the button controls the field's region, which is not open; the CSS hides it until the row is narrow.
  expect(toggle).toHaveClass('note-search-toggle');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveAttribute('aria-controls', region.id);
  expect(toggle).not.toHaveAttribute('data-active');
  expect(region).not.toHaveAttribute('data-open');
  expect(document.querySelectorAll(`#${CSS.escape(region.id)}`)).toHaveLength(1);
  fireEvent.click(toggle);
  expect(region).toHaveAttribute('data-open');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.click(within(region).getByRole('button', { name: '關閉' }));
  expect(region).not.toHaveAttribute('data-open');
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(region).not.toHaveAttribute('data-open');
  expect(document.activeElement).toBe(toggle);
  // An empty field folds on a click outside; one holding a search stays open until closed.
  fireEvent.click(toggle);
  fireEvent.pointerDown(document.body);
  expect(region).not.toHaveAttribute('data-open');
  rerender(dock('dragon'));
  fireEvent.click(toggle);
  fireEvent.pointerDown(document.body);
  expect(region).toHaveAttribute('data-open');
  fireEvent.keyDown(field, { key: 'Escape' });
  // Folded with a search in force, the button is marked and names it.
  const marked = screen.getByRole('button', { name: '搜尋筆記、標籤、內文...: dragon' });
  expect(marked).toBe(toggle);
  expect(marked).toHaveAttribute('data-active', 'true');
  expect(marked).toHaveAttribute('title', '搜尋筆記、標籤、內文...: dragon');
  // The search command opens the folded field and focuses it.
  act(() => search.current!.focus());
  expect(region).toHaveAttribute('data-open');
  await waitFor(() => expect(document.activeElement).toBe(field));
});

it('folds the dock search to its button by the dock row’s own width, not the viewport', () => {
  const css = fs.readFileSync(path.resolve(__dirname, 'note-toolbar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css).toMatch(/\.note-list-tools-frame \{[^}]*container: dock-tools \/ inline-size/);
  const rule = css.match(/@container dock-tools \(max-width: 279px\) \{(.*)\}/)?.[1] ?? '';
  expect(rule).toMatch(/\.note-list-tools \.note-search-toggle \{ display: inline-flex/);
  expect(rule).toMatch(/\.note-list-tools-search \{ display: none; \}/);
  expect(rule).toMatch(/\.note-list-tools-search\[data-open\] \{ position: absolute; z-index: 20; inset: 0;/);
  expect(rule).toMatch(/\.note-list-tools \.note-search-close \{ display: inline-flex/);
});

const openNewMenu = async () => {
  const trigger = screen.getByRole('button', { name: '新增選單' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return (await screen.findAllByRole('menuitem')).map(item => item.textContent);
};

it('lists the notebook’s templates in the New menu, then Manage templates', async () => {
  const fromTemplate = vi.fn(), manage = vi.fn();
  const toolbar = (
    <I18nProvider>
      <NewNoteMenu {...newNote} templates={[{ id: 'registered', title: 'Registered' }, { id: 'reading', title: '讀書筆記' }, { id: 'builtin:slides', title: '投影片' }]} onNewFromTemplate={fromTemplate} onManageTemplates={manage} />
    </I18nProvider>
  );
  const first = render(toolbar);
  expect((await openNewMenu()).slice(0, 5)).toEqual(['新增筆記', '新增筆記：Registered', '新增筆記：讀書筆記', '新增筆記：投影片', '管理範本…']);
  fireEvent.click(screen.getByRole('menuitem', { name: '新增筆記：讀書筆記' }));
  expect(fromTemplate).toHaveBeenCalledExactlyOnceWith('reading');
  first.unmount();

  render(toolbar);
  await openNewMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: '管理範本…' }));
  expect(manage).toHaveBeenCalledOnce();
});

it("offers the notebook's metadata sort field in the sort menu, labelled by its key", () => {
  const { rerender } = render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, sortField: 'metadata.date', sortOrder: 'desc', metadataSortFields: ['metadata.date'] })));
  expect(screen.getByRole('combobox', { name: '排序: date (由大到小)' })).toBeInTheDocument();
  rerender(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, sortField: 'metadata.date', sortOrder: 'asc', metadataSortFields: ['metadata.date'] })));
  expect(screen.getByRole('combobox', { name: '排序: date (由小到大)' })).toBeInTheDocument();
  rerender(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps })));
  expect(screen.getByRole('combobox', { name: '排序: 更新時間 (由新到舊)' })).toBeInTheDocument();
});
