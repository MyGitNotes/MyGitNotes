// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { SIDEBAR_SECTIONS_KEY } from '../lib/sidebar-sections.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { Sidebar } from './Sidebar.js';
import { StatusColorProvider } from '../lib/status-color.js';
import { NOTE_MOVE_DRAG_TYPE } from '../lib/note-drag.js';
import { startTouchNoteDrag } from '../lib/touch-note-drag.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, outlines: kind, compilations: { total: 3, statuses: {}, tags: {} } }, work: { total: 1, hidden: 0, statuses: {}, tags: {}, directories: {}, outlines: kind, compilations: kind } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function controls(value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}): FilterControls {
  return { value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value }, neighbors: false, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }, { id: 'work', title: 'Work', root: 'notes/work' }], folders: [], tags: ['work'], statuses: ['todo', 'done'], count: 7, onChange, allNotebooks: false, onAllNotebooksChange: () => {}, onClear: () => {} };
}

const sidebar = (filters: FilterControls, onSelectFolder = vi.fn()) => render(createElement(I18nProvider, null, createElement(Sidebar, { filters, facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder, workspaceTagNames: ['work'] })));

it('treats folder filters and empty notebooks as unknown while folders are loading', () => {
  const filters = controls({ folders: ['notes/life/projects'] });
  const props = { filters, facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: vi.fn(), workspaceTagNames: ['work'] };
  const { rerender } = render(createElement(I18nProvider, null, createElement(Sidebar, { ...props, foldersLoading: true })));
  expect(screen.queryByRole('button', { name: /notes\/life\/projects/ })).toBeNull();
  expect(screen.getAllByText('Loading folders…').length).toBeGreaterThan(0);
  rerender(createElement(I18nProvider, null, createElement(Sidebar, { ...props, foldersLoading: false })));
  expect(screen.getByRole('button', { name: /notes\/life\/projects/ })).toBeTruthy();
  expect(screen.queryByText('Loading folders…')).toBeNull();
});
it('has three collapsible sections, Notebooks, Status and Tags, and no search field', () => {
  sidebar(controls());
  const summaries = [...document.querySelectorAll('details.sidebar-filter-section > summary')].map(summary => summary.textContent);
  expect(summaries).toEqual(['Notebooks', 'Status', 'Tags']);
  expect(screen.queryByRole('searchbox', { name: /search notes/i })).not.toBeInTheDocument();
});

it("offers only the filters that narrow the list (Status and Tags) for a phone's filter sheet, without the notebook tree", () => {
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters: controls(), facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, onSelectFolder: vi.fn(), workspaceTagNames: ['work'], filtersOnly: true })));
  const summaries = [...document.querySelectorAll('details.sidebar-filter-section > summary')].map(summary => summary.textContent);
  expect(summaries).toEqual(['Status', 'Tags']);
  expect(screen.queryByRole('button', { name: 'Expand all folders' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
});
it('paints each status filter dot from the notebook statuses, muting one the notebook does not list', () => {
  const filters = { ...controls(), statuses: ['todo', 'review', 'later', 'stray'] };
  render(
    <StatusColorProvider statuses={['todo', { name: 'review', color: 'teal' }, 'later']}>
      <I18nProvider>
        <Sidebar filters={filters} facets={facets} folders={[]} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={['work']} />
      </I18nProvider>
    </StatusColorProvider>,
  );
  const dot = (status: string) => document.querySelector(`[data-status-filter="${status}"] .status-dot`);
  expect([dot('todo'), dot('review'), dot('later'), dot('stray')].map(node => [...node!.classList].find(name => name.startsWith('bg-')))).toEqual(['bg-warning', 'bg-status-teal', 'bg-status-pink', 'bg-muted']);
});

it('remembers a collapsed section in localStorage for this browser', () => {
  const first = sidebar(controls());
  const status = [...document.querySelectorAll('details.sidebar-filter-section')][1] as HTMLDetailsElement;
  expect(status.open).toBe(true);
  status.open = false;
  fireEvent(status, new Event('toggle'));
  expect(JSON.parse(window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)!)).toEqual({ status: false });
  first.unmount();
  sidebar(controls());
  const reopened = [...document.querySelectorAll('details.sidebar-filter-section')] as HTMLDetailsElement[];
  expect(reopened.map(section => section.open)).toEqual([true, false, true]);
});

it('gives each notebook a Compilations entry with its count that lists compilations', () => {
  const onChange = vi.fn();
  sidebar(controls({}, onChange));
  const entry = screen.getByRole('button', { name: /Compilations/ });
  expect(within(entry.closest('.nav-tree-row') as HTMLElement).getByText('3')).toBeInTheDocument();
  fireEvent.click(entry);
  expect(onChange).toHaveBeenCalledWith({ kind: 'compilation', folders: [] });
});

it('lists outline documents beside compilations and scopes their status/tag counts', () => {
  const onChange = vi.fn();
  const outlineFacets = { ...facets, life: { ...facets.life, outlines: { total: 2, statuses: { todo: 2 }, tags: { research: 2 } } } };
  render(
    <I18nProvider>
      <Sidebar filters={controls({ kind: 'outline' }, onChange)} facets={outlineFacets} folders={[]} selectedNotebookId='life' onManageFiles={() => {}} onSelectFolder={() => {}} workspaceTagNames={[]} />
    </I18nProvider>,
  );
  const entry = screen.getByRole('button', { name: /Outlines/ });
  expect(within(entry.closest('.nav-tree-row') as HTMLElement).getByText('2')).toBeInTheDocument();
  expect([...document.querySelectorAll('.nav-tree-row.is-selected')].map(row => row.textContent)).toEqual([expect.stringContaining('Outlines')]);
  expect(screen.getByText('research')).toBeInTheDocument();
  fireEvent.click(entry);
  expect(onChange).toHaveBeenCalledWith({ kind: 'outline', folders: [] });
});

