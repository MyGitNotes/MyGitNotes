// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode, useMemo, useState } from 'react';
import { useQueryStates } from 'nuqs';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { filterParsers } from '../lib/filter-query.js';
import { openingNotebook } from '../lib/last-notebook.js';
import { FOCUS_NOTE_STATE, isFocusNoteState, parseWorkspaceRoute } from '../lib/routes.js';
import type { FolderItem } from '../lib/types.js';
import { useBrowseRoute } from './useBrowseRoute.js';
import { useWorkspaceNavigation } from './useWorkspaceNavigation.js';

const config = { workspace: { default_notebook: 'life' }, notebooks: [{ id: 'life', title: 'Life', root: 'notes/life' }, { id: 'thesis', title: 'Thesis', root: 'notes/thesis' }] };
const editorRegistry = { flushEditors: async () => true } as never;
const fileManagerRef = { current: null };
const resolveBareNotebook = () => null;
const folders: FolderItem[] = [{ notebookId: 'life', path: 'journal', title: 'Journal', order: 0 }, { notebookId: 'life', path: 'archive', title: 'Archive', order: 1 }, { notebookId: 'thesis', path: 'sources/因果', title: 'Sources', order: 0 }];
const folderKey = (id: string, repository = 'repo') => `github-notes:last-folder:${repository}:${id}`;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

/** Exercise the browse and navigation hooks together with the app's query adapter. */
interface OpenOptions {
  foldersLoading?: boolean;
  rememberedNotebook?: string | null;
  repositoryId?: string;
  inFocus?: boolean;
}

function notesAt(url: string, { foldersLoading = false, rememberedNotebook = null, repositoryId = 'repo', inFocus = false }: OpenOptions = {}) {
  window.history.replaceState(null, '', '/settings');
  window.history.pushState({ usr: inFocus ? FOCUS_NOTE_STATE : null }, '', url);
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(BrowserRouter, null, createElement(NuqsAdapter, null, children));
  return renderHook(({ foldersLoading }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const navigationType = useNavigationType();
    const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);
    const [queryState, setFilterQuery] = useQueryStates(filterParsers);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [, setFileMetadataOpen] = useState(false);
    const selectedNotebookId = openingNotebook({ routed: editorRoute.notebook ?? undefined, remembered: rememberedNotebook, config });
    const workspaceConfig = config as never;
    const browse = useBrowseRoute({ editorRoute, config: workspaceConfig, location, queryState, setFileMetadataOpen, loading: false, loadError: '', filtersOpen, setFiltersOpen, selectedNotebookId, focusNoteRoute: isFocusNoteState(location.state), phone: false, folders, foldersLoading, repositoryId });
    const navigation = useWorkspaceNavigation({ repositoryId, location, navigate, ...browse, editorRoute, selectedNotebookId, config: workspaceConfig, loading: false, resolveBareNotebook, queryState, setFilterQuery, viewMode: 'flat', editorRegistry, fileManagerRef });
    return { ...browse, location, navigation, navigationType, back: () => navigate(-1) };
  }, { wrapper, initialProps: { foldersLoading } });
}

// UAT (boss): tags 社會 and CoC picked in two notebooks stayed on when thesis opened, so it listed no notes until Clear all.
it("opens another notebook without the last notebook's tags and status, keeping the search", async () => {
  const { result } = notesAt('/notebooks/life?tag=%E7%A4%BE%E6%9C%83&tag=CoC&tagMode=all&status=todo&q=causal');
  await act(async () => {
    await result.current.navigation.setSelectedNotebookId('thesis');
  });
  const query = new URLSearchParams(result.current.location.search);
  expect(result.current.location.pathname).toBe('/notebooks/thesis');
  expect(query.getAll('tag')).toEqual([]);
  expect(query.get('tagMode')).toBeNull();
  expect(query.get('status')).toBeNull();
  expect(query.get('q')).toBe('causal');
});

