// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { WebFeaturesProvider } from '../lib/web-features.js';
import type { FolderItem } from '../lib/types.js';
import { loadLucideIcons } from '../lib/icons/lucide-registry.js';
import { NotebookColumn, type NotebookColumnProps } from './NotebookColumn.js';
import { NotebookTree } from './NotebookTree.js';
import type { NoteSearchHandle } from './note-list-search.js';

const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: {}, tags: {}, directories: {}, outlines: { total: 2, statuses: {}, tags: {} }, compilations: { total: 3, statuses: {}, tags: {} } } };
const notebooks = [{ id: 'life', title: 'Life notes', root: 'notes/life' }, { id: 'work', title: 'Work', root: 'notes/work' }, { id: 'thesis', title: 'Thesis', root: 'thesis' }];
const folders: FolderItem[] = [{ notebookId: 'life', path: 'tech', title: 'tech', order: 0 }, { notebookId: 'life', path: 'trpg', title: 'trpg', order: 1 }];

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

function controls(value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}): FilterControls {
  return { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks, folders, tags: [], statuses: [], count: 7, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} };
}

function column(props: Partial<NotebookColumnProps> = {}, filters = controls()) {
  const all: NotebookColumnProps = { mode: 'open', columnId: 'browse-notebooks', notebooks, selectedNotebookId: 'life', onSelectNotebook: () => {}, counts: { life: 7, work: 1, thesis: 4 }, current: <NotebookTree notebook={notebooks[0]} filters={filters} facets={facets} folders={folders} foldersLoading={false} foldersWritable selectedFolder={null} onSelectFolder={() => {}} onManageFiles={() => {}} expanded onToggleExpanded={() => {}} />, query: '', onQueryChange: () => {}, onOpenSearch: () => {}, kind: 'note', onSelectKind: () => {}, ...props };
  return <NotebookColumn {...all} />;
}

const wrap = (node: React.ReactNode, links = false) => (
  <I18nProvider>
    <MemoryRouter>
      <WebFeaturesProvider features={links ? [{ id: 'links', sidebarLinks: () => [{ id: 'docs', label: 'Docs', href: '/docs' }] }] : []}>{node}</WebFeaturesProvider>
    </MemoryRouter>
  </I18nProvider>
);

it('lists every notebook and switches with one click', () => {
  const onSelectNotebook = vi.fn();
  render(wrap(column({ onSelectNotebook })));
  const nav = screen.getByRole('navigation', { name: 'Notebooks' });
  expect(within(nav).getByRole('button', { name: /Work/ })).toBeInTheDocument();
  expect(within(nav).getByRole('button', { name: /Thesis/ })).toBeInTheDocument();
  fireEvent.click(within(nav).getByRole('button', { name: /Thesis/ }));
  expect(onSelectNotebook).toHaveBeenCalledWith('thesis');
});

it("opens the current notebook into its folders, then its outlines and compilations, in the notebook's place", () => {
  const onChange = vi.fn();
  render(wrap(column({}, controls({}, onChange))));
  const rows = [...screen.getByRole('navigation', { name: 'Notebooks' }).querySelectorAll('.nav-tree-entry, .browse-notebook-row')].map(row => row.textContent?.replace(/\d+$/, '').trim());
  expect(rows).toEqual(['Life notes', 'tech', 'trpg', 'Outlines', 'Compilations', 'Work', 'Thesis']);
  fireEvent.click(screen.getByRole('button', { name: /Compilations/ }));
  expect(onChange).toHaveBeenCalledWith({ kind: 'compilation', folders: [] });
});

it("groups the notebooks under each repository's title when there are several", () => {
  render(wrap(column({ groups: [{ label: 'Personal', notebooks: ['life', 'thesis'] }, { label: 'Company', notebooks: ['work'] }] })));
  const headings = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
  expect(headings).toEqual(['Personal', 'Company']);
  const company = screen.getByRole('group', { name: 'Company' });
  expect(within(company).getByRole('button', { name: /Work/ })).toBeInTheDocument();
  expect(within(screen.getByRole('group', { name: 'Personal' })).getByRole('button', { name: /Thesis/ })).toBeInTheDocument();
});