it.each(['Delete', 'Move', 'Open file browser'])('puts %s on the folder dropdown, never the notebook, and forwards its nested path', async label => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 'r1' }) }));
  const onManageFiles = vi.fn();
  render(
    <I18nProvider>
      <Sidebar filters={controls()} facets={facets} folders={[{ notebookId: 'life', path: 'one', title: 'One', order: 0 }, { notebookId: 'life', path: 'one/nested', title: 'Nested', order: 0 }]} selectedNotebookId='life' selectedFolder='one/nested' onManageFiles={onManageFiles} foldersWritable onSelectFolder={() => {}} workspaceTagNames={[]} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: 'Manage folder: Life' })).not.toBeInTheDocument();
  // Folders drag without a reorder switch.
  expect(document.querySelector('.folder-heading-actions')).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Manage folder: Nested' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
  const menu = await screen.findByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Delete', 'Move', 'Open file browser']);
  await waitFor(() => expect(within(menu).getByRole('menuitem', { name: label })).not.toHaveAttribute('data-disabled'));
  fireEvent.click(within(menu).getByRole('menuitem', { name: label }));
  await waitFor(() => expect(onManageFiles).toHaveBeenCalledWith('life', 'one/nested', label === 'Delete' ? 'delete' : label === 'Move' ? 'move' : 'browse'));
});

it('dismisses the folder dropdown on Escape and restores trigger focus without opening a manager', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 'r1' }) }));
  const onManageFiles = vi.fn();
  render(
    <I18nProvider>
      <Sidebar filters={controls()} folders={[{ notebookId: 'life', path: 'one', title: 'One', order: 0 }]} selectedNotebookId='life' onManageFiles={onManageFiles} foldersWritable onSelectFolder={() => {}} workspaceTagNames={[]} />
    </I18nProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Manage folder: One' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
  fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(onManageFiles).not.toHaveBeenCalled();
});

it('marks Compilations as the selected entry, not the notebook, while the list shows compilations', () => {
  sidebar(controls({ kind: 'compilation' }));
  const rows = [...document.querySelectorAll('.nav-tree-row')];
  expect(rows.filter(row => row.classList.contains('is-selected')).map(row => row.textContent)).toEqual([expect.stringContaining('Compilations')]);
});

it('moves a note dropped on a folder or on its notebook, and ignores a note of another notebook', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 'r1' }) }));
  const onDropNote = vi.fn();
  render(
    <I18nProvider>
      <Sidebar filters={controls()} folders={[{ notebookId: 'life', path: 'one', title: 'One', order: 0 }]} selectedNotebookId='life' onManageFiles={() => {}} foldersWritable onSelectFolder={() => {}} onDropNote={onDropNote} workspaceTagNames={[]} />
    </I18nProvider>,
  );
  const folder = screen.getByRole('button', { name: 'One' });
  await waitFor(() => expect(folder).not.toBeDisabled());
  const drag = (notebookId: string) => {
    const payload = JSON.stringify({ notebookId, path: 'notes/a.md' });
    return { dataTransfer: { types: [NOTE_MOVE_DRAG_TYPE], getData: (type: string) => type === NOTE_MOVE_DRAG_TYPE ? payload : '', dropEffect: '' } };
  };
  fireEvent.dragOver(folder, drag('life'));
  expect(folder.closest('.folder-note-over')).toBeInTheDocument();
  fireEvent.drop(folder, drag('life'));
  expect(onDropNote).toHaveBeenLastCalledWith({ notebookId: 'life', path: 'notes/a.md' }, 'one');
  expect(folder.closest('.folder-note-over')).not.toBeInTheDocument();
  fireEvent.drop(screen.getByRole('button', { name: /^Life/ }), drag('life'));
  expect(onDropNote).toHaveBeenLastCalledWith({ notebookId: 'life', path: 'notes/a.md' }, null);
  fireEvent.drop(folder, drag('work'));
  expect(onDropNote).toHaveBeenCalledTimes(2);
});

it('takes a note dragged by touch onto a folder', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revision: 'r1' }) }));
  const onDropNote = vi.fn();
  render(
    <I18nProvider>
      <Sidebar filters={controls()} folders={[{ notebookId: 'life', path: 'one', title: 'One', order: 0 }]} selectedNotebookId='life' onManageFiles={() => {}} foldersWritable onSelectFolder={() => {}} onDropNote={onDropNote} workspaceTagNames={[]} />
    </I18nProvider>,
  );
  const folder = screen.getByRole('button', { name: 'One' });
  await waitFor(() => expect(folder).not.toBeDisabled());
  const under = vi.fn<(x: number, y: number) => Element | null>(() => null);
  document.elementFromPoint = under;
  try {
    const drag = startTouchNoteDrag({ notebookId: 'life', path: 'notes/a.md' }, 'A', 0, 0);
    under.mockReturnValue(folder);
    act(() => drag.move(5, 5));
    expect(folder.closest('.folder-note-over')).toBeInTheDocument();
    act(() => drag.drop());
    expect(onDropNote).toHaveBeenCalledWith({ notebookId: 'life', path: 'notes/a.md' }, 'one');
    expect(folder.closest('.folder-note-over')).not.toBeInTheDocument();
    expect(document.querySelector('.note-touch-ghost')).toBeNull();
  } finally {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
});
