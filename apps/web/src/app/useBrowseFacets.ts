import { noteQueryStatuses } from '@mygitnotes/core/note-query';
import { mergeNotebookStatuses } from '@mygitnotes/core/note-status';
import { useStatusAvoidColor } from '../lib/status-color.js';
import { parseWorkspaceRoute } from '../lib/routes.js';
import { useMemo } from 'react';
import { useNoteFacets } from '../lib/use-note-queries.js';
import { mergeNotebookFacets, queryNotebookIds } from '../lib/note-facets.js';
import type { WorkspaceState } from './workspace-state.js';
import type { ViewMode } from '../lib/types.js';

interface Params {
  showHidden: boolean;
  config: WorkspaceState['config'];
  scopeNotebookId: string;
  selectedFolders: string[];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  route: ReturnType<typeof parseWorkspaceRoute>;
}

export function useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route }: Params) {
  // Counts, status options, tag lists and subfolder counts all come from one facet answer.
  const facetsQuery = useNoteFacets(showHidden);
  const facetNotebookIds = useMemo(() => queryNotebookIds(config?.notebooks || [], scopeNotebookId, selectedFolders), [config, scopeNotebookId, selectedFolders]);
  const merged = useMemo(() => mergeNotebookFacets(facetNotebookIds.flatMap(id => facetsQuery.facets?.[id] || [])), [facetsQuery.facets, facetNotebookIds]);
  // A native kind's list and filters describe the same documents.
  const kindList = route.kind === 'compilation' || route.kind === 'outline';
  const notebookFacets = useMemo(() => {
    const kind = route.kind === 'outline' ? merged.outlines : route.kind === 'compilation' ? merged.compilations : null;
    return kind ? { ...merged, total: kind.total, hidden: 0, statuses: kind.statuses, tags: kind.tags, directories: {} } : merged;
  }, [merged, route.kind]);
  const notebookStatuses = useMemo(() => noteQueryStatuses(config?.notebooks || [], facetNotebookIds.length === 1 ? facetNotebookIds[0] : 'all', Object.keys(notebookFacets.statuses)), [config, facetNotebookIds, notebookFacets]);
  // A new note is created in the current notebook, so it offers that notebook's statuses even while every notebook is listed.
  const newNoteStatuses = useMemo(() => noteQueryStatuses(config?.notebooks || [], selectedNotebookId, Object.keys(facetsQuery.facets?.[selectedNotebookId]?.statuses || {})), [config, selectedNotebookId, facetsQuery.facets]);
  // The statuses of the notebooks being listed decide each status dot's colour; the theme decides which cycle colour to skip.
  const avoidColor = useStatusAvoidColor();
  const statusEntries = useMemo(() => mergeNotebookStatuses((config?.notebooks || []).filter(notebook => facetNotebookIds.includes(notebook.id)), avoidColor), [config, facetNotebookIds, avoidColor]);
  const selectedTags = useMemo(() => [...new Set(route.tags)], [route.tags]);
  // The tag vocabulary spans hidden notes too, so it has its own facet answer.
  const tagFacets = useNoteFacets(true);
  const workspaceTagNames = useMemo(() => Array.from(new Set(Object.values(tagFacets.facets || {}).flatMap(facets => Object.keys(facets.tags)))), [tagFacets.facets]);
  const searchQuery = route.q;
  // Old card links open the folder list.
  const viewMode: ViewMode = route.view === 'card' ? 'list' : route.view;
  // Flat and Kanban list the whole notebook, without folder navigation.
  const folderless = viewMode === 'flat' || viewMode === 'kanban' || kindList;

  return { facetsQuery, notebookFacets, compilationFacets: merged.compilations, notebookStatuses, statusEntries, newNoteStatuses, selectedTags, workspaceTagNames, searchQuery, viewMode, folderless };
}
