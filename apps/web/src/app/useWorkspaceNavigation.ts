import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { changesListFilters, rememberListFilters, removeListFilters, restoreListFilters } from '../lib/list-filter-memory.js';
import { useCurrentEntry } from './current-entry.js';
import { useQueryStates } from 'nuqs';
import { filterParsers, type FilterQuery, writeFilterQuery } from '../lib/filter-query.js';
import { legacyFolderPaths } from '@mygitnotes/core/note-filters';
import type { FilterControls } from '../lib/filter-controls.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { bareNotebookRoute, isFocusNoteState, legacyAllNotebooksRoute, notebookRoute, parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import React, { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../lib/types.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FileManagerHandle } from '../components/files/index.js';
import { type AgentSystemHandle } from '../components/AgentSystemView.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  repositoryId?: string;
  filterVocabulary?: NotebookFacets;
  location: ReturnType<typeof useLocation>;
  queryState: FilterQuery;
  selectedFolders: string[];
  setFilterQuery: ReturnType<typeof useQueryStates<typeof filterParsers>>[1];
  navigate: ReturnType<typeof useNavigate>;
  route: ReturnType<typeof parseWorkspaceRoute>;
  activeTab: WorkspaceTab;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  folderRoot: string | undefined;
  viewMode: ViewMode;
  selectedFolder: string | null;
  config: WorkspaceState['config'];
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  fileManagerRef: React.RefObject<FileManagerHandle>;
  loading: WorkspaceState['loading'];
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  resolveBareNotebook: WorkspaceState['resolveBareNotebook'];
}

