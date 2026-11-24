// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { listFacets } from '../lib/list-facets.js';
import { NoteListColumn, type NoteListColumnProps } from './NoteListColumn.js';
import { ListFilterButtons, type ListFilterButtonsProps } from './ListFilterButtons.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 2, statuses: { todo: 3, done: 4 }, tags: { work: 2, play: 5, music: 1 }, directories: {}, outlines: kind, compilations: kind } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

function controls(value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}, extra: Partial<FilterControls> = {}): FilterControls {
  return { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }], folders: [], tags: ['work', 'play', 'music'], statuses: ['todo', 'done'], count: 7, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {}, ...extra };
}

function buttons(props: Partial<ListFilterButtonsProps> = {}, filters = controls()) {
  const all: ListFilterButtonsProps = { filters, counts: listFacets(filters, facets), notebookId: 'life', sortField: 'updated', sortOrder: 'desc', onSortChange: () => {}, sortable: true, showHidden: false, hiddenNoteCount: 2, onShowHiddenChange: () => {}, ...props };
  return render(
    <I18nProvider>
      <ListFilterButtons {...all} />
    </I18nProvider>,
  );
}

function column(props: Partial<Omit<NoteListColumnProps, 'children'>> = {}) {
  const all: Omit<NoteListColumnProps, 'children'> = { columnId: 'browse-list', notebookTitle: 'Life', path: ['tech'], count: 28, presentation: 'list', onPresentationChange: () => {}, onCollapse: () => {}, chips: <span>chips</span>, ...props };
  return render(
    <I18nProvider>
      <NoteListColumn {...all}>
        <p>rows</p>
      </NoteListColumn>
    </I18nProvider>,
  );
}