it('marks a notebook its repository cannot serve', () => {
  render(wrap(column({ unavailableNotebooks: ['work'] })));
  expect(screen.getByRole('button', { name: /Work · Unavailable/ })).toBeInTheDocument();
});

it('searches the notes from its top, where Mod+K reaches the field', () => {
  const onQueryChange = vi.fn();
  const searchRef = createRef<NoteSearchHandle>();
  render(wrap(column({ onQueryChange, searchRef })));
  const field = screen.getByRole('searchbox', { name: /Search notes/ });
  fireEvent.change(field, { target: { value: 'casper' } });
  expect(onQueryChange).toHaveBeenCalledWith('casper');
  expect(screen.getByText('Ctrl+K')).toBeInTheDocument();
  act(() => searchRef.current?.focus());
  expect(document.activeElement).toBe(field);
});

it("puts an edition's links at its foot", () => {
  render(wrap(column(), true));
  const links = screen.getByRole('navigation', { name: 'Links' });
  expect(links.closest('.browse-notebooks-footer')).not.toBeNull();
  expect(within(links).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
});

it('folds to a rail of notebook icons, each named in full, with the current one marked', () => {
  const onSelectNotebook = vi.fn();
  const onOpenSearch = vi.fn();
  const onSelectKind = vi.fn();
  render(wrap(column({ mode: 'rail', onSelectNotebook, onOpenSearch, onSelectKind }), true));
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  const life = screen.getByRole('button', { name: 'Life notes' });
  expect(life).toHaveAttribute('aria-current', 'true');
  expect(life).not.toHaveAttribute('title');
  expect(life).toHaveTextContent('L');
  fireEvent.click(screen.getByRole('button', { name: 'Work' }));
  expect(onSelectNotebook).toHaveBeenCalledWith('work');
  // The column's toggle sits left of the logo in the header, not in the column.
  expect(screen.queryByRole('button', { name: /notebooks$/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Search notes/ }));
  expect(onOpenSearch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Outlines' }));
  expect(onSelectKind).toHaveBeenCalledWith('outline');
  // The links keep their names.
  expect(screen.getByRole('link', { name: 'Docs' })).toBeInTheDocument();
});

// Boss: on the rail, the outline and compilation buttons had no way back to the notes; each is a toggle now.
it("turns the rail's outline and compilation buttons off again, back to the notes", () => {
  const onSelectKind = vi.fn();
  const { rerender } = render(wrap(column({ mode: 'rail', kind: 'outline', onSelectKind }), true));
  const outlines = screen.getByRole('button', { name: 'Outlines' });
  expect(outlines).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(outlines);
  expect(onSelectKind).toHaveBeenLastCalledWith('note');
  rerender(wrap(column({ mode: 'rail', kind: 'compilation', onSelectKind }), true));
  fireEvent.click(screen.getByRole('button', { name: 'Compilations' }));
  expect(onSelectKind).toHaveBeenLastCalledWith('note');
  fireEvent.click(screen.getByRole('button', { name: 'Outlines' }));
  expect(onSelectKind).toHaveBeenLastCalledWith('outline');
});

const marked = [{ id: 'life', title: 'Life notes', root: 'notes/life', icon: 'leaf', color: 'green' as const }, { id: 'work', title: 'Work', root: 'notes/work', color: 'red' as const }, { id: 'thesis', title: 'Thesis', root: 'thesis' }];
const hoverTip = async (element: Element) => {
  fireEvent.pointerEnter(element, { pointerType: 'mouse' });
  return screen.findByRole('tooltip', {}, { timeout: 2000 });
};

it("draws each notebook's mark on the rail, the open one stronger and ringed, and keeps the initial tile for a notebook without one", async () => {
  await loadLucideIcons();
  render(wrap(column({ mode: 'rail', notebooks: marked })));
  const life = screen.getByRole('button', { name: 'Life notes' });
  expect(life).toHaveAttribute('data-marked', '');
  expect(life.querySelector('.notebook-mark')).toHaveAttribute('data-color', 'green');
  expect(life.querySelector('.notebook-mark')).toHaveAttribute('data-state', 'icon');
  expect(life.querySelector('.notebook-mark')).toHaveAttribute('data-selected', '');
  const work = screen.getByRole('button', { name: 'Work' });
  expect(work.querySelector('.notebook-mark')).toHaveAttribute('data-color', 'red');
  expect(work.querySelector('.notebook-mark')).not.toHaveAttribute('data-selected');
  expect(work).toHaveTextContent('W');
  const thesis = screen.getByRole('button', { name: 'Thesis' });
  expect(thesis).not.toHaveAttribute('data-marked');
  expect(thesis.querySelector('.notebook-mark')).toBeNull();
  expect(thesis).toHaveTextContent('T');
});

it('draws the mark in place of the book on a notebook row, and keeps the book where a notebook has none', () => {
  render(wrap(column({ notebooks: marked })));
  const work = screen.getByRole('button', { name: /Work/ });
  expect(work.querySelector('.notebook-mark')).toHaveAttribute('data-size', 'row');
  expect(work.querySelector('svg.lucide-book-open')).toBeNull();
  const thesis = screen.getByRole('button', { name: /Thesis/ });
  expect(thesis.querySelector('.notebook-mark')).toBeNull();
  expect(thesis.querySelector('svg')).not.toBeNull();
});

it('names a rail notebook and its note count in a tooltip instead of a native title', async () => {
  render(wrap(column({ mode: 'rail', notebooks: marked })));
  const work = screen.getByRole('button', { name: 'Work' });
  const tip = await hoverTip(work);
  expect(tip).toHaveTextContent('Work1');
  expect(tip.querySelector('.tooltip-detail')).toHaveTextContent('1');
  expect(work.getAttribute('aria-describedby')).toBe(tip.id);
  fireEvent.pointerLeave(work, { pointerType: 'mouse' });
  const search = screen.getByRole('button', { name: /Search notes/ });
  expect(search).not.toHaveAttribute('title');
  expect((await hoverTip(search)).querySelector('.tooltip-detail')).toHaveTextContent('Ctrl+K');
});

it('names a notebook row in a tooltip instead of a native title', async () => {
  render(wrap(column({ notebooks: marked })));
  const thesis = screen.getByRole('button', { name: /Thesis/ });
  expect(thesis).not.toHaveAttribute('title');
  expect(await hoverTip(thesis)).toHaveTextContent('Thesis4');
});

it("opens a notebook's context menu from its rail tile or its row", () => {
  const onNotebookContextMenu = vi.fn();
  const { unmount } = render(wrap(column({ mode: 'rail', onNotebookContextMenu })));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Work' }));
  expect(onNotebookContextMenu).toHaveBeenLastCalledWith(expect.anything(), 'work');
  unmount();
  render(wrap(column({ onNotebookContextMenu })));
  fireEvent.contextMenu(screen.getByRole('button', { name: /Thesis/ }));
  expect(onNotebookContextMenu).toHaveBeenLastCalledWith(expect.anything(), 'thesis');
});

it("draws the open notebook's mark on its row, names its rows by tooltip, and opens its context menu", async () => {
  const onContextMenu = vi.fn();
  render(wrap(<NotebookTree notebook={marked[1]} filters={controls()} facets={facets} folders={folders.map(folder => ({ ...folder, notebookId: 'work' }))} foldersLoading={false} foldersWritable selectedFolder={null} onSelectFolder={() => {}} onManageFiles={() => {}} expanded onToggleExpanded={() => {}} onContextMenu={onContextMenu} />));
  const row = screen.getByRole('button', { name: /^Work/ });
  expect(row.querySelector('.notebook-mark')).toHaveAttribute('data-color', 'red');
  expect(row).not.toHaveAttribute('title');
  fireEvent.contextMenu(row);
  expect(onContextMenu).toHaveBeenCalledOnce();
  const tech = screen.getByRole('button', { name: /^tech/ });
  expect(tech).not.toHaveAttribute('title');
  expect(await hoverTip(tech)).toHaveTextContent('tech');
  fireEvent.pointerLeave(tech, { pointerType: 'mouse' });
  const manage = screen.getAllByRole('button', { name: /Manage folder/ })[0];
  expect(manage).not.toHaveAttribute('title');
});
