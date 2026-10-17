import { type NoteFilters } from '@mygitnotes/core/note-filters';
import { type NoteQuery } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { isNoteHidden } from '@mygitnotes/core/note-status';
import { parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import { useMemo } from 'react';
import { useNoteList, useNoteLookup } from '../lib/use-note-queries.js';
import { useDebounced } from '../lib/use-debounced.js';
import type { ViewMode } from '../lib/types.js';
import { getBreadcrumbs, getImmediateSubfolders } from '../lib/folder-tree.js';
import { SortField, SortOrder } from '../lib/note-sort.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useBrowseFacets } from './useBrowseFacets.js';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation.js';

interface Params {
  scopeNotebookId: string;
  selectedFolders: string[];
  selectedTags: string[];
  route: ReturnType<typeof parseWorkspaceRoute>;
  searchQuery: string;
  selectedStatus: string | null;
  showHidden: boolean;
  config: WorkspaceState['config'];
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  selectedFolder: string | null;
  activeTab: WorkspaceTab;
  sortField: SortField;
  sortOrder: SortOrder;
  viewMode: ViewMode;
  facetsQuery: ReturnType<typeof useBrowseFacets>['facetsQuery'];
  notebookFacets: ReturnType<typeof useBrowseFacets>['notebookFacets'];
  folders: WorkspaceState['folders'];
  notebookStatuses: ReturnType<typeof useBrowseFacets>['notebookStatuses'];
  changeAllNotebooks: ReturnType<typeof useWorkspaceNavigation>['changeAllNotebooks'];
  changeFilters: FilterControls['onChange'];
  clearFilters: ReturnType<typeof useWorkspaceNavigation>['clearFilters'];
  folderless: boolean;
  t: I18nContextValue['t'];
}

export function useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField, sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t }: Params) {
  // The graph filters by several folders, with or without their subfolders; the Notes page selects one folder and always includes its subfolders (the folder view lists one level itself, below).
  const graph = activeTab === 'graph';
  const scopeFolders = useMemo(() => graph ? selectedFolders : selectedFolders.slice(0, 1), [graph, selectedFolders]);
  const descendants = graph ? route.descendants : true;
  const noteFilters = useMemo<NoteFilters>(() => ({ kind: route.kind, notebookId: scopeNotebookId, folders: scopeFolders, tags: selectedTags, descendants, tagMode: route.tagMode, q: searchQuery, status: selectedStatus, showHidden }), [route.kind, scopeNotebookId, scopeFolders, selectedTags, descendants, route.tagMode, searchQuery, selectedStatus, showHidden]);
  const kindList = route.kind === 'compilation' || route.kind === 'outline';
  // Typing in the search box must not fire one server query per keystroke.
  const debouncedSearch = useDebounced(searchQuery);
  // A filtered result spans the subtree, so the folder view lists it whole instead of one level; a selected folder alone is not a filter there.
  const filtered = Boolean(debouncedSearch.trim() || selectedStatus || selectedTags.length > 0 || scopeNotebookId === 'all' || kindList);
  // The count line answers for the selected folder too.
  const counted = filtered || scopeFolders.length > 0;
  const notebookRoot = config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root.replace(/\/$/, '') || '';
  const currentDirectory = [notebookRoot, selectedFolder].filter(Boolean).join('/');

  // Choose by filename before applying visibility so a hidden index keeps priority.
  const browsingNotes = activeTab === 'notes';
  const indexCandidates = useMemo(() => (browsingNotes && !filtered && !kindList && notebookRoot ? [`${currentDirectory}/index.md`, `${currentDirectory}/README.md`].map(path => ({ notebookId: selectedNotebookId, path })) : []), [browsingNotes, filtered, kindList, notebookRoot, currentDirectory, selectedNotebookId]);
  const indexLookup = useNoteLookup(indexCandidates, false);
  const folderIndex = useMemo(() => {
    const selected = indexLookup.notes.find(note => note.path === indexCandidates[0]?.path) ?? indexLookup.notes.find(note => note.path === indexCandidates[1]?.path);
    return selected && (showHidden || !isNoteHidden({ ...selected.metadata, status: selected.status })) ? selected : undefined;
  }, [indexLookup.notes, indexCandidates, showHidden]);

  const baseQuery = useMemo<Partial<NoteQuery>>(() => ({ kind: route.kind, notebookId: scopeNotebookId, folders: scopeFolders, descendants, tags: selectedTags, tagMode: route.tagMode, status: selectedStatus, showHidden, q: debouncedSearch, sort: sortField, order: sortOrder }), [route.kind, scopeNotebookId, scopeFolders, descendants, selectedTags, route.tagMode, selectedStatus, showHidden, debouncedSearch, sortField, sortOrder]);
  // Browsing a folder lists that one directory; searching or filtering lists the whole result.
  // A list spanning the subtree can be grouped by folder, in the sidebar's order, so its rows say where each note sits.
  const groupable = viewMode !== 'kanban' && (filtered || kindList || viewMode === 'flat');
  const groupedByFolder = groupable && route.groupByFolder;
  const listQuery = useMemo<Partial<NoteQuery>>(() => (filtered || kindList || viewMode === 'flat' ? (groupedByFolder ? { ...baseQuery, group: 'folder' } : baseQuery) : viewMode === 'kanban' ? baseQuery : { ...baseQuery, folders: currentDirectory ? [currentDirectory] : [], descendants: false }), [baseQuery, filtered, kindList, viewMode, currentDirectory, groupedByFolder]);
  // Only the notes page lists notes; the other tabs ask for what they draw themselves.
  const listResult = useNoteList(browsingNotes && viewMode !== 'kanban' ? listQuery : null, { hide: folderIndex?.path });
  // Kanban pages each column on its own, so the filter result count needs its own answer.
  const kanbanCount = useNoteList(browsingNotes && counted && viewMode === 'kanban' ? baseQuery : null);
  const filterCount = counted ? (viewMode === 'kanban' ? kanbanCount.total : listResult.total) : (facetsQuery.facets ? notebookFacets.total : null);
  const displayedNotes = listResult.notes;

  const filterProps: FilterControls = { value: noteFilters, neighbors: route.neighbors, notebooks: config?.notebooks || [], folders, tags: Object.keys(notebookFacets.tags), statuses: notebookStatuses, count: filterCount, allNotebooks: graph && route.allNotebooks, onAllNotebooksChange: changeAllNotebooks, onChange: changeFilters, onClear: clearFilters };

  // Hierarchical Subfolder Discovery for current folder
  const immediateSubfolders = useMemo(() => {
    if (folderless || filtered) return [];
    return getImmediateSubfolders(notebookFacets.directories, folders, selectedNotebookId, notebookRoot, selectedFolder);
  }, [notebookFacets, folders, selectedNotebookId, notebookRoot, selectedFolder, filtered, folderless]);

  // Breadcrumb Trail from Root to current folder
  const breadcrumbs = useMemo(() => {
    return getBreadcrumbs(selectedFolder, folders, selectedNotebookId, t('folder.allFolders'));
  }, [selectedFolder, folders, selectedNotebookId, t]);

  return { notebookRoot, folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup, debouncedSearch, groupable, groupedByFolder };
}
