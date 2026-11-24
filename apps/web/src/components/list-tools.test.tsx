// @vitest-environment jsdom
import { createRef, useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import type { BrowsePresentation } from '../lib/browse-columns.js';
import { ListFilterButtons, type ListFilterButtonsProps } from './ListFilterButtons.js';
import { NewNoteMenu } from './NewNoteMenu.js';
import { NotebookColumn, type NotebookColumnProps } from './NotebookColumn.js';
import { NoteListColumn } from './NoteListColumn.js';
import type { NoteSearchHandle } from './note-list-search.js';

/*
 * The Notes page's list tools used to sit in a toolbar row over the list, or in a dock's tools beside a Focus. Now the search heads the
 * notebooks column, the view switch and the column toggle end the list header, Sort sits with the filter buttons under it, and New stays
 * in the header.
 */
beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  window.localStorage.setItem('github-notes:language', 'zh-TW');
  // Radix menus scroll their chosen item into view, which jsdom does not lay out.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const newNote = { onNewNote: () => {}, onNewCompilation: () => {} };
const notebooks = [{ id: 'life', title: 'Life', root: 'notes/life' }];

function header({ presentation = 'list', onPresentationChange = () => {}, onCollapse = () => {} }: { presentation?: BrowsePresentation; onPresentationChange?: (value: BrowsePresentation) => void; onCollapse?: () => void; } = {}) {
  return render(
    <I18nProvider>
      <NoteListColumn columnId='browse-list' notebookTitle='Life' path={['tech']} count={28} presentation={presentation} onPresentationChange={onPresentationChange} onCollapse={onCollapse} chips={<span>chips</span>}>
        <p>rows</p>
      </NoteListColumn>
    </I18nProvider>,
  );
}

function column(props: Partial<NotebookColumnProps> = {}) {
  const all: NotebookColumnProps = { mode: 'open', columnId: 'browse-notebooks', notebooks, selectedNotebookId: 'life', onSelectNotebook: () => {}, current: <p>Life</p>, query: '', onQueryChange: () => {}, onOpenSearch: () => {}, kind: 'note', onSelectKind: () => {}, ...props };
  return render(
    <I18nProvider>
      <NotebookColumn {...all} />
    </I18nProvider>,
  );
}

/** The search as the page keeps it: the field reports each keystroke and shows what it holds. */
function SearchHarness({ initial = '' }: { initial?: string; }) {
  const [query, setQuery] = useState(initial);
  return (
    <I18nProvider>
      <NotebookColumn mode='open' columnId='browse-notebooks' notebooks={notebooks} selectedNotebookId='life' onSelectNotebook={() => {}} current={<p>Life</p>} query={query} onQueryChange={setQuery} onOpenSearch={() => {}} kind='note' onSelectKind={() => {}} />
    </I18nProvider>
  );
}

it('labels the view switch in Traditional Chinese under the zh-TW locale', () => {
  header();
  const views = screen.getByRole('group', { name: '檢視' });
  for (const name of ['清單', '表格', '看板']) expect(within(views).getByRole('button', { name })).toBeInTheDocument();
});

it('ends the list header with the view switch, then the column toggle, and leaves the Focus controls and New to the page header', () => {
  const choices: BrowsePresentation[] = [];
  header({ onPresentationChange: value => choices.push(value) });
  const views = screen.getByRole('group', { name: '檢視' });
  const toggle = screen.getByRole('button', { name: '收起筆記清單' });
  const row = document.querySelector('.browse-list-header')!;
  expect(row.lastElementChild).toBe(toggle);
  expect(views.nextElementSibling).toBe(toggle);
  expect(within(views).getByRole('button', { name: '清單' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(views).getByRole('button', { name: '看板' }));
  expect(choices).toEqual(['kanban']);
  expect(screen.queryByRole('button', { name: '新增筆記' })).toBeNull();
  expect(screen.queryByRole('button', { name: '新增選單' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Focus' })).toBeNull();
  expect(screen.queryByRole('search')).toBeNull();
});

it('offers native outline creation in the New menu', async () => {
  const create = vi.fn();
  render(
    <I18nProvider>
      <NewNoteMenu {...newNote} onNewOutline={create} />
    </I18nProvider>,
  );
  const trigger = screen.getByRole('button', { name: '新增選單' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '新增大綱' }));
  expect(create).toHaveBeenCalledOnce();
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

it('heads the notebooks column with the note search, which reports each keystroke as the query and names its shortcut', () => {
  const changes: string[] = [];
  column({ query: 'dragon', onQueryChange: value => changes.push(value) });
  const region = screen.getByRole('search');
  const field = within(region).getByRole('searchbox', { name: '搜尋筆記、標籤、內文...' });
  expect(field).toHaveValue('dragon');
  expect(field).toHaveAttribute('aria-keyshortcuts');
  expect(region.closest('.browse-notebooks-top')).not.toBeNull();
  fireEvent.change(field, { target: { value: 'dragons' } });
  expect(changes).toEqual(['dragons']);
});

it('lets the "Search note text" command put the cursor in the field', async () => {
  const search = createRef<NoteSearchHandle>();
  column({ searchRef: search });
  act(() => search.current!.focus());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
});

it('on the rail offers a search button that opens the column at its field', () => {
  const onOpenSearch = vi.fn();
  column({ mode: 'rail', onOpenSearch });
  expect(screen.queryByRole('searchbox')).toBeNull();
  const button = screen.getByRole('button', { name: '搜尋筆記、標籤、內文...' });
  expect(button).toHaveAttribute('aria-keyshortcuts');
  fireEvent.click(button);
  expect(onOpenSearch).toHaveBeenCalledOnce();
});

it('clears a search with the ✕, keeping the cursor in the field, and shows the ✕ only while a search is in force', () => {
  render(<SearchHarness />);
  const region = screen.getByRole('search');
  const field = screen.getByRole('searchbox');
  expect(within(region).queryByRole('button', { name: '清除搜尋' })).toBeNull();
  fireEvent.change(field, { target: { value: 'dragon' } });
  const clear = within(region).getByRole('button', { name: '清除搜尋' });
  // A tooltip names it, not a native title.
  expect(clear).not.toHaveAttribute('title');
  fireEvent.click(clear);
  expect(field).toHaveValue('');
  expect(document.activeElement).toBe(field);
  expect(within(region).queryByRole('button', { name: '清除搜尋' })).toBeNull();
});

it('clears a search with Esc, and leaves Esc on an empty field to the page', () => {
  render(<SearchHarness initial='dragon' />);
  const field = screen.getByRole('searchbox');
  field.focus();
  const cleared = fireEvent.keyDown(field, { key: 'Escape' });
  expect(cleared).toBe(false);
  expect(field).toHaveValue('');
  expect(fireEvent.keyDown(field, { key: 'Escape' })).toBe(true);
});

it('hides the browser’s own search clear button on the column’s field', () => {
  const css = fs.readFileSync(path.resolve(__dirname, 'browse-columns.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css).toMatch(/\.browse-search input::-webkit-search-cancel-button \{ display: none; \}/);
});

const openNewMenu = async () => {
  const trigger = screen.getByRole('button', { name: '新增選單' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return (await screen.findAllByRole('menuitem')).map(item => item.textContent);
};

it('lists the notebook’s templates in the New menu, then Manage templates', async () => {
  const fromTemplate = vi.fn(), manage = vi.fn();
  const menu = (
    <I18nProvider>
      <NewNoteMenu {...newNote} templates={[{ id: 'registered', title: 'Registered' }, { id: 'reading', title: '讀書筆記' }, { id: 'builtin:slides', title: '投影片' }]} onNewFromTemplate={fromTemplate} onManageTemplates={manage} />
    </I18nProvider>
  );
  const first = render(menu);
  expect((await openNewMenu()).slice(0, 5)).toEqual(['新增筆記', '新增筆記：Registered', '新增筆記：讀書筆記', '新增筆記：投影片', '管理範本…']);
  fireEvent.click(screen.getByRole('menuitem', { name: '新增筆記：讀書筆記' }));
  expect(fromTemplate).toHaveBeenCalledExactlyOnceWith('reading');
  first.unmount();

  render(menu);
  await openNewMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: '管理範本…' }));
  expect(manage).toHaveBeenCalledOnce();
});

function sortButtons(props: Partial<ListFilterButtonsProps>) {
  const filters: FilterControls = { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false } as NoteFilters, neighbors: false, notebooks, folders: [], tags: [], statuses: [], count: 0, onChange: () => {}, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} };
  const all: ListFilterButtonsProps = { filters, counts: { total: 0, statuses: {}, tags: {} } as never, notebookId: 'life', sortField: 'updated', sortOrder: 'desc', onSortChange: () => {}, sortable: true, showHidden: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, ...props };
  return (
    <I18nProvider>
      <ListFilterButtons {...all} />
    </I18nProvider>
  );
}

it("names the current order on the Sort button, the notebook's metadata sort field included, labelled by its key", () => {
  const { rerender } = render(sortButtons({ sortField: 'metadata.date', sortOrder: 'desc', metadataSortFields: ['metadata.date'] }));
  expect(screen.getByRole('button', { name: /^排序：date \(由大到小\)/ })).toBeInTheDocument();
  rerender(sortButtons({ sortField: 'metadata.date', sortOrder: 'asc', metadataSortFields: ['metadata.date'] }));
  expect(screen.getByRole('button', { name: /^排序：date \(由小到大\)/ })).toBeInTheDocument();
  rerender(sortButtons({ sortField: 'title', sortOrder: 'asc' }));
  expect(screen.getByRole('button', { name: /^排序：標題 \(A 到 Z\)/ })).toBeInTheDocument();
});

it('keeps the Tags filter open while its tag sort is chosen, the sort list lying outside the panel, and applies the sort', async () => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  const counts = { total: 3, statuses: {}, tags: { alpha: 1, beta: 5, gamma: 2 } } as never;
  render(sortButtons({ counts }));
  fireEvent.click(screen.getByRole('button', { name: '標籤' }));
  const panel = screen.getByRole('dialog', { name: '標籤' });
  const sort = within(panel).getByRole('combobox', { name: '標籤排序' });
  await act(async () => {
    fireEvent.keyDown(sort, { key: 'Enter' });
  });
  const option = screen.getByRole('option', { name: '使用次數：多到少' });
  // The sort's list lies in a portal outside the panel: pressing an option there is not a press outside the panel.
  await act(async () => {
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    fireEvent.click(option);
  });
  expect(screen.getByRole('dialog', { name: '標籤' })).toBeInTheDocument();
  expect(within(screen.getByRole('dialog', { name: '標籤' })).getByRole('combobox', { name: '標籤排序' })).toHaveTextContent('使用次數：多到少');
});
