// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import type { FolderItem } from '../lib/types.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { listFacets } from '../lib/list-facets.js';
import { BrowseColumns, LIST_COLUMN_ID, NOTEBOOK_COLUMN_ID } from './BrowseColumns.js';
import { PhoneBrowseList } from './PhoneBrowseList.js';
import { FilterChips } from './FilterChips.js';
import { ListFilterButtons } from './ListFilterButtons.js';
import { NotebookColumn } from './NotebookColumn.js';
import { NotebookTree } from './NotebookTree.js';
import { NoteListColumn } from './NoteListColumn.js';
import { Sidebar } from './Sidebar.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: kind } };
const folders: FolderItem[] = [{ notebookId: 'life', path: 'projects', title: 'Projects', order: 0 }];
const notebook = { id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] };
const filters = (value: Partial<NoteFilters> = {}): FilterControls => ({ value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [notebook], folders: [], tags: ['work'], statuses: ['todo', 'done'], count: 7, onChange: () => {}, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

it('beside a note, the notebooks column holds the folders and the list column the status and tags, with no filters left in the notebooks column', () => {
  const controls = filters();
  render(
    <I18nProvider>
      <BrowseColumns
        layout={{ notebooks: 'open', list: true }}
        presentation='list'
        focusOpen
        notebooks={<NotebookColumn mode='open' columnId={NOTEBOOK_COLUMN_ID} notebooks={[notebook]} selectedNotebookId='life' onSelectNotebook={() => {}} counts={{ life: 7 }} current={<NotebookTree notebook={notebook} filters={controls} facets={facets} folders={folders} foldersLoading={false} foldersWritable selectedFolder={null} onSelectFolder={() => {}} onManageFiles={() => {}} expanded onToggleExpanded={() => {}} />} query='' onQueryChange={() => {}} onOpenSearch={() => {}} kind='note' onSelectKind={() => {}} />}
        list={
          <NoteListColumn columnId={LIST_COLUMN_ID} notebookTitle='Life' path={[]} count={7} presentation='list' onPresentationChange={() => {}} onCollapse={() => {}} chips={<ListFilterButtons filters={controls} counts={listFacets(controls, facets)} notebookId='life' sortField='updated' sortOrder='desc' onSortChange={() => {}} sortable showHidden={false} hiddenNoteCount={0} onShowHiddenChange={() => {}} />}>
            <ul aria-label='Notes'>
              <li>First note</li>
            </ul>
          </NoteListColumn>
        }
        note={<p>focus pane</p>}
      />
    </I18nProvider>,
  );
  const notebooksColumn = document.getElementById(NOTEBOOK_COLUMN_ID)!;
  const listColumn = document.getElementById(LIST_COLUMN_ID)!;
  expect(within(notebooksColumn).getByText('Projects')).toBeInTheDocument();
  expect(within(notebooksColumn).queryByRole('group', { name: 'Status' })).toBeNull();
  expect(within(notebooksColumn).queryByRole('group', { name: 'Tags' })).toBeNull();
  expect(within(listColumn).getByRole('button', { name: /Status: All/ })).toBeInTheDocument();
  expect(within(listColumn).getByRole('button', { name: /^Tags/ })).toBeInTheDocument();
  expect(within(listColumn).getByRole('list', { name: 'Notes' })).toBeInTheDocument();
  expect(listColumn).not.toContainElement(screen.getByText('focus pane'));
  expect(notebooksColumn).not.toContainElement(screen.getByText('focus pane'));
  expect(document.querySelector('.sidebar-rail')).toBeNull();
  expect(screen.queryByRole('separator', { name: 'Resize folders and list' })).toBeNull();
});

function drawer(value?: Partial<NoteFilters>) {
  const controls = filters(value);
  return render(
    <I18nProvider>
      <Sidebar filters={controls} facets={facets} folders={folders} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={['work']} tabbed />
    </I18nProvider>,
  );
}

it("splits a phone's drawer into 目錄 and 篩選 tabs: the notebook's folders on one, its status and tags on the other", () => {
  drawer();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(tab => tab.textContent)).toEqual(['Directory', 'Filters']);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  const directory = screen.getByRole('tabpanel', { name: 'Directory' });
  expect(within(directory).getByRole('navigation', { name: 'Notebooks' })).toHaveTextContent('Projects');
  expect(within(directory).queryByRole('group', { name: 'Status' })).toBeNull();
  expect(document.querySelector('[role="tabpanel"][data-tab="filters"]')).not.toBeVisible();

  fireEvent.click(tabs[1]);
  expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  const filterPanel = screen.getByRole('tabpanel', { name: 'Filters' });
  expect(within(filterPanel).getByText('Status')).toBeVisible();
  expect(within(filterPanel).getByText('Tags')).toBeVisible();
  expect(within(filterPanel).queryByRole('navigation', { name: 'Notebooks' })).toBeNull();
  expect(directory).not.toBeVisible();
});

it("keeps each drawer tab's state while the other shows: the folders stay folded or open, and the panels stay mounted", () => {
  drawer();
  const directory = screen.getByRole('tabpanel', { name: 'Directory' });
  // Fold the notebook in the 目錄 tab, look at 篩選, and come back: it is still folded.
  const notebookToggle = within(directory).getAllByRole('button', { expanded: true })[0];
  fireEvent.click(notebookToggle);
  expect(notebookToggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('tab', { name: 'Filters' }));
  expect(directory).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Directory' }));
  expect(notebookToggle).toBeVisible();
  expect(notebookToggle).toHaveAttribute('aria-expanded', 'false');
});

it('moves between the drawer tabs with the arrow keys', () => {
  drawer();
  const [directory, filtersTab] = screen.getAllByRole('tab');
  directory.focus();
  fireEvent.keyDown(directory, { key: 'ArrowRight' });
  expect(filtersTab).toHaveAttribute('aria-selected', 'true');
  expect(filtersTab).toHaveFocus();
  fireEvent.keyDown(filtersTab, { key: 'Home' });
  expect(directory).toHaveAttribute('aria-selected', 'true');
});

it("on a phone's list screen shows the path line and the list with nothing under it: no folders, no divider", () => {
  const controls = filters({ tags: ['work'] });
  render(
    <I18nProvider>
      <PhoneBrowseList path={<span>Life / Projects</span>}>
        <FilterChips filters={controls} onAdd={() => {}} />
        <ul aria-label='Notes'>
          <li>First note</li>
        </ul>
      </PhoneBrowseList>
    </I18nProvider>,
  );
  expect(screen.getByText('Life / Projects')).toBeVisible();
  expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('#work');
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Directory' })).toBeNull();
  expect(screen.queryByRole('separator')).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Notebooks' })).toBeNull();
});