describe('the list header', () => {
  it('names where the list is, how many notes it holds, and switches between only the list and the board', () => {
    const onPresentationChange = vi.fn();
    column({ onPresentationChange });
    const header = document.querySelector<HTMLElement>('.browse-list-header')!;
    expect(within(header).getByText('Life')).toBeInTheDocument();
    expect(within(header).getByText('tech')).toBeInTheDocument();
    expect(within(header).getByText('28 notes')).toBeInTheDocument();
    const view = screen.getByRole('group', { name: 'View' });
    expect(within(view).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(view).queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
    expect(within(view).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(view).getByRole('button', { name: 'Board' }));
    expect(onPresentationChange).toHaveBeenCalledWith('kanban');
  });

  it("puts the notebook's mark before its name, and names the header's buttons and its path by tooltip, not a native title", async () => {
    column({ notebook: { title: 'Life', icon: 'leaf', color: 'green' } });
    const path = document.querySelector<HTMLElement>('.browse-list-path')!;
    expect(path.querySelector('.notebook-mark')).toHaveAttribute('data-color', 'green');
    expect(path).not.toHaveAttribute('title');
    for (const name of ['List', 'Board', 'Hide note list']) expect(screen.getByRole('button', { name })).not.toHaveAttribute('title');
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Hide note list' }), { pointerType: 'mouse' });
    expect((await screen.findByRole('tooltip')).querySelector('.tooltip-detail')).toHaveTextContent(/Shift/);
    fireEvent.pointerLeave(screen.getByRole('button', { name: 'Hide note list' }), { pointerType: 'mouse' });
    fireEvent.pointerEnter(path, { pointerType: 'mouse' });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Life › tech');
  });

  it('shows no mark for a notebook without one', () => {
    column({ notebook: { title: 'Life' } });
    expect(document.querySelector('.browse-list-path .notebook-mark')).toBeNull();
  });

  it('folds the list away from the right end of its header', () => {
    const onCollapse = vi.fn();
    column({ onCollapse });
    const toggle = screen.getByRole('button', { name: 'Hide note list' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'browse-list');
    fireEvent.click(toggle);
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it('picks the folder from the path while the notebooks column is a rail', () => {
    const onChange = vi.fn();
    column({ folderMenu: { folders: [{ value: '', label: 'Life' }, { value: 'tech', label: 'tech' }, { value: 'trpg', label: 'trpg' }], value: 'tech', onChange } });
    const menu = screen.getByRole('combobox', { name: 'Folder' });
    expect(menu).toHaveTextContent('tech');
  });

  // Boss review (A2): beside the notebook name the picker was cut to 「All fold…」; the picker alone fills the path, its root named after the notebook.
  it('gives the folder picker the whole path beside the rail, the notebook root named by the notebook', () => {
    column({ folderMenu: { folders: [{ value: '', label: 'Life' }, { value: 'tech', label: 'tech' }], value: '', onChange: vi.fn() } });
    const path = screen.getByRole('heading', { level: 2 });
    expect(path.querySelector('.browse-list-separator')).toBeNull();
    expect(path.children).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveTextContent('Life');
  });
});

describe('the filter buttons', () => {
  it('opens the status filter with its counts and the live filter', () => {
    const onChange = vi.fn();
    buttons({}, controls({}, onChange, { liveAvailable: true }));
    const status = screen.getByRole('button', { name: /Status: All/ });
    expect(status).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(status);
    expect(status).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Status' });
    const todo = within(dialog).getByRole('button', { name: /todo/i });
    expect(todo).toHaveTextContent('3');
    fireEvent.click(todo);
    expect(onChange).toHaveBeenCalledWith({ status: 'todo' });
    fireEvent.click(within(within(dialog).getByRole('group', { name: 'Live editing' })).getByRole('button', { name: /Editing/ }));
    expect(onChange).toHaveBeenCalledWith({ live: ['editing'] });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(status);
  });

  it('names the status in force on its button', () => {
    buttons({}, controls({ status: 'done' }));
    expect(screen.getByRole('button', { name: /Status: Done/i })).toBeInTheDocument();
  });

  it('opens the tags with their search and counts', () => {
    const onChange = vi.fn();
    buttons({}, controls({ tags: ['work'] }, onChange));
    fireEvent.click(screen.getByRole('button', { name: /Tags · 1/ }));
    const dialog = screen.getByRole('dialog', { name: 'Tags' });
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Search tags' }), { target: { value: 'pl' } });
    expect(within(dialog).queryByRole('button', { name: /music/ })).not.toBeInTheDocument();
    const play = within(dialog).getByRole('button', { name: /play/ });
    expect(play).toHaveTextContent('5');
    fireEvent.click(play);
    expect(onChange).toHaveBeenCalledWith({ tags: ['work', 'play'] });
  });

  it('opens the sort with the display options: hidden notes, grouping and subfolders', () => {
    const onSortChange = vi.fn();
    const onShowHiddenChange = vi.fn();
    const subfolders = { value: true, onChange: vi.fn() };
    const groupByFolder = { value: false, onChange: vi.fn() };
    buttons({ onSortChange, onShowHiddenChange, subfolders, groupByFolder });
    fireEvent.click(screen.getByRole('button', { name: /Sort: Updated/ }));
    const dialog = screen.getByRole('dialog', { name: 'Sort' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Title \(A-Z\)/ }));
    expect(onSortChange).toHaveBeenCalledWith('title', 'asc');
    fireEvent.click(screen.getByRole('button', { name: /Sort: Updated/ }));
    const reopened = screen.getByRole('dialog', { name: 'Sort' });
    fireEvent.click(within(reopened).getByRole('checkbox', { name: /Show hidden notes \(2\)/ }));
    expect(onShowHiddenChange).toHaveBeenCalledWith(true);
    fireEvent.click(within(reopened).getByRole('checkbox', { name: 'Group by folder' }));
    expect(groupByFolder.onChange).toHaveBeenCalledWith(true);
    fireEvent.click(within(reopened).getByRole('checkbox', { name: 'Include subfolders' }));
    expect(subfolders.onChange).toHaveBeenCalledWith(false);
  });

  it('leaves the sort out where the board sorts its own columns', () => {
    buttons({ sortable: false });
    expect(screen.queryByRole('button', { name: /Sort:/ })).not.toBeInTheDocument();
  });

  it('clears every filter in force at once', () => {
    const onClear = vi.fn();
    buttons({}, controls({ status: 'todo' }, () => {}, { onClear }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('the board folded into the list column', () => {
  it('offers 「Expand board」 only while folded, and explains instead of acting while the Focus keeps it folded', () => {
    const onExpand = vi.fn();
    const { unmount } = column({ presentation: 'kanban' });
    expect(screen.queryByRole('button', { name: 'Expand board' })).not.toBeInTheDocument();
    unmount();
    const folded = column({ presentation: 'kanban', expandBoard: { onExpand } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand board' }));
    expect(onExpand).toHaveBeenCalledTimes(1);
    folded.unmount();
    column({ presentation: 'kanban', expandBoard: {} });
    const locked = screen.getByRole('button', { name: 'Expand board' });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(locked);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