export function useWorkspaceNavigation({ repositoryId, filterVocabulary, location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute, resolveBareNotebook }: Params) {
  const currentEntry = useCurrentEntry();
  const editedEntry = useRef<string | undefined>();
  const filterOwner = !loading && editorRoute.valid && activeTab === 'notes' && (!editorRoute.note || isFocusNoteState(location.state)) && !editorRoute.study && !editorRoute.legacyScreen && !editorRoute.legacyAllNotebooks && editorRoute.view !== 'graph' && (!editorRoute.notebook || editorRoute.notebook === selectedNotebookId) ? repositoryId : undefined;
  useEffect(() => {
    if (!currentEntry(location.key) || editedEntry.current === location.key) return;
    editedEntry.current = undefined;
    if (!config || !filterOwner) return;
    const search = restoreListFilters(filterOwner, selectedNotebookId, location.search, filterVocabulary, config.notebooks);
    if (search !== null) navigate({ pathname: location.pathname, search, hash: location.hash }, { replace: true, state: location.state });
  }, [config, currentEntry, filterOwner, filterVocabulary, location, navigate, selectedNotebookId]);
  const currentFilterSearch = (patch: Partial<FilterQuery> = {}) => {
    const query = new URLSearchParams(writeFilterQuery(location.search, { ...queryState, folders: selectedFolders, ...patch }));
    query.delete('folder');
    query.delete('returnTo');
    query.delete('zoom');
    return query;
  };
  const navigateFiltered = async (pathname: string, query: URLSearchParams, replace = false) => {
    await setFilterQuery({});
    navigate({ pathname, search: query.toString() }, { replace });
  };
  // nuqs omits defaults. Save the user's edit before navigating, so removing the last filter doesn't restore it.
  const saveEditedFilters = (query: URLSearchParams) => {
    if (!filterOwner) return;
    editedEntry.current = location.key;
    rememberListFilters(filterOwner, selectedNotebookId, query);
  };
  const changeFilters: FilterControls['onChange'] = patch => {
    const { tags, notebookId: _notebookId, ...values } = patch;
    const next = { ...values, ...(tags ? { tag: tags } : {}) };
    if (changesListFilters(next)) saveEditedFilters(currentFilterSearch(next));
    const clearingNotesFolder = activeTab === 'notes' && !patch.kind && patch.folders?.length === 0;
    if (clearingNotesFolder || (patch.folders && route.folder)) {
      const query = currentFilterSearch(next);
      if (clearingNotesFolder) query.set('folder', '');
      void navigateFiltered(activeTab === 'graph' ? '/graph' : notebookRoute(selectedNotebookId), query);
    } else void setFilterQuery(next, { history: Object.keys(patch).length === 1 && 'q' in patch ? 'replace' : 'push' });
  };
  const clearFilters = () => {
    const query = currentFilterSearch({ q: '', kind: 'note', tag: [], folders: [], descendants: true, tagMode: 'any', status: null, live: [], showHidden: false, groupByFolder: false, neighbors: false });
    saveEditedFilters(query);
    query.delete('lanes');
    if (activeTab === 'notes') query.set('folder', '');
    void navigateFiltered(activeTab === 'graph' ? '/graph' : notebookRoute(selectedNotebookId), query);
  };
  // Leaving the all-notebooks scope restores the folder filters chosen before it, within the current notebook.
  const foldersBeforeAllNotebooks = useRef<string[] | null>(null);
  const changeAllNotebooks = (value: boolean) => {
    if (value) {
      foldersBeforeAllNotebooks.current = selectedFolders;
      void setFilterQuery({ allNotebooks: true });
      return;
    }
    const restored = (foldersBeforeAllNotebooks.current ?? selectedFolders).filter(path => folderRoot && path.startsWith(folderRoot + '/'));
    foldersBeforeAllNotebooks.current = null;
    void setFilterQuery({ allNotebooks: false, folders: restored });
  };
  const setActiveTab = async (tab: WorkspaceTab) => {
    if (resourceNavigationBusy || notebookSwitchBusy || activeTab === tab) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareLeave()) return;
      if (activeTab === 'assets' && !await fileManagerRef.current?.prepareLeave()) return;
      if (activeTab === 'notes' && !await editorRegistry.flushEditors()) return;
      if (tab === 'notes' || tab === 'graph') {
        const query = currentFilterSearch({ view: viewMode === 'graph' ? 'flat' : viewMode });
        query.delete('focus');
        query.set('notebook', selectedNotebookId);
        await navigateFiltered(tab === 'notes' ? notebookRoute(selectedNotebookId) : '/graph', query);
      } else {
        const query = new URLSearchParams({ notebook: selectedNotebookId });
        // The Files page opens at the folder selected in Notes.
        if (tab === 'assets' && selectedFolder && folderRoot) query.set('asset', `${folderRoot}/${selectedFolder}`);
        navigate(`/${tab === 'assets' ? 'files' : tab}?${query.toString()}`);
      }
    } finally {
      setNotebookSwitchBusy(false);
    }
  };
  const agentSystemRef = useRef<AgentSystemHandle>(null);
  const [resourceNavigationBusy, setResourceNavigationBusy] = useState(false);
  const [notebookSwitchBusy, setNotebookSwitchBusy] = useState(false);
  const setSelectedNotebookId = async (id: string) => {
    if (id === selectedNotebookId || resourceNavigationBusy || notebookSwitchBusy) return;
    setNotebookSwitchBusy(true);
    try {
      if (activeTab === 'agent' && !await agentSystemRef.current?.prepareNotebookChange(id)) return;
      if (activeTab === 'assets' && !await fileManagerRef.current?.prepareLeave()) return;
      if (activeTab === 'notes' && !await editorRegistry.flushEditors()) return;
      // Search travels with the person; the new Notes list restores its own filters and sort.
      const query = currentFilterSearch({ folders: [], kind: 'note', sortField: null, sortOrder: null, tag: [], tagMode: 'any', status: null });
      if (activeTab === 'notes') removeListFilters(query);
      query.delete('focus');
      query.set('notebook', id);
      await navigateFiltered(activeTab === 'notes' ? notebookRoute(id) : `/${activeTab}`, query);
    } finally {
      setNotebookSwitchBusy(false);
    }
  };
  const setSelectedFolder = (folder: string | null) => {
    const query = currentFilterSearch({ folders: legacyFolderPaths(config?.notebooks || [], selectedNotebookId, folder), kind: 'note' });
    if (route.kind !== 'note') saveEditedFilters(query);
    if (folder === null) query.set('folder', '');
    void navigateFiltered(notebookRoute(selectedNotebookId), query);
  };
  const setViewMode = (mode: ViewMode) => {
    void setFilterQuery({ view: mode });
  };
  const setGroupByFolder = (value: boolean) => {
    saveEditedFilters(currentFilterSearch({ groupByFolder: value }));
    void setFilterQuery({ groupByFolder: value });
  };
  /* eslint-disable react-hooks/exhaustive-deps -- Canonicalization runs on config or URL arrival; changing the current notebook or navigation helper alone must not replay the redirect. */
  useEffect(() => {
    if (!config) return;
    // An old URL naming a notebook by its bare local id moves to the notebook's key once, replacing history.
    const canonical = legacyAllNotebooksRoute(location.pathname, location.search, selectedNotebookId) ?? bareNotebookRoute(location.pathname, location.search, resolveBareNotebook);
    if (canonical) navigate(canonical + location.hash, { replace: true });
  }, [config, location.pathname, location.search]);
  /* eslint-enable react-hooks/exhaustive-deps */
  /* eslint-disable react-hooks/exhaustive-deps -- The legacy graph-view redirect consumes one route-arrival snapshot; query helpers can change while its asynchronous URL update is still pending. */
  useEffect(() => {
    if (loading || !config || editorRoute.note || route.tab !== 'notes' || route.view !== 'graph') return;
    const query = currentFilterSearch({ view: 'flat' });
    query.delete('focus');
    query.set('notebook', selectedNotebookId);
    void navigateFiltered('/graph', query, true);
  }, [loading, config, editorRoute.note, route.tab, route.view]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode, setGroupByFolder };
}
