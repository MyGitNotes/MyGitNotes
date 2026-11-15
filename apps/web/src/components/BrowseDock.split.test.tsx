// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import type { FolderItem } from '../lib/types.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { BrowseDock } from './BrowseDock.js';
import { BrowseSplit } from './BrowseSplit.js';
import { FilterChips } from './FilterChips.js';
import { Sidebar } from './Sidebar.js';

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: kind } };
const folders: FolderItem[] = [{ notebookId: 'life', path: 'projects', title: 'Projects', order: 0 }];
const filters = (value: Partial<NoteFilters> = {}): FilterControls => ({ value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }], folders: [], tags: ['work'], statuses: ['todo', 'done'], count: 7, onChange: () => {}, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} });

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

function column({ narrow, dock, collapsed = false, onCollapsedChange = vi.fn(), value }: { narrow: boolean; dock: 'filters' | 'folders'; collapsed?: boolean; onCollapsedChange?: (collapsed: boolean) => void; value?: Partial<NoteFilters>; }) {
  const controls = filters(value);
  const sidebar = <Sidebar filters={controls} facets={facets} folders={folders} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={['work']} dock={dock} />;
  const browse = (
    <BrowseSplit label='Folders' top={sidebar} path={<span>Life / Projects</span>} size={55} onSizeChange={() => {}} collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
      {dock === 'folders' && <FilterChips filters={controls} onAdd={() => {}} />}
      <ul aria-label='Notes'>
        <li>First note</li>
      </ul>
    </BrowseSplit>
  );
  return render(
    <I18nProvider>
      <BrowseDock placement='left' size={288} onSizeChange={() => {}} collapsed={false} narrow={narrow} narrowView='browse' browse={browse}>
        <p>focus pane</p>
      </BrowseDock>
    </I18nProvider>,
  );
}

it('beside a Focus, the left column holds the folders and filters over the list, with no rail', () => {
  column({ narrow: false, dock: 'filters' });
  const top = screen.getByRole('region', { name: 'Folders' });
  expect(within(top).getByRole('navigation', { name: 'Notebooks' })).toHaveTextContent('Projects');
  expect(within(top).getByRole('group', { name: 'Status' })).toBeInTheDocument();
  expect(within(top).getByRole('group', { name: 'Tags' })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Notes' });
  // One column: the folders, the divider and the list share the browse panel beside the Focus.
  const panel = top.closest('.browse-dock-panel')!;
  expect(panel).toContainElement(list);
  expect(panel).toContainElement(screen.getByRole('separator', { name: 'Resize folders and list' }));
  expect(panel).not.toContainElement(screen.getByText('focus pane'));
  expect(document.querySelector('.sidebar-rail')).toBeNull();
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it("on a phone's list screen shows the folders over the chips and the list, and ▾ folds them to the path line", () => {
  const onCollapsedChange = vi.fn();
  const { unmount } = column({ narrow: true, dock: 'folders', onCollapsedChange, value: { tags: ['work'] } });
  const top = screen.getByRole('region', { name: 'Folders' });
  expect(within(top).getByRole('navigation', { name: 'Notebooks' })).toHaveTextContent('Projects');
  expect(within(top).queryByRole('group', { name: 'Status' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Active filters' })).toHaveTextContent('#work');
  expect(top).not.toContainElement(screen.getByRole('group', { name: 'Active filters' }));
  expect(screen.queryByText('focus pane')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse folders' }));
  expect(onCollapsedChange).toHaveBeenCalledWith(true);
  unmount();

  column({ narrow: true, dock: 'folders', collapsed: true });
  expect(screen.queryByRole('region', { name: 'Folders' })).toBeNull();
  expect(screen.getByText('Life / Projects')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Expand folders' })).toBeVisible();
  expect(screen.getByRole('list', { name: 'Notes' })).toBeVisible();
});