it('restores each notebook’s list filters without adding a history entry', async () => {
  const { result } = notesAt('/notebooks/life?showHidden=true&groupByFolder=true');
  await act(() => result.current.navigation.setSelectedNotebookId('thesis'));
  expect(result.current.location.search).not.toMatch(/showHidden|groupByFolder/);
  await act(async () => result.current.navigation.changeFilters({ kind: 'outline' }));
  await waitFor(() => expect(window.location.search).toContain('kind=outline'));
  await act(() => result.current.navigation.setSelectedNotebookId('life'));
  await waitFor(() => expect(result.current.route.groupByFolder).toBe(true));
  expect(result.current.route.showHidden).toBe(true);
  expect(result.current.navigationType).toBe('REPLACE');
  await act(async () => result.current.navigation.clearFilters());
  await waitFor(() => expect(result.current.route.groupByFolder).toBe(false));
  expect(result.current.route.showHidden).toBe(false);
  await act(() => result.current.navigation.setSelectedNotebookId('thesis'));
  await waitFor(() => expect(result.current.route.kind).toBe('outline'));
  await act(async () => result.current.navigation.changeFilters({ kind: 'note' }));
  await waitFor(() => expect(result.current.route.kind).toBe('note'));
  expect(localStorage.getItem('github-notes:list-filters:repo:thesis')).toBeNull();
});

it.each([['/notebooks/life', 'life', 'journal', null], ['/', 'thesis', 'sources/因果', 'thesis']] as const)('restores the folder on opening %s, using the resolved notebook', async (url, notebook, folder, rememberedNotebook) => {
  localStorage.setItem(folderKey(notebook), folder);
  const { result } = notesAt(url, { rememberedNotebook });
  expect(result.current.selectedFolder).toBe(folder);
  expect(result.current.selectedFolders).toEqual([`notes/${notebook}/${folder}`]);
  expect(result.current.navigationType).toBe('REPLACE');
  act(() => result.current.back());
  await waitFor(() => expect(result.current.location.pathname).toBe('/settings'));
});

it.each(['/notebooks/life/folders/archive', '/notebooks/life?folder=archive', '/notebooks/life?folders=notes%2Flife%2Farchive'])('prefers the folder in %s and remembers it', url => {
  localStorage.setItem(folderKey('life'), 'journal');
  const { result } = notesAt(url);
  expect(result.current.selectedFolder).toBe('archive');
  expect(localStorage.getItem(folderKey('life'))).toBe('archive');
  expect(result.current.navigationType).toBe('POP');
});

it('clears the remembered folder when choosing root and stays there on reload', async () => {
  const page = notesAt('/notebooks/life?folders=notes%2Flife%2Fjournal');
  expect(localStorage.getItem(folderKey('life'))).toBe('journal');
  await act(async () => page.result.current.navigation.setSelectedFolder(null));
  expect(page.result.current.selectedFolder).toBeNull();
  expect(localStorage.getItem(folderKey('life'))).toBeNull();
  const { pathname, search } = page.result.current.location;
  page.unmount();
  const reload = notesAt(pathname + search);
  expect(reload.result.current.selectedFolder).toBeNull();
  reload.unmount();
  // The URL still means root if another tab has since remembered a different folder.
  localStorage.setItem(folderKey('life'), 'archive');
  expect(notesAt(pathname + search).result.current.selectedFolder).toBeNull();
});

it('records root even if the folder list is still loading', async () => {
  localStorage.setItem(folderKey('life'), 'journal');
  const { result } = notesAt('/notebooks/life', { foldersLoading: true });
  expect(result.current.selectedFolder).toBe('journal');
  await act(async () => result.current.navigation.setSelectedFolder(null));
  expect(result.current.selectedFolder).toBeNull();
  expect(localStorage.getItem(folderKey('life'))).toBeNull();
});

