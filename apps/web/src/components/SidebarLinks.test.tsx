// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { History } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';
import { PhoneFilterSheet } from './PhoneListBar.js';
import { Sidebar } from './Sidebar.js';
import { NotebookColumn } from './NotebookColumn.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: kind } };
const filters: FilterControls = { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false } as NoteFilters, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo'] }], folders: [], tags: ['work'], statuses: ['todo'], count: 7, onChange: () => {}, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} };

const archive: WebFeature = { id: 'archive', sidebarLinks: () => [{ id: 'old', label: 'Old notes', href: 'https://old.example.com/list', icon: History }, { id: 'script', label: 'Script', href: 'javascript:alert(1)' }, { id: 'tabbed', label: 'Tabbed', href: '/\t/evil.example.com' }, { id: 'help', label: 'Help', href: '/help' }] };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function app(features: WebFeature[], children: ReactNode) {
  return render(
    <I18nProvider>
      <WebFeaturesProvider features={features}>
        <MemoryRouter initialEntries={['/notes']}>
          <Routes>
            <Route path='/notes' element={children} />
            <Route path='/help' element={<h1>Help page</h1>} />
          </Routes>
        </MemoryRouter>
      </WebFeaturesProvider>
    </I18nProvider>,
  );
}

const sidebar = (tabbed = false) => <Sidebar filters={filters} facets={facets} folders={[]} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={['work']} tabbed={tabbed} />;
const notebookColumn = (mode: 'open' | 'rail') => <NotebookColumn mode={mode} columnId='browse-notebooks' notebooks={filters.notebooks} selectedNotebookId='life' onSelectNotebook={() => {}} current={<p>Life</p>} query='' onQueryChange={() => {}} onOpenSearch={() => {}} kind='note' onSelectKind={() => {}} />;
const sheet = (onClose = vi.fn()) => (
  <PhoneFilterSheet onClose={onClose} sortField='updated' sortOrder='desc' onSortChange={vi.fn()} viewMode='flat' setViewMode={vi.fn()} showHidden={false} hiddenNoteCount={0} onShowHiddenChange={vi.fn()}>
    <p>filters</p>
  </PhoneFilterSheet>
);

/** The external link opens in a new tab without an opener, the path navigates in place, and the unsafe ones are gone. */
function expectLinks(group: HTMLElement) {
  const links = within(group).getAllByRole('link');
  expect(links).toHaveLength(2);
  const old = within(group).getByRole('link', { name: 'Old notes (opens in a new tab)' });
  expect(old).toHaveAttribute('href', 'https://old.example.com/list');
  expect(old).toHaveAttribute('target', '_blank');
  expect(old).toHaveAttribute('rel', 'noopener noreferrer');
  const help = within(group).getByRole('link', { name: 'Help' });
  expect(help).toHaveAttribute('href', '/help');
  expect(help).not.toHaveAttribute('target');
  expect(within(group).queryByRole('link', { name: /Script|Tabbed/ })).toBeNull();
  return help;
}

it("shows an edition's links at the bottom of the sidebar and opens a path in the app", () => {
  app([archive], sidebar());
  const group = screen.getByRole('navigation', { name: 'Links' });
  expect(group.closest('.workspace-sidebar-footer')).not.toBeNull();
  fireEvent.click(expectLinks(group));
  expect(screen.getByRole('heading', { name: 'Help page' })).toBeInTheDocument();
});

it('shows the links at the foot of the notebooks column, open or folded to its rail, and opens a path in the app', () => {
  const open = app([archive], notebookColumn('open'));
  const group = screen.getByRole('navigation', { name: 'Links' });
  expect(group.closest('.browse-notebooks-footer')).not.toBeNull();
  expectLinks(group);
  open.unmount();
  app([archive], notebookColumn('rail'));
  const rail = screen.getByRole('navigation', { name: 'Links' });
  expect(rail.closest('.browse-rail')).not.toBeNull();
  fireEvent.click(expectLinks(rail));
  expect(screen.getByRole('heading', { name: 'Help page' })).toBeInTheDocument();
});

it("shows the links at the foot of a phone's drawer, below both of its tabs", () => {
  app([archive], sidebar(true));
  const group = screen.getByRole('navigation', { name: 'Links' });
  expect(group.closest('.workspace-sidebar-footer')).not.toBeNull();
  expect(group.closest('[role="tabpanel"]')).toBeNull();
  expectLinks(group);
});

it("shows the links in a phone's filter sheet, which a path in the app closes", () => {
  const onClose = vi.fn();
  app([archive], sheet(onClose));
  const group = within(screen.getByRole('dialog', { name: 'Filter and sort' })).getByRole('navigation', { name: 'Links' });
  fireEvent.click(expectLinks(group));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("leaves the links out of the sidebar's filters inside the phone sheet, which shows them once itself", () => {
  app([archive], <Sidebar filters={filters} facets={facets} folders={[]} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={['work']} filtersOnly />);
  expect(screen.queryByRole('navigation', { name: 'Links' })).toBeNull();
});

it('adds nothing when no feature registers a link, or only unsafe ones', () => {
  const unsafe: WebFeature = { id: 'unsafe', sidebarLinks: () => [{ id: 'x', label: 'X', href: 'javascript:void 0' }, { id: 'y', label: 'Y', href: 'data:text/html,hi' }, { id: 'z', label: 'Z', href: '//evil.example.com' }] };
  for (const features of [[], [{ id: 'plain' }], [unsafe]]) {
    for (const view of [sidebar(), notebookColumn('open'), notebookColumn('rail'), sheet()]) {
      const { unmount } = app(features, view);
      expect(screen.queryByRole('navigation', { name: 'Links' })).toBeNull();
      expect(document.querySelector('.workspace-sidebar-footer, .browse-notebooks-footer')).toBeNull();
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      unmount();
    }
  }
});

it('names a link on the rail by tooltip, not a native title', async () => {
  app([archive], notebookColumn('rail'));
  const help = screen.getByRole('link', { name: 'Help' });
  expect(help).not.toHaveAttribute('title');
  fireEvent.pointerEnter(help, { pointerType: 'mouse' });
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Help');
});
