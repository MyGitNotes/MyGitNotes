import { type FilterQuery } from '../lib/filter-query.js';
import { useLocation } from 'react-router-dom';
import { noteReturnRoute, parseWorkspaceRoute } from '../lib/routes.js';
import React, { useEffect, useMemo } from 'react';
import { useSidebarSwipe } from '../lib/use-sidebar-swipe.js';
import { useRememberedFolder } from './useRememberedFolder.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  config: WorkspaceState['config'];
  location: ReturnType<typeof useLocation>;
  queryState: FilterQuery;
  setFileMetadataOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loading: WorkspaceState['loading'];
  loadError: WorkspaceState['loadError'];
  filtersOpen: boolean;
  setFiltersOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  focusNoteRoute: boolean;
  repositoryId: string | undefined;
  folders: WorkspaceState['folders'];
  foldersLoading: WorkspaceState['foldersLoading'];
  /** Only a phone's Notes page has the notebooks drawer that a swipe from the edge opens; wider screens show the notebooks column. */
  phone: boolean;
}

export function useBrowseRoute({ editorRoute, config, location, queryState, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId, focusNoteRoute, repositoryId, folders, foldersLoading, phone }: Params) {
  const editorNotebookId = editorRoute.notebook || selectedNotebookId;
  const returnTo = noteReturnRoute(location.search, editorNotebookId, editorRoute.folder);
  const route = useMemo(() => {
    if (!editorRoute.note) return { ...editorRoute, ...queryState, tag: queryState.tag[0] || null, tags: queryState.tag };
    const origin = new URL(returnTo, window.location.origin);
    return parseWorkspaceRoute(origin.pathname, origin.search);
  }, [editorRoute, returnTo, queryState]);
  const activeTab = route.tab;
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- The route hook coordinates metadata visibility owned by the workspace; preserve its post-commit ordering with route changes. */
    setFileMetadataOpen(false);
    /* eslint-enable react/set-state-in-effect */
  }, [activeTab, setFileMetadataOpen]);
  const sidebarGestureRef = useSidebarSwipe(activeTab === 'notes' && phone && !loading && !loadError, filtersOpen, setFiltersOpen);
  const folderRoot = config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root.replace(/\/$/, '');
  const { selectedFolder, selectedFolders } = useRememberedFolder({ location, editorRoute, browseRoute: route, focusNoteRoute, repositoryId, notebookId: selectedNotebookId, folderRoot, folders, foldersLoading });
  // The Notes page always shows the current notebook.
  const scopeNotebookId = selectedNotebookId;
  const selectedStatus = route.status;
  const showHidden = route.showHidden;

  return { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden };
}