it('restores the folder beside a Focus note without replacing the note or losing its hash or state', () => {
  localStorage.setItem(folderKey('life'), 'journal');
  const { result } = notesAt('/notebooks/life/notes/entry.md#heading', { inFocus: true });
  expect(result.current.selectedFolder).toBe('journal');
  expect(result.current.returnTo).toBe('/notebooks/life?folders=notes%2Flife%2Fjournal');
  expect(result.current.location).toMatchObject({ pathname: '/notebooks/life/notes/entry.md', hash: '#heading', state: FOCUS_NOTE_STATE });
});

it.each(['/notebooks/life', '/notebooks/life/folders/deleted'])('forgets a missing folder at %s only after the folder list arrives', url => {
  localStorage.setItem(folderKey('life'), 'deleted');
  const { result, rerender } = notesAt(url, { foldersLoading: true });
  expect(result.current.selectedFolder).toBe('deleted');
  expect(localStorage.getItem(folderKey('life'))).toBe('deleted');
  expect(result.current.navigationType).toBe('POP');
  rerender({ foldersLoading: false });
  expect(result.current.selectedFolder).toBeNull();
  expect(result.current.selectedFolders).toEqual([]);
  expect(localStorage.getItem(folderKey('life'))).toBeNull();
  expect(result.current.navigationType).toBe('REPLACE');
  expect(result.current.location.pathname).toBe('/notebooks/life');
});

it('opens the target folder on notebook switch without adding a second history entry', async () => {
  localStorage.setItem(folderKey('thesis'), 'sources/因果');
  const { result } = notesAt('/notebooks/life/folders/journal?tag=work&status=todo&sortField=title&sortOrder=desc&q=causal');
  await act(async () => result.current.navigation.setSelectedNotebookId('thesis'));
  expect(result.current.selectedFolder).toBe('sources/因果');
  expect(result.current.navigationType).toBe('REPLACE');
  expect(result.current.route).toMatchObject({ q: 'causal', tags: [], status: null, sortField: null, sortOrder: null });
  act(() => result.current.back());
  await waitFor(() => expect(result.current.location.pathname).toBe('/notebooks/life/folders/journal'));
  expect(result.current.selectedFolder).toBe('journal');
});

it('does not restore or overwrite the notes folder on outline, compilation or 白板 pages', () => {
  localStorage.setItem(folderKey('life'), 'journal');
  for (const url of ['/notebooks/life?kind=outline&folders=notes%2Flife%2Farchive', '/notebooks/life?kind=compilation', '/boards?notebook=life']) {
    const page = notesAt(url);
    expect(page.result.current.location.pathname + page.result.current.location.search).toBe(url);
    expect(localStorage.getItem(folderKey('life'))).toBe('journal');
    page.unmount();
  }
});

it("redirects the Notes page's former graph view to the notebook's 白板 page, replacing the address", async () => {
  const { result } = notesAt('/notebooks/thesis/folders/sources?view=graph&tag=demo&q=causal');
  await waitFor(() => expect(result.current.location.pathname + result.current.location.search).toBe('/boards?notebook=thesis'));
  expect(result.current.navigationType).toBe('REPLACE');
  expect(result.current.route.tab).toBe('boards');
});

it('opens the 白板 page from the top bar on its list, and another notebook there on its own list', async () => {
  const { result } = notesAt('/notebooks/life?q=causal');
  await act(() => result.current.navigation.setActiveTab('boards'));
  expect(result.current.location.pathname + result.current.location.search).toBe('/boards?notebook=life');
  const board = notesAt('/boards?notebook=life&board=notes%2Flife%2Fa.compilation.yml&note=notes%2Flife%2Fn.md');
  await act(() => board.result.current.navigation.setSelectedNotebookId('thesis'));
  expect(board.result.current.location.pathname + board.result.current.location.search).toBe('/boards?notebook=thesis');
});

it('does not restore the last folder of a same-named notebook in another repository', () => {
  localStorage.setItem(folderKey('life', 'other-repo'), 'journal');
  expect(notesAt('/notebooks/life').result.current.selectedFolder).toBeNull();
  expect(localStorage.getItem(folderKey('life', 'other-repo'))).toBe('journal');
});
