import { Tooltip } from './components/Tooltip.js';
import { useNoteSort } from './app/useNoteSort.js';
import { LegacyOutlineDialog } from './components/LegacyOutlineDialog.js';
import { useLegacyBookmarkRecovery } from './lib/use-legacy-bookmark-recovery.js';
import { Button } from './components/Button.js';
import { useOutlineActions } from './app/useOutlineActions.js';
import { OutlineActionsProvider } from './lib/outline-actions.js';
import { PiAgentProvider } from './lib/pi-agent/session.js';
import { TypstPreviewProvider } from './lib/typst-preview/preview-target.js';
import { AgentFocusCommand } from './components/pi-agent/AgentFocusCommand.js';
import { AssistantDock } from './components/assistant/AssistantDock.js';
import { TypstPreviewDock } from './components/typst-preview/TypstPreviewDock.js';
import { useWebAgentTools } from './app/useWebAgentTools.js';
import { AddToOutlineDialog } from './components/AddToOutlineDialog.js';
import { useFilterSidebar } from './app/useFilterSidebar.js';
import { useTheme } from './app/useTheme.js';
import { useFilePanel } from './app/useFilePanel.js';
import { useWorkspaceNotes } from './app/useWorkspaceNotes.js';
import { useBrowseRoute } from './app/useBrowseRoute.js';
import { useBrowseFacets } from './app/useBrowseFacets.js';
import { useFocusPanes } from './app/useFocusPanes.js';
import { useWorkspaceNavigation } from './app/useWorkspaceNavigation.js';
import { useSourceReset } from './app/useSourceReset.js';
import { useBrowseNotes } from './app/useBrowseNotes.js';
import { useNoteActions } from './app/useNoteActions.js';
import { useFocusNoteNavigation } from './app/useFocusNoteNavigation.js';
import { useNoteLinkLoad, useOpenNoteLinkInFocus } from './app/useNoteLinkFocus.js';
import { EditorModeRouteProvider } from './app/editor-mode-route.js';
import { LiveEditLinkProvider, liveEditLinkTarget } from './app/live-edit-link.js';
import { useNoteSaving } from './app/useNoteSaving.js';
import { useDeletionUndo } from './app/useDeletionUndo.js';
import { useNoteRestoration } from './app/useNoteRestoration.js';
import { useWorkingNoteCommit } from './app/useWorkingNoteCommit.js';
import { useFileNavigation } from './app/useFileNavigation.js';
import { useChangeDialog } from './app/useChangeDialog.js';
import { useQuickNoteCommit } from './app/useQuickNoteCommit.js';
import { useShortcutSurface } from './app/useShortcutSurface.js';
import { useAppCommands } from './app/useAppCommands.js';
import { useWorkspaceOverview } from './app/useWorkspaceOverview.js';
import { type NoteListItem, sameNote } from '@mygitnotes/core/note-query';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { discardDocumentDraft } from './lib/use-workspace-document.js';
import { documentClientOf } from './lib/workspace-document-clients.js';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { NoteLocationProvider } from './lib/note-location.js';
import { ImageLightbox } from './components/ImageLightbox.js';
import { useNavigate } from 'react-router-dom';
import { hasStoredFocusView, isEmptyFocus } from './lib/focus-view.js';
import { noteLookupOptions, useNotebookTemplates } from './lib/use-note-queries.js';
import { isTemplatePath } from './lib/note-templates.js';
import { useTemplateActions } from './app/useTemplateActions.js';
import { ManageTemplatesDialog } from './components/ManageTemplatesDialog.js';
import { FOCUS_NOTE_STATE, notebookRoute, noteRoute, parseWorkspaceRoute, trailCompilation } from './lib/routes.js';
import { draftScope, editable, legacyImportOffered, pageRepository } from './lib/workspace-repositories.js';
import { DemoBanner } from './components/DemoBanner.js';
import { demoFocusesOf, useDemoScenario } from './app/useDemoScenario.js';
import { forgetNoteDrafts } from './lib/storage.js';
import { sameValue } from './lib/merge-note.js';
import React, { useEffect, useMemo, useState } from 'react';
import { fetchGitStatus, readNote } from './lib/api.js';
import { builtinNoteTemplates } from './lib/builtin-templates.js';
import { NoteListSentinel } from './components/NoteListSentinel.js';
import type { NotebookConfig, NoteItem } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
import { useNoteSelection } from './app/useNoteSelection.js';
import { useBulkNoteActions } from './app/useBulkNoteActions.js';
import { BulkActionsToolbar } from './components/BulkActionsToolbar.js';
import { FolderPickerDialog } from './components/FolderPickerDialog.js';
import { useAssetOperations } from './app/useAssetOperations.js';
import { useRoutedNote } from './app/useRoutedNote.js';
import { followMovedNote } from './app/follow-moved-note.js';
import { noteEditorProps } from './app/note-editor-props.js';
import { useNoteSearchFocus } from './app/useNoteSearchFocus.js';
import { useActionErrorReset } from './app/useActionErrorReset.js';
import { UNTITLED_STEM, useCreateNote } from './app/useCreateNote.js';
import { useNoteMove } from './app/useNoteMove.js';
import { folderCommandScope } from './lib/file-change-scope.js';
import type { FolderCommand } from '@mygitnotes/core';
import type { DraggedNote } from './lib/note-drag.js';
import { noteFolder } from './lib/note-move.js';
import { RenameNoteDialog } from './components/RenameNoteDialog.js';
import { AccountControls, AgentAccessSettings, ConnectionState } from './components/AuthControls.js';
import { Header, HeaderUtilities } from './components/Header.js';
import { WorkspaceGitSyncProvider } from './lib/workspace-git-sync.js';
import { PhoneFilterSheet, PhoneListBar } from './components/PhoneListBar.js';
import { PhoneNotesProvider, phoneNotesScreen } from './lib/phone-notes.js';
import { KeyboardShortcuts } from './components/KeyboardShortcuts.js';
import { KeyboardRoot } from './lib/keyboard/KeyboardDispatcher.js';
import { SidebarProvider, WorkspaceSidebarPortal, WorkspaceSplitLayout } from './components/WorkspaceChrome.js';
import type { NewNoteActions } from './components/NewNoteMenu.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { Sidebar } from './components/Sidebar.js';
import { FilterChips } from './components/FilterChips.js';
import { BrowseSplit } from './components/BrowseSplit.js';
import { browsePath, phoneBrowseLayout } from './lib/browse-layout.js';
import { paneColumns } from './lib/browse-columns.js';
import { browseColumnCommands, useBrowseColumns } from './app/useBrowseColumns.js';
import { BrowseColumns, LIST_COLUMN_ID, NOTEBOOK_COLUMN_ID } from './components/BrowseColumns.js';
import { useNotebookAppearance } from './components/NotebookAppearance.js';
import { NotebookColumn } from './components/NotebookColumn.js';
import { NotebookTree } from './components/NotebookTree.js';
import { type FolderChoice, NoteListColumn } from './components/NoteListColumn.js';
import { ListFilterButtons } from './components/ListFilterButtons.js';
import { listFacets } from './lib/list-facets.js';
import { FocusNoteList } from './components/FocusNoteList.js';
import { noteFolderGrouping } from './lib/note-groups.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import { NoteEditingProvider, useNoteEditorRegistry } from './lib/note-editing.js';
import { FocusArea } from './components/FocusArea.js';
import { FoldedNoteDots } from './components/FoldedNoteDots.js';
import { FocusControls } from './components/FocusControls.js';
import { AddToFocusDialog } from './components/AddToFocusDialog.js';
import { CompilationView } from './components/CompilationView.js';
import { planNewCompilation } from './lib/compilation-create.js';
import { initialCompilationStatus } from './lib/compilation-status.js';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { usePhone } from './lib/use-phone.js';
import { useFocusSearch } from './lib/focus-search.js';
import { LegacyScreenRedirect } from './components/LegacyScreenRedirect.js';
import { LegacySchemaNotice } from './components/LegacySchemaNotice.js';
import { CompilationActionsProvider } from './lib/compilation-actions.js';
import { StatusColorProvider } from './lib/status-color.js';
import { statusLabel } from '@mygitnotes/core/note-status';
import { useCompilationActionsValue } from './app/useCompilationActionsValue.js';
import { RightPanel } from './components/RightPanel.js';
import { FileManager, FileManagerDialog, FileMetadata } from './components/files/index.js';
import { AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { useAgentEnabled } from './lib/web-features.js';
import { DerivedManifestNotice, RepositorySwitch, WorkspaceGate } from './components/WorkspaceSetup.js';
import { useLeaveWarning } from './lib/use-leave-warning.js';
import { CommitModal } from './components/CommitModal.js';
import { useGistConfirm } from './components/GistConfirmDialog.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { AlertCircle, AlertTriangle, PanelLeft, X } from 'lucide-react';
import { LoadingStatus } from './components/LoadingStatus.js';
import { liveEditableKind } from './lib/live-api.js';
import { useLiveHandover } from './app/useLiveHandover.js';
import type { LivePathPrompt } from './lib/new-note.js';
import { LiveNewNoteDialog } from './components/live/LiveNewNoteDialog.js';
import { liveActionLocked, liveDestinationFolder, type LiveDrafts, LiveDraftsProvider } from './components/live/live-drafts.js';

const CompilationStudy = React.lazy(() => import('./components/CompilationStudy.js').then(module => ({ default: module.CompilationStudy })));
const NotebookGraphPage = React.lazy(() => import('./components/NotebookGraphPage.js').then(module => ({ default: module.NotebookGraphPage })));

/** A stable empty list while the workspace config loads, so the agent provider's value does not churn. */
const NO_NOTEBOOKS: NotebookConfig[] = [];

/** The workspace itself, behind the sign-in gate; the entry loads it as its own chunk. */
export const AppContent: React.FC = () => {
  useVisualViewport();
  const { t, language } = useTranslation();
  const { filtersOpen, setFiltersOpen, location, queryState, setFilterQuery } = useFilterSidebar();
  // A phone shows the notes list and a note one screen at a time, each with its own bars; wider screens show the three columns.
  const phone = usePhone();

  const { currentTheme, handleSelectTheme } = useTheme();

  const [editingNote, setEditingNote] = useState<NoteListItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);

  const { fileDialog, setFileDialog, fileMetadataContainer, setFileMetadataContainer, fileMetadataOpen, setFileMetadataOpen, rightPanelWidth, setRightPanelWidth, selectedFileEntry, setSelectedFileEntry, fileManagerRef } = useFilePanel();

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const { selectedNotebookId, resolveBareNotebook, folders, foldersLoading, sourceId, remote, repositories, defaultRepository, defaultRepositoryBranch, repositoryFor, canWriteNotebook, canChangeFiles, revisionFor, setRepositoryRevision, setNotebookRevision, setManifestRevision, loadError, loading, actionError, setActionError, repoRoot, repositoryChoice, coreUpdate, config, gitStatus, setGitStatus, assets, setAssets, activeWorkingNotes, readDraft, readDraftIn, updateDraft, clearCommittedDrafts, draftsUnder, focus: focusPage, documents, pendingDocuments, refreshWorkspace, membershipChanged, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current && sameNote(current, note) && !sameValue(current, note) ? note : current) });
  // A refusal is said where it happened: moving on to another note, folder, filter or search clears it.
  useActionErrorReset(location.pathname + location.search, setActionError);
  const noteLink = useNoteLinkLoad(location, editorRoute);
  /** The state an address keeps when it follows a moved note: a note the Focus shows (or is about to) stays in the Focus. */
  const followedState = () => noteLink.inFocus ? FOCUS_NOTE_STATE : location.state;
  const { sortField, sortOrder, handleSortChange, metadataSortFields } = useNoteSort(selectedNotebookId, config?.notebooks.find(notebook => notebook.id === selectedNotebookId), noteLink.inFocus);
  const agentEnabled = useAgentEnabled(remote);
  const refreshDocuments = async () => {
    await Promise.all(documents.map(document => document.refresh()));
  };
  // The selected notebook's repository decides what the browse, create and file views may write.
  const canWrite = canWriteNotebook(selectedNotebookId);
  // Moves, renames, folders and assets are changes the server makes; a demo repository allows none of them.
  const canWriteFiles = canChangeFiles(selectedNotebookId);
  // The Focus file is read for the open notebook's repository, which is the demo repository's; a file that fails to load names no Focus.
  const demoFocuses = demoFocusesOf(focusPage);
  useDemoScenario({ config, loading, pathname: location.pathname, navigate, hasGuide: async (notebookId, path) => (await queryClient.fetchQuery(noteLookupOptions(queryScope, [{ notebookId, path }], false))).notes.length > 0, hasRestoredView: notebookKey => hasStoredFocusView(repositoryFor(notebookKey)?.id ?? '', notebookKey), focuses: demoFocuses });
  const { locateNote, remoteTrash, changeCount, repositoryHeading, notebookUnavailable, manifestWritable, canManageTags, notebookGroups, unavailableNotebooks, syncTargets } = useWorkspaceOverview({ config, remote, repositories, defaultRepository, repositoryFor, sourceId, gitStatus, activeWorkingNotes, pendingDocuments, selectedNotebookId });
  const editorRegistry = useNoteEditorRegistry();

  const { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, findCommittedNote, listCommittedPaths, readCommittedNote, readNoteForChange } = useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t });

  // Tag management: rename/merge/delete across the whole workspace, one commit per repository,
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation } = useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite: canManageTags, t, invalidateNotes, setRepositoryRevision, setActionError });

  const { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden } = useBrowseRoute({ editorRoute, config, location, queryState, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId, focusNoteRoute: noteLink.inFocus, repositoryId: notebookUnavailable ? undefined : repositoryFor(selectedNotebookId)?.id, folders, foldersLoading, phone });

  /** The repository the header names: the shown notebook's, else the default repository's. */
  const currentRepository = pageRepository(repositories, sourceId, { tab: activeTab, allNotebooks: route.allNotebooks, notebookId: selectedNotebookId });

  const { facetsQuery, notebookFacets, notebookStatuses, statusEntries, newNoteStatuses, selectedTags, workspaceTagNames, searchQuery, viewMode, folderless } = useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route });

  const { hasActiveTab, focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, activeNotePath, focusDocumentPanel, setDocumentContainer, showFocus, requestClear, confirmingClear, setConfirmingClear } = useFocusPanes({ selectedNotebookId, notebookRepository: repositoryFor(selectedNotebookId)?.id ?? '', focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite: canWriteNotebook(selectedNotebookId), editorRegistry, location, navigate, editorRoute, resolveBareNotebook, focusNoteRoute: noteLink.inFocus, notebookRoot: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root });

  const { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode, setGroupByFolder } = useWorkspaceNavigation({ location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute, resolveBareNotebook });

  const { commitRequest, isCommitOpen, setIsCommitOpen, openCommitModal, panelRemoteChanges, panelGetPreview, panelDescribeChanges } = useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWriteNotebook, repositoryFor });
  // With every repository hidden or unavailable there is no notebook to show, and Settings is where the person
  // recovers: it opens there (decision C8).
  const nothingToShow = !loading && !loadError && !config?.notebooks.length;
  useEffect(() => {
    if (nothingToShow && activeTab !== 'settings') navigate('/settings#settings-repositories', { replace: true });
  }, [nothingToShow, activeTab, navigate]);
  useLeaveWarning(Boolean(panelRemoteChanges?.length));

  // Aggregated tags across the workspace for autocomplete
  const availableTags = useMemo(() => Array.from(new Set(workspaceTagNames.map(tag => tag.trim()))).filter(Boolean).sort(), [workspaceTagNames]);

  // What each repository's live editor can do with a pending note (未歸檔): discard it on delete, move and rename it.
  const liveDrafts = useMemo<LiveDrafts>(() => {
    const live = (notebookId: string) => {
      const repository = repositoryFor(notebookId);
      return repository?.write ? repository.live : undefined;
    };
    return { discards: notebookId => Boolean(live(notebookId)?.discard), retargets: notebookId => Boolean(live(notebookId)?.retarget), releasesUntouched: notebookId => live(notebookId)?.kind === 'builtin' };
  }, [repositoryFor]);
  const { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote } = useDeletionUndo({ canWriteNotebook, revisionFor, setNotebookRevision, updateDraft, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, gitStatus, setGitStatus, repositoryFor });

  useSourceReset({ sourceId, setEditingNote, setDeletedNotes });

  /** A note this page shows lies elsewhere now: its Focus tabs, the address when it names the note, and the lists follow it there. */
  const followMoved = (note: { notebookId: string; path: string; }, to: string, routedFrom: string | null | undefined) => followMovedNote({ note, to, notebook: config?.notebooks.find(nb => nb.id === note.notebookId), routedPath: routedFrom, search: location.search, state: followedState(), link: noteLink, relocatePaths: noteFocus.relocatePaths, navigate, refresh: () => void refreshWorkspace(true).then(invalidateNotes) });
  const { routedNote, routedPath, routedCommitted, routedLoading, routeError } = useRoutedNote({
    config,
    editorRoute,
    editorNotebookId,
    editingNote,
    loading,
    sourceId,
    setEditingNote,
    // The note the address names lies elsewhere now: the address, a note link still waiting for the Focus and the Focus tabs follow it there.
    onFiled: (notebookId, path, from) => followMoved({ notebookId, path: from }, path, from),
  });
  /** Whether a note is one of its notebook's template files, which is edited in zoom and never opens in a Focus pane. */
  const isTemplate = (note: { notebookId: string; path: string; }) => isTemplatePath(config?.notebooks.find(nb => nb.id === note.notebookId), note.path);
  // A note's link opens it in the Focus, not zoom, and the address bar names the note the Focus shows.
  const { trackOpen, returnToFocus, frameSelection } = useOpenNoteLinkInFocus({ link: noteLink, location, navigate, editorRoute, routedNote, routedPath, routeError, noteFocus, activeNotePath, focusNarrowView, selectedNotebookId, notebookRoot: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root, returnTo, browsing: activeTab === 'notes' && !route.study, flushZoom: editorRegistry.flushEditors, setFocusNarrowView, isTemplate });

  /** The notebook whose folders the person folded under its row in the notebooks column; another notebook opens unfolded. */
  const [foldedTree, setFoldedTree] = useState<string | null>(null);
  const presentation = !phone && viewMode === 'kanban' ? 'kanban' : 'list';
  const { notebookRoot, folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup, debouncedSearch, highlightQuery, groupable, groupedByFolder } = useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField, sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t });

  const { handleOpenNote, closeZoom, closeCompilationZoom } = useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, focusNoteRoute: noteLink.inFocus, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets });

  const { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus } = useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus, isTemplate, trackOpen });

  const { handleSaveNote } = useNoteSaving({ canWriteNotebook, remote, readDraft, readCommittedNote, t, stageWorkingNote, invalidateNotes, setEditingNote, setGitStatus, defaultDraftScope: defaultRepository ? draftScope(defaultRepository) : '' });

  const { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex } = useNoteRestoration({ remote, readDraft, updateDraft, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWriteNotebook, t, config, queryClient, queryScope, stageWorkingNote, revisionFor, location, liveLocked: note => liveActionLocked(note, 'other', liveDrafts) });

  // Multi-select and bulk actions (set status, add/remove tag, move to folder) for the browse views.
  const { selectedNotes, selectedKeys, toggleSelect, clearSelection } = useNoteSelection({ displayedNotes, viewMode, selectedNotebookId, scopeKey: noteLink.inFocus ? returnTo : location.pathname + location.search });
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveNotebookId = selectedNotes.length > 0 && selectedNotes.every(note => note.notebookId === selectedNotes[0].notebookId) ? selectedNotes[0].notebookId : undefined;
  const bulkMoveNotebook = config?.notebooks.find(nb => nb.id === bulkMoveNotebookId);

  // The selected notebook's templates: its manifest's, then the files of its `.templates/` folder, with this page's working changes.
  const selectedNotebook = config?.notebooks.find(nb => nb.id === selectedNotebookId);
  // A notebook's 「外觀…」 (icon and colour), from its context menu in the notebooks column.
  const notebookAppearance = useNotebookAppearance({ notebooks: config?.notebooks ?? [], repositoryFor, refreshWorkspace, setManifestRevision });
  const notebookTemplates = useNotebookTemplates(selectedNotebook);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  // A new note of a live repository whose template's path needs values asks for them first.
  const [livePathRequest, setLivePathRequest] = useState<{ template: string; prompts: LivePathPrompt[]; answer: (values: Record<string, string> | null) => void; } | null>(null);
  const selectedRepository = repositoryFor(selectedNotebookId);
  const liveCreation = selectedRepository?.live && selectedRepository.write ? { askLivePathValues: (template: string, prompts: LivePathPrompt[]) => new Promise<Record<string, string> | null>(answer => setLivePathRequest({ template, prompts, answer })), open: (note: NoteListItem) => void handleOpenNote(note) } : undefined;

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createNote } = useCreateNote({ config, selectedNotebookId, setSelectedNotebookId, folders, browsedFolder: activeTab === 'notes' ? selectedFolder : null, foldersLoading, remote, canWrite, readDraft, templates: notebookTemplates.templates, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, live: liveCreation, onCreated: note => void openFromBrowse(note), onError: setActionError });

  const outlineActions = useOutlineActions({ config, repositoryFor, readDraft, remote, sourceId, selectedNotebookId, locationKey: location.key, routedRef: editorRoute.note && editorNotebookId ? { notebookId: editorNotebookId, path: `${config?.notebooks.find(nb => nb.id === editorNotebookId)?.root}/${editorRoute.note}` } : null, prepareLeave: editorRegistry.flushEditors, openNote: handleOpenNote, openNewNote: options => void createNote(options), onError: setActionError });

  // The agent's note tools edit this page's working changes; only a remote workspace has them, as local Pi edits its files.
  const webAgentTools = useWebAgentTools({ config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote, listCommittedPaths, resolveBareNotebook });
  const { confirmGists, gistConfirmDialog } = useGistConfirm();
  const { commitWorkingNotes } = useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError, confirmGists });
  const { commitNoteFile } = useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes, activeWorkingNotes, t, statusLabel: status => statusLabel(status, statusEntries, language) });
  const legacyRecovery = useLegacyBookmarkRecovery(repositories.map(repository => repository.id));
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);

  // Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to.
  const { handleUploadAsset, handleDeleteAsset, handleMoveAsset } = useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus });

  const { beforeFileChange, openFileManager, onFilesChanged, openFileIndex } = useFileNavigation({ editorRegistry, draftsUnder, remote, readDraft, t, config, setFileDialog, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, setActionError, navigate, location, returnTo, focusNoteRoute: noteLink.inFocus, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex, relocateFocus: move => noteFocus.relocatePaths(noteFocus.notebookId, move) });
  /** The unsaved copy an editor keeps in this browser for a note path, which a moved note leaves behind, and the conflicted copy, which follows the note. */
  const forgetDrafts = (notebookId: string, path: string, destination: string) => {
    const repository = repositoryFor(notebookId);
    const scope = (repository ? draftScope(repository) : '') || repository?.branch || '';
    void forgetNoteDrafts(scope, notebookId, path, destination);
  };
  const noteMove = useNoteMove({ config, remote, canWriteNotebook: canChangeFiles, readDraft, updateDraft, stageWorkingNote, saveNote: handleSaveNote, focus: focusPage, queryClient, queryScope, flushEditors: editorRegistry.flushEditors, beforeFileChange, onFilesChanged, setNotebookRevision, forgetDrafts, setActionError, t, retargets: liveDrafts.retargets, releasesUntouched: liveDrafts.releasesUntouched });
  // Offline handover (collab-first A3.2): once online, drafts of notes the built-in live editor covers go to their live notes.
  const liveHandover = useLiveHandover({
    ready: Boolean(remote && sourceId && config),
    drafts: activeWorkingNotes,
    covered: draftNote => {
      const repository = repositoryFor(draftNote.notebookId);
      const notebook = config?.notebooks.find(nb => nb.id === draftNote.notebookId);
      return repository?.live?.kind === 'builtin' && repository.write && notebook && liveEditableKind(draftNote.path) && !isTemplate(draftNote) ? { scope: draftScope(repository), notebookRoot: notebook.root } : null;
    },
    updateDraft,
    readDraft,
    stageWorkingNote,
    invalidateNotes,
    // A note made offline is a pending live note now: an editor showing its draft opens it there.
    onCreated: (draftNote, checkout) => {
      if (routedNote && sameNote(routedNote, draftNote)) void handleOpenNote({ id: checkout.id, path: checkout.path, notebookId: checkout.notebookId, title: draftNote.title, tags: [], metadata: {}, live: { since: checkout.since, activeEditors: checkout.activeEditors, pending: true, editorUrl: checkout.editorUrl } });
    },
  });
  const templateActions = useTemplateActions({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, revisionFor, queryClient, queryScope, invalidateNotes, setGitStatus, openInZoom: handleOpenNote, deleteNote: note => handleDeleteNote(note), relocateFile: noteMove.relocateFile, t });
  const movingNotebook = noteMove.request?.mode === 'move' ? config?.notebooks.find(nb => nb.id === noteMove.request?.note.notebookId) : undefined;
  const { bulkBusy, runBulkStatus, runBulkTag, runBulkMove } = useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus: handleUpdateNoteStatus, beforeFileChange, onFilesChanged, repositories, remote, canWrite: canWriteFiles, t, invalidateNotes, setRepositoryRevision, setActionError, tagOperations, config });

  // A note the Focus shows, or a linked note waiting to open there, is not shown in zoom.
  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError && !noteLink.inFocus;
  // The note a `?edit` address asks to edit live, once zoom or the Focus's active pane shows it.
  const liveEditTarget = liveEditLinkTarget({ search: location.search, state: location.state, routedNote, zoomOpen: noteEditorOpen, inFocus: noteLink.inFocus, focusPending: noteLink.pending, activeNotePath });

  // Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state.
  const editorProps = noteEditorProps({ config, remote, sourceId, gitStatus, assets, activeWorkingNotes, repositoryFor, refreshWorkspace, stageWorkingNote, updateDraft, setActionError, navigate, search: location.search, facets: facetsQuery.facets, availableTags, invalidateNotes, isTemplate, handleOpenNote, closeZoom, handleSaveNote, handleRestoreNoteFile, handleDeleteNote, commitNoteFile, handleUploadAsset, handleDeleteAsset, handleMoveAsset, beforeFileChange, onFilesChanged, returnToFocus, frameSelection, liveHandover, noteMove, templateActions, followMoved, routedPath });

  const phoneNotes = phone && activeTab === 'notes' && !route.study;
  const phoneNoteScreen = phoneNotes && phoneNotesScreen({ hasFocus: Boolean(noteFocus.layout), hasActiveTab, view: focusNarrowView }) === 'note';
  const [phoneFilterOpen, setPhoneFilterOpen] = useState(false);
  // What the Changes tool counts: pending changes, and for a local workspace the deletions awaiting commit.
  const phoneChangesCount = remote ? changeCount : changeCount + deletedNotes.length;
  const phoneNotesValue = useMemo(() => ({ back: () => setFocusNarrowView('browse'), changesCount: phoneChangesCount, deleteNote: canWrite ? (note: NoteItem) => void handleDeleteNote(note as NoteListItem) : undefined }), [setFocusNarrowView, phoneChangesCount, canWrite, handleDeleteNote]);
  // A shown Focus (Default or named) with no open note: a phone's list screen then shows the list alone, without the folders under it.
  const focusEmpty = Boolean(noteFocus.layout && isEmptyFocus(noteFocus.layout));
  // Wider than a phone, the Notes page keeps three columns (notebooks, list, note) whatever opens or closes; the person folds the first two
  // away, and a cramped page, or a Focus whose panes need the room, folds the notebooks column to its rail.
  const notesColumns = !phone && activeTab === 'notes' && !route.study && !notebookUnavailable;
  const columns = useBrowseColumns({ panes: paneColumns(focusDisplay?.root) });
  const { focusCommands, shortcutMode, setShortcutMode } = useShortcutSurface({ noteFocus, focusDisplay, t, showFocus, requestClear, zoomFocusNote, focusCapacity });
  const { noteSearch, focusNoteSearch } = useNoteSearchFocus({ notesColumns, columns, activeTab, phoneNoteScreen, setActiveTab, setFocusNarrowView });
  useAppCommands({ t, setActiveTab: tab => void setActiveTab(tab), canCreateNote: canWrite, createNote: () => void createNote(), focusNoteSearch, noteEditorOpen, pageCommands: notesColumns ? [...focusCommands, ...browseColumnCommands(columns, t, presentation)] : focusCommands });

  const browseFocusMode = noteFocus.layout || phone || presentation === 'list' ? { onZoomNote: (note: NoteListItem) => void handleOpenNote(note), canDrag: (note: NoteListItem) => !phone && noteFocus.editable && note.notebookId === selectedNotebookId, rowMeta: !phone && presentation === 'list', openPath: activeNotePath, readNote: readNoteForChange } : undefined;
  // A phone's list screen beside a Focus shows the folders under the list, and the chips of the filters in force where the filters are out of sight.
  const layout = phoneBrowseLayout({ phone, focusShown: activeTab === 'notes' && !route.study && Boolean(noteFocus.layout) && !focusEmpty, viewMode });
  /** Whether the folders show beside the list (the notebooks column, or a phone's folders under its list), so the list keeps only the folder's index. */
  const folderTree = !phone || Boolean(layout.split);
  const openFilters = () => setPhoneFilterOpen(true);
  // An outline or compilation list offers its own kind; every kind starts at the notebook root, moved from its editor.
  const newKind = route.kind === 'outline' || route.kind === 'compilation' ? route.kind : 'note';
  const createNewKind = () => {
    if (newKind === 'outline') void createNote({ kind: 'outline' });
    else if (newKind === 'compilation') void createUntitledCompilation();
    else void createNote();
  };
  // The index names its folder, or the notebook at its root, so it reads as that folder's page rather than a note called "Index".
  const indexFolderName = selectedFolder ? breadcrumbs[breadcrumbs.length - 1].name : config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title ?? '';
  // Held here, not in the list, so a folder stays collapsed when switching views.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups(previous => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const noteGroupOf = useMemo(() => groupedByFolder ? noteFolderGrouping({ notebookRoot: folderRoot ?? '', selectedFolder, folders, notebookId: selectedNotebookId, selectedLabel: indexFolderName }) : undefined, [groupedByFolder, folderRoot, selectedFolder, folders, selectedNotebookId, indexFolderName]);
  const browseRegion = () => (
    <>
      {layout.chips === 'list' && <FilterChips filters={filterProps} onAdd={openFilters} />}
      <LegacySchemaNotice schemaVersion={config?.schema_version} />
      {actionError && <p role='alert' className='mb-3 text-sm text-danger'>{actionError}</p>}
      {selectedNotes.length > 0 && <BulkActionsToolbar count={selectedNotes.length} statuses={notebookStatuses} availableTags={availableTags} busy={bulkBusy} readOnly={!canWriteFiles} canMove={Boolean(bulkMoveNotebookId)} liveNotes={selectedNotes.filter(note => liveActionLocked(note, 'other', liveDrafts)).map(note => note.title || note.path)} liveMovable={selectedNotes.every(note => !liveActionLocked(note, 'move', liveDrafts))} onSetStatus={status => void runBulkStatus(status)} onAddTag={tag => void runBulkTag('add', tag)} onRemoveTag={tag => void runBulkTag('remove', tag)} onMove={() => setBulkMoveOpen(true)} onClear={clearSelection} />}
      {staleNotice && <p role='alert' className='mb-3 text-sm text-warning'>{staleNotice}</p>}
      {listResult.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: listResult.error })}</p>}
      {facetsQuery.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.countsFailed', { message: facetsQuery.error })}</p>}
      {indexLookup.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: indexLookup.error })}</p>}
      {listResult.loading && <LoadingStatus className='mb-3 text-sm text-muted'>{t('notes.loading')}</LoadingStatus>}
      {/* Beside the folder tree the path line names the folder and its subfolders are in the tree; only the folder's index stays. */}
      {!folderless && folderTree && viewMode === 'list' && folderIndex && <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} />}
      {!folderless && !folderTree && (
        <>
          <Breadcrumbs segments={breadcrumbs} currentFolder={selectedFolder} onSelectFolder={setSelectedFolder} subfolderCount={immediateSubfolders.length} noteCount={listResult.total} />
          <FolderLinks folders={immediateSubfolders} onSelect={setSelectedFolder}>{folderIndex && <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} />}</FolderLinks>
        </>
      )}
      {(viewMode === 'list' || viewMode === 'flat') && (
        <>
          <FocusNoteList focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} loading={listResult.loading} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={canWriteFiles ? note => noteMove.moveNote(note)?.() : undefined} onUpdateNoteStatus={handleUpdateNoteStatus} newKind={newKind} onNewNote={createNewKind} leading={viewMode === 'flat' && folderIndex ? <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} /> : undefined} highlightQuery={highlightQuery} selectedKeys={selectedKeys} onToggleSelect={toggleSelect} groupOf={noteGroupOf} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} />
          <NoteListSentinel hasMore={listResult.hasMore} loading={listResult.loadingMore} error={listResult.error} onLoadMore={listResult.loadMore} />
        </>
      )}
      {viewMode === 'kanban' && (
        <KanbanView
          focusMode={browseFocusMode}
          statuses={notebookStatuses}
          readOnly={!canWrite}
          canDelete={canWrite}
          confirmDelete={remote}
          query={baseQuery}
          hiddenNote={folderIndex}
          leading={folderIndex
            ? <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} />
            : undefined}
          onOpenNote={note => void openFromBrowse(note)}
          onUpdateNoteStatus={handleUpdateNoteStatus}
          onDeleteNote={handleDeleteNote}
          onMoveNote={canWriteFiles
            ? note => noteMove.moveNote(note)?.()
            : undefined}
          onNewNoteWithStatus={(status) => {
            void createNote(status);
          }}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
          metadataSortFields={metadataSortFields}
          selectedKeys={selectedKeys}
          onToggleSelect={toggleSelect}
        />
      )}
    </>
  );
  // The toolbar search dims what the Focus shows that it does not match; on a phone it only filters the list.
  const focusMatches = useFocusSearch({ q: debouncedSearch, notebookId: selectedNotebookId, enabled: Boolean(noteFocus.layout) && !phone });
  const compilationActions = useCompilationActionsValue({ remote, canWriteNotebook, repositoryId: notebookId => repositoryFor(notebookId)?.id, revisionFor, save: handleSaveNote, remove: handleDeleteNote, stageWorkingNote, invalidateNotes, setGitStatus, createNote: options => void createNote(options) });
  const createCompilation = async (row: CompilationRow) => {
    const notebook = config?.notebooks.find(nb => nb.id === row.notebookId);
    if (!notebook) return;
    try {
      const plan = await planNewCompilation(row, notebook, '', UNTITLED_STEM, initialCompilationStatus(config?.notebooks || [], notebook.id, facetsQuery.facets));
      void openFromBrowse(await compilationActions.create(notebook.id, plan.path, plan.content, plan.metadata));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  // A new compilation starts empty, named Untitled, at the notebook root; its menu edits, renames and moves it.
  const createUntitledCompilation = () => createCompilation({ id: crypto.randomUUID(), name: t('compilation.untitled'), notebookId: selectedNotebookId, path: '', view: 'small', kind: 'custom', items: [] });
  const openCompilationFolder = (item: { notebookId: string; path: string; }) => {
    // A folder of this notebook filters the browse region and keeps the Focus; others open as they do elsewhere.
    const notebook = config?.notebooks.find(nb => nb.id === item.notebookId);
    if (item.notebookId !== selectedNotebookId || !notebook || !folderRoot) return false;
    const assetRoot = `${folderRoot}/${notebook.assets || 'assets'}`;
    if (item.path === assetRoot || item.path.startsWith(`${assetRoot}/`)) return false;
    if (item.path !== folderRoot && !item.path.startsWith(`${folderRoot}/`)) return false;
    setSelectedFolder(item.path === folderRoot ? null : item.path.slice(folderRoot.length + 1));
    return true;
  };
  /** The compilation at `path` of the selected notebook, in a Focus pane (`pane`) or in zoom. */
  const renderCompilation = (path: string, pane?: string) => (
    <CompilationView
      key={`${selectedNotebookId}:${path}`}
      notebookId={selectedNotebookId}
      path={path}
      notebooks={config?.notebooks || []}
      folders={folders}
      frame={pane === undefined ? 'zoom' : 'pane'}
      // A card in a Focus pane opens its note in another pane (splitting when there is only one); in zoom, or when the Focus cannot take it, it opens in zoom.
      // A heading-anchored item always opens in zoom, scrolled to its heading.
      onOpenNote={(note, anchor) => void (async () => {
        if (anchor || pane === undefined || !await openInFocus(note, pane, 'beside')) await handleOpenNote(note, anchor);
      })()}
      onOpenFolder={openCompilationFolder}
      onClose={pane === undefined ? closeCompilationZoom : undefined}
    />
  );

  // A note opened from a zoomed compilation leaves that compilation mounted behind it.
  const behindPath = trailCompilation(location.state, editorRoute.notebook, config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root ?? '');
  const compilationBehind = behindPath ? { notebookId: selectedNotebookId, path: behindPath } : null;
  /** A phone's list screen beside a Focus: the path line and the list, and below the divider the notebook's folders. */
  const browseSplit = () => {
    const path = browsePath({ kind: route.kind, notebookTitle: selectedNotebook?.title ?? '', breadcrumbs, labels: { outline: t('outline.list'), compilations: t('sidebar.compilations') } });
    const count = filterProps.count;
    return (
      <BrowseSplit
        label={t('browseSplit.folders')}
        filters={renderSidebar(false, 'folders')}
        path={
          <>
            <Tooltip label={path}>
              <span className='browse-split-path-text'>{path}</span>
            </Tooltip>
            {count === null ? <LoadingStatus as='span' className='browse-split-count'>{t('notes.countsLoading')}</LoadingStatus> : <span className='browse-split-count'>{t(count === 1 ? 'folder.noteCount' : 'folder.notesCount', { count })}</span>}
          </>
        }
        size={noteFocus.view.dock.filtersShare}
        onSizeChange={filtersShare => noteFocus.setDock({ filtersShare })}
        collapsed={noteFocus.view.dock.splitCollapsed}
        onCollapsedChange={splitCollapsed => noteFocus.setDock({ splitCollapsed })}
      >
        {browseRegion()}
      </BrowseSplit>
    );
  };
  const beforeFolderChange = (command: FolderCommand) => beforeFileChange(folderCommandScope(command, config?.notebooks.find(nb => nb.id === command.notebookId)?.root ?? ''));
  const onFoldersChanged = async () => {
    await refreshWorkspace(remote);
    await refreshDocuments();
  };
  const dropNoteOnFolder = (note: DraggedNote, folder: string | null) => void noteMove.moveTo({ ...note, title: '' }, folder);
  /** A phone's drawer of notebooks and filters; its filter sheet shows only the status and tags, and its list screen beside a Focus the folders. */
  const renderSidebar = (filtersOnly = false, dock?: 'folders') => <Sidebar selectedNotebookId={selectedNotebookId} folders={folders} foldersLoading={foldersLoading} onManageFiles={openFileManager} foldersWritable={canWriteFiles} filters={filterProps} facets={facetsQuery.facets} facetsLoading={facetsQuery.loading} facetsError={facetsQuery.error} workspaceTagNames={workspaceTagNames} beforeFolderChange={beforeFolderChange} onFoldersChanged={onFoldersChanged} selectedFolder={selectedFolder} onSelectFolder={setSelectedFolder} onDropNote={dropNoteOnFolder} canManageTags={canWriteFiles} onPreviewTagUsage={previewTagUsage} onRenameTag={handleRenameTag} onMergeTag={handleMergeTag} onDeleteTag={handleDeleteTag} filtersOnly={filtersOnly} dock={dock} />;

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;
  if (route.legacyScreen) return <LegacyScreenRedirect laneId={route.legacyLane} notebooks={config?.notebooks || []} onMissing={setActionError} />;

  // The Notes page's Focus controls and New button sit in the header, which stays whatever the columns fold, so each is mounted once (the Focus
  // dialogs live in its controls).
  const notesActions = !notebookUnavailable && activeTab === 'notes' && !route.study && !phone;
  const focusControls = notesActions ? <FocusControls splittable={focusCapacity === 'all'} focus={noteFocus} onShow={key => void showFocus(key)} onRequestClear={requestClear} confirmingClear={confirmingClear} onConfirmingClearChange={setConfirmingClear} onReload={() => void focusPage.reload()} browseToggle={focusCapacity === 1 ? { showing: focusNarrowView === 'browse', onToggle: () => setFocusNarrowView(view => view === 'browse' ? 'focus' : 'browse') } : undefined} /> : undefined;
  // A read-only notebook shows neither the New button nor its menu.
  const newNote: NewNoteActions | undefined = notesActions && canWrite ? { onNewNote: () => void createNote(), onNewOutline: () => void createNote({ kind: 'outline' }), onNewCompilation: () => void createUntitledCompilation(), templates: [...notebookTemplates.templates.map(template => ({ id: template.id, title: template.name })), ...builtinNoteTemplates(t)], onManageTemplates: selectedNotebook ? () => setManageTemplatesOpen(true) : undefined, onNewFromTemplate: templateId => void createNote({ templateId }), onImportLegacy: legacyImportOffered(repositoryFor(selectedNotebookId)) ? () => setLegacyImportOpen(true) : undefined } : undefined;
  const refreshAfterSync = async () => {
    await refreshWorkspace();
    await refreshDocuments().catch(error => setActionError(error instanceof Error ? error.message : String(error)));
  };
  const focusArea = <FocusArea focus={noteFocus} capacity={focusCapacity} notebookRoot={folderRoot ?? ''} notebook={selectedNotebook} folders={folders} renderCompilation={renderCompilation} searchMatches={focusMatches} onZoomNote={zoomFocusNote} documentPanel={focusDocumentPanel} />;
  // Column 1: every notebook, the open one unfolded into its folders, outlines and compilations, or the rail of their initials.
  const notebookColumn = <NotebookColumn mode={columns.layout.notebooks} columnId={NOTEBOOK_COLUMN_ID} notebooks={config?.notebooks || []} groups={notebookGroups} unavailableNotebooks={unavailableNotebooks} selectedNotebookId={selectedNotebookId} onSelectNotebook={id => void setSelectedNotebookId(id)} switchDisabled={loading || resourceNavigationBusy || notebookSwitchBusy} counts={facetsQuery.facets ? Object.fromEntries(Object.entries(facetsQuery.facets).map(([id, facet]) => [id, facet.total])) : undefined} current={selectedNotebook && <NotebookTree notebook={selectedNotebook} filters={filterProps} facets={facetsQuery.facets} folders={folders} foldersLoading={foldersLoading} foldersWritable={canWriteFiles} selectedFolder={selectedFolder} onSelectFolder={setSelectedFolder} onManageFiles={openFileManager} beforeFolderChange={beforeFolderChange} onFoldersChanged={onFoldersChanged} onDropNote={dropNoteOnFolder} expanded={foldedTree !== selectedNotebookId} onToggleExpanded={() => setFoldedTree(folded => folded === selectedNotebookId ? null : selectedNotebookId)} onContextMenu={event => notebookAppearance.onContextMenu(event, selectedNotebookId)} />} query={searchQuery} onQueryChange={value => changeFilters({ q: value })} searchRef={notesColumns ? noteSearch : undefined} onOpenSearch={focusNoteSearch} kind={route.kind} onSelectKind={kind => changeFilters({ kind, folders: [] })} onNotebookContextMenu={notebookAppearance.onContextMenu} />;
  // Column 2: where the list is, its view switch and fold toggle, the Status, Tags and Sort buttons, and the list or board.
  const listPath = route.kind === 'outline' ? [t('outline.list')] : route.kind === 'compilation' ? [t('sidebar.compilations')] : breadcrumbs.filter(segment => segment.path !== null).map(segment => segment.name);
  // The root choice is named after the notebook: beside the rail the picker stands for the whole path.
  const folderChoices: FolderChoice[] = [{ value: '', label: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title ?? t('browse.allFolders') }, ...folders.filter(folder => folder.notebookId === selectedNotebookId).map(folder => ({ value: folder.path, label: folder.path })).sort((a, b) => a.value.localeCompare(b.value))];
  const listColumn = (
    <NoteListColumn
      columnId={LIST_COLUMN_ID}
      notebookTitle={selectedNotebook?.title ?? ''}
      notebook={selectedNotebook}
      path={listPath}
      count={filterProps.count}
      presentation={presentation}
      onPresentationChange={next => { if (next !== presentation) setViewMode(next === 'kanban' ? 'kanban' : 'flat'); }}
      onCollapse={presentation === 'list' ? columns.toggleList : undefined}
      // Folded to its rail, the notebooks column leaves the folder to the path's menu.
      folderMenu={columns.layout.notebooks !== 'open' && route.kind === 'note'
        ? { folders: folderChoices, value: selectedFolder ?? '', onChange: folder => setSelectedFolder(folder || null) }
        : undefined}
      chips={
        <ListFilterButtons
          filters={filterProps}
          counts={listFacets(filterProps, facetsQuery.facets)}
          notebookId={selectedNotebookId}
          tagManagement={canWriteFiles ? { workspaceTagNames, onPreviewUsage: previewTagUsage, onRename: handleRenameTag, onMerge: handleMergeTag, onDelete: handleDeleteTag } : undefined}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
          metadataSortFields={metadataSortFields}
          sortable={presentation !== 'kanban'}
          showHidden={showHidden}
          hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null}
          onShowHiddenChange={value => changeFilters({ showHidden: value })}
          groupByFolder={groupable ? { value: route.groupByFolder, onChange: setGroupByFolder } : undefined}
          subfolders={presentation !== 'kanban' && route.kind === 'note'
            ? { value: viewMode !== 'list', onChange: value => setViewMode(value ? 'flat' : 'list') }
            : undefined}
        />
      }
    >
      {browseRegion()}
    </NoteListColumn>
  );
  // At the note's top left while the list is folded away: the list back. The notebooks column has its own toggle, left of the logo.
  const restoreLabel = t('browse.expandList');
  const restoreColumns = (
    <>
      <Tooltip label={restoreLabel}>
        <button type='button' className='ui-icon-button browse-column-toggle' data-column-toggle='' aria-label={restoreLabel} aria-expanded='false' aria-controls={LIST_COLUMN_ID} onClick={columns.toggleList}>
          <PanelLeft size={16} aria-hidden='true' />
        </button>
      </Tooltip>
      <FoldedNoteDots notes={[...listResult.uncommitted, ...displayedNotes]} openPath={activeNotePath} onOpenNote={note => void openFromBrowse(note)} />
    </>
  );

  const content = (
    <CompilationActionsProvider value={compilationActions}>
      <LiveDraftsProvider value={liveDrafts}>
        <WorkspaceLinks notebooks={config?.notebooks || []} folders={folders} onOpenNote={(note, anchor, source) => void openLink(note, anchor, source)}>
          <NoteLocationProvider locate={locateNote}>
            <NoteEditingProvider register={editorRegistry.register} editorProps={editorProps} flushEditors={editorRegistry.flushEditors} refreshNotes={refreshNotes} closeZoom={closeZoom} addToFocus={addToFocus} moveNote={noteMove.moveNote} renameNote={noteMove.renameNote} renameNoteTo={noteMove.renameNoteTo}>
              <div className='app-shell h-dvh min-w-0 flex-1 overflow-hidden flex flex-col font-sans transition-colors duration-200' data-workspace-tab={activeTab} data-screen-focus={Boolean(route.study)} style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
                {/* Core Branch User Guidance Banner (Theme-aware, harmonized with active palette) */}
                {!remote && defaultRepositoryBranch === 'core' && (
                  <div className='shrink-0 flex-none px-4 py-2 text-xs flex items-center justify-between font-medium border-b transition-colors' style={{ backgroundColor: 'var(--color-sidebar)', borderColor: 'var(--color-line)', color: 'var(--color-text)' }}>
                    <div className='flex items-center gap-2.5'>
                      <AlertTriangle className='w-4 h-4 text-warning shrink-0' />
                      <span className='px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-on-primary shrink-0 shadow-xs' style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>{t('nav.coreBaseline')}</span>
                      <span className='text-muted'>{t('nav.coreBanner')}</span>
                    </div>
                  </div>
                )}
                {(legacyRecovery.recoveries.length > 0 || legacyRecovery.error) && (
                  <div role='alert' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
                    <span>{legacyRecovery.error || t('legacyOutline.notice')}</span>
                    <Button onClick={() => setLegacyImportOpen(true)}>{t('legacyOutline.recovery')}</Button>
                  </div>
                )}
                <DemoBanner />
                {defaultRepository?.manifest === 'derived' && defaultRepository.config && <DerivedManifestNotice repository={defaultRepository.id} config={defaultRepository.config} configRevision={defaultRepository.configRevision} canWrite={manifestWritable} onCreated={() => refreshWorkspace(true)} />}
                {/* Top Header */}
                <Header unavailableNotebooks={unavailableNotebooks} workspaceTitle={currentRepository?.title || 'MyGitNotes'} notebookGroups={notebookGroups} accountControls={<AccountControls local={!remote} />} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} onSelectNotebook={id => void setSelectedNotebookId(id)} notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy} activeTab={activeTab} setActiveTab={setActiveTab} onCreateNote={canWrite ? () => void createNote() : undefined} onOpenCommands={() => setShortcutMode('palette')} navigationDisabled={noteEditorOpen || isCommitOpen} navOnly={phoneNotes} focusControls={focusControls} newNote={newNote} notebooksToggle={notesColumns ? { open: columns.layout.notebooks === 'open', controls: NOTEBOOK_COLUMN_ID, onToggle: columns.toggleNotebooks } : undefined} />
                <KeyboardShortcuts mode={shortcutMode} onModeChange={setShortcutMode} suspended={isCommitOpen} selectedNotebookId={selectedNotebookId} onOpenNote={note => void handleOpenNote(note)} />
                {routeError && (
                  <div role='alert' className='px-6 py-3 text-sm text-danger'>
                    {routeError.startsWith('route.') ? t(routeError as any) : routeError} <button className='underline' onClick={() => navigate('/notes')}>{t('route.goToNotes')}</button>
                  </div>
                )}
                {/* Main Workspace Layout */}
                <SidebarProvider open={filtersOpen} onOpenChange={setFiltersOpen}>
                  <div ref={sidebarGestureRef} className='workspace-body relative flex-1 min-h-0 min-w-0 flex overflow-hidden'>
                    <WorkspaceSplitLayout
                      hasSidebar={activeTab !== 'graph' && !route.study && !notesColumns}
                      sidebarDomId={activeTab === 'notes' ? 'notebook-panel' : activeTab === 'agent' ? 'agent-sidebar-panel' : activeTab === 'assets' ? 'assets-sidebar-panel' : activeTab === 'settings' ? 'settings-sidebar-panel' : undefined}
                      closeLabel={t('sidebar.closeFilters')}
                      rightPanelWidth={rightPanelWidth}
                      assistant={
                        <>
                          <TypstPreviewDock />
                          <AssistantDock onOpenAgents={() => setActiveTab('agent')} agentsDisabled={noteEditorOpen || isCommitOpen} swipe={(activeTab === 'notes' && !filtersOpen) || noteEditorOpen} />
                        </>
                      }
                      rightPanel={
                        <RightPanel
                          phoneSheet={phoneNotes}
                          documentPanel={activeTab === 'notes' && noteFocus.layout ? { enabled: activePaneNote, onContainer: setDocumentContainer } : undefined}
                          fileMode={activeTab === 'assets'}
                          metadataOpen={fileMetadataOpen}
                          onMetadataOpenChange={setFileMetadataOpen}
                          fileMetadata={selectedFileEntry
                            ? (
                              <FileMetadata
                                entry={selectedFileEntry}
                                onEdit={canWriteFiles && !resourceNavigationBusy
                                  ? () => void fileManagerRef.current?.editMetadata()
                                  : undefined}
                              />
                            )
                            : undefined}
                          onFileMetadataContainer={setFileMetadataContainer}
                          notebooks={config?.notebooks || []}
                          selectedNotebookId={selectedNotebookId}
                          currentFolder={selectedFolder && notebookRoot ? `${notebookRoot}/${selectedFolder}` : undefined}
                          onOpenNote={handleOpenNote}
                          onSaveNote={handleSaveNote}
                          onReadNote={readNoteForChange}
                          gitStatus={gitStatus}
                          changeCount={remote ? changeCount - remoteTrash.length : changeCount}
                          deletedNotes={remote ? remoteTrash : deletedNotes}
                          onRestoreNote={remote
                            ? note => updateDraft(note.notebookId, note.path, null)
                            : handleRestoreNote}
                          onOpenCommitModal={openCommitModal}
                          writable={canWrite}
                          remoteChanges={panelRemoteChanges}
                          getPreview={panelGetPreview}
                          onSynced={remote ? undefined : refreshAfterSync}
                          repositoryHeading={repositoryHeading}
                          repoRoot={repoRoot}
                          onWidthChange={setRightPanelWidth}
                        />
                      }
                    >
                      {notebookUnavailable && ['notes', 'assets', 'graph'].includes(activeTab) && (
                        <main className='workspace-route notebook-unavailable'>
                          <section role='alert' className='notebook-unavailable-card'>
                            <AlertCircle aria-hidden='true' />
                            <div>
                              <h2>{t('notebook.unavailableTitle', { title: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title ?? selectedNotebookId })}</h2>
                              <p>{t(`notebook.unavailable.${notebookUnavailable.reason}`)}</p>
                              <p className='notebook-unavailable-detail'>{notebookUnavailable.message}</p>
                            </div>
                          </section>
                        </main>
                      )}
                      {!notebookUnavailable && activeTab === 'notes' && !route.study && (phone
                        ? (
                          <>
                            <WorkspaceSidebarPortal>
                              <HeaderUtilities className='phone-drawer-utilities' activeTab={activeTab} setActiveTab={setActiveTab} navigationDisabled={noteEditorOpen || isCommitOpen} onOpenCommands={() => setShortcutMode('palette')} accountControls={<AccountControls local={!remote} />} /> {renderSidebar()}
                            </WorkspaceSidebarPortal>
                            {/* A phone's list and note take turns filling the screen, each with its own bars. */}
                            <main className='workspace-main notes-main'>
                              {!phoneNoteScreen && (
                                <>
                                  <PhoneListBar
                                    searchRef={noteSearch}
                                    notebooks={config?.notebooks || []}
                                    selectedNotebookId={selectedNotebookId}
                                    onSelectNotebook={id => void setSelectedNotebookId(id)}
                                    notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy}
                                    unavailableNotebooks={unavailableNotebooks}
                                    notebookGroups={notebookGroups}
                                    query={searchQuery}
                                    onQueryChange={value => changeFilters({ q: value })}
                                    filtersOpen={filtersOpen}
                                    onToggleFilters={() => setFiltersOpen(open => !open)}
                                  />
                                  {layout.chips === 'bar' && <FilterChips filters={filterProps} onAdd={openFilters} />}
                                </>
                              )}
                              {noteFocus.layout && !focusEmpty ? <div className='phone-notes-screen'>{phoneNoteScreen ? <div className='phone-notes-focus'>{focusArea}</div> : <div className='workspace-scroll phone-notes-scroll'>{layout.split ? browseSplit() : browseRegion()}</div>}</div> : <div className='workspace-scroll'>{browseRegion()}</div>}
                            </main>
                          </>
                        )
                        : (
                          <main className='workspace-main notes-main'>
                            <BrowseColumns layout={columns.layout} measure={columns.measure} presentation={presentation} focusOpen={Boolean(noteFocus.layout) && !focusEmpty} notebooks={notebookColumn} list={listColumn} note={noteFocus.layout ? focusArea : <p className='browse-note-empty'>{t('browse.noFocus')}</p>} restore={restoreColumns} />
                          </main>
                        ))}
                      {activeTab === 'agent' && (
                        <main className='workspace-route agent-main'>
                          <AgentSystemView ref={agentSystemRef} notebooks={config?.notebooks || []} folders={folders} repositories={repositories} defaultRepository={sourceId} onBusyChange={setResourceNavigationBusy} remote={remote} onGitStatus={setGitStatus} />
                        </main>
                      )}
                      {!notebookUnavailable && activeTab === 'assets' && (
                        <main className='workspace-route assets-main has-sidebar-drawer'>
                          <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} onNotebookChange={id => void setSelectedNotebookId(id)} writable={canWriteFiles} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer} onShowMetadata={() => setFileMetadataOpen(true)} initialPath={new URLSearchParams(location.search).get('asset') || (new URLSearchParams(location.search).has('directory') ? `${folderRoot}/${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.assets || 'assets'}${new URLSearchParams(location.search).get('directory') ? '/' + new URLSearchParams(location.search).get('directory') : ''}` : undefined)} onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
                        </main>
                      )}
                      {!notebookUnavailable && activeTab === 'notes' && route.study && (
                        <React.Suspense fallback={<LoadingStatus className='p-8'>{t('screen.loading')}</LoadingStatus>}>
                          <CompilationStudy
                            key={`${selectedNotebookId}:${route.study}`}
                            notebooks={config?.notebooks || []}
                            folders={folders}
                            notebookId={selectedNotebookId}
                            path={route.study}
                            onStudySaved={() => {
                              if (remote) void refreshWorkspace(true);
                              else invalidateNotes();
                              void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError((error as Error).message));
                            }}
                            onOpenNote={handleOpenNote}
                            onBack={() => {
                              const notebook = config?.notebooks.find(nb => nb.id === selectedNotebookId);
                              navigate(notebook ? noteRoute(notebook.id, route.study!.slice(notebook.root.length + 1)) : '/notes');
                            }}
                          />
                        </React.Suspense>
                      )}
                      {!notebookUnavailable && activeTab === 'graph' && (
                        <main className='workspace-route graph-main flex-1 w-full h-full relative min-h-0'>
                          <React.Suspense fallback={<p role='status' className='p-8'>{t('graph.title')}</p>}>
                            <NotebookGraphPage key={remote ? sourceId : repoRoot} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} filters={filterProps} folders={folders} />
                          </React.Suspense>
                        </main>
                      )}
                      {activeTab === 'settings' && (
                        <main className='workspace-route settings-main has-sidebar-drawer'>
                          <SettingsModal manifest={{ repositories, defaultRepository: sourceId, initialRepository: repositoryFor(selectedNotebookId)?.id ?? sourceId, onManifestRevision: setManifestRevision }} repositories={{ repositories, onMembershipChanged: membershipChanged, onOpenChanges: () => openCommitModal() }} recovery={nothingToShow} local={!remote} coreUpdates={coreUpdate} accountSettings={<AgentAccessSettings local={!remote} />} repositoryChoice={repositoryChoice && defaultRepository?.repository ? <RepositorySwitch repository={defaultRepository.repository} branch={defaultRepositoryBranch} /> : undefined} onRefreshWorkspace={refreshWorkspace} currentTheme={currentTheme} onSelectTheme={handleSelectTheme} />
                        </main>
                      )}
                    </WorkspaceSplitLayout>
                  </div>
                </SidebarProvider>
                {/* Undo Toast Notification */}
                {undoToast && (
                  <div className='fixed top-20 right-6 z-50 animate-in fade-in slide-in-from-top-3 duration-200'>
                    <div className='ui-glass text-fg px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs'>
                      <span>{t('toast.noteMovedToTrash', { title: undoToast.note.title })}</span>
                      <button onClick={() => handleRestoreNote(undoToast.note)} className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition'>{t('common.undo')}</button>
                      <button onClick={() => setUndoToast(null)} className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1'>
                        <X className='w-3.5 h-3.5' />
                      </button>
                    </div>
                  </div>
                )}
                {
                  /* Recent tag operations: session-lifetime, each independently undoable (the list itself
          is not cleared by navigation or further mutations, only by page reload). Undoing a
          record unconditionally restores its recorded prior tags on every note it touched; it
          does not detect or warn about a later edit to the same note's tags in the meantime. */
                }
                {tagOperations.history.length > 0 && (
                  <section className='fixed top-28 sm:top-auto sm:bottom-6 right-4 sm:right-16 left-4 sm:left-auto z-50 flex flex-col gap-2 items-end' aria-label={t('sidebar.recentTagChanges')}>
                    {tagOperations.history.map(record => (
                      <div key={record.id} className='ui-glass text-fg px-4 py-3 rounded-xl shadow-xl border border-line/80 flex items-center gap-3 text-xs max-w-sm'>
                        <span>{t(record.label.key, record.label.params)}</span>
                        <button
                          autoFocus
                          onClick={() => void handleUndoTagOperation(record.id)}
                          className='px-2.5 py-1 bg-warning hover:bg-warning/90 active:scale-95 text-on-warning font-semibold rounded-md transition shrink-0'
                        >
                          {t('common.undo')}
                        </button>
                        <button
                          aria-label={t('sidebar.dismissTagOperation')}
                          onClick={() => tagOperations.dismiss(record.id)}
                          className='text-muted hover:text-fg p-1 rounded hover:bg-fg/10 transition ml-1 shrink-0'
                        >
                          <X className='w-3.5 h-3.5' />
                        </button>
                      </div>
                    ))}
                  </section>
                )}
                {notebookAppearance.element}
                {fileDialog && <FileManagerDialog notebookId={fileDialog.notebookId} notebooks={config?.notebooks || []} writable={canWriteFiles} initialPath={fileDialog.path} movePath={fileDialog.movePath} initialOperation={fileDialog.initialOperation} showDocuments={fileDialog.showDocuments} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} onClose={() => setFileDialog(undefined)} />}
                {noteMove.request?.mode === 'move' && movingNotebook && <FolderPickerDialog notebooks={[movingNotebook]} folders={folders} title={t('files.moveNoteTitle', { title: noteMove.request.note.title || noteMove.request.note.path.split('/').pop() || '' })} initial={{ notebookId: movingNotebook.id, folder: noteMove.request.note.live?.pending ? liveDestinationFolder(noteMove.request.note.live) : noteFolder(noteMove.request.note.path, movingNotebook.root) }} confirmLabel={t('bulk.moveConfirm')} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={({ folder }) => void noteMove.confirmMove(folder)}>{noteMove.request.note.live?.pending && <p className='text-xs text-muted'>{t('live.collisionNote')}</p>}</FolderPickerDialog>}
                {livePathRequest && (
                  <LiveNewNoteDialog
                    template={livePathRequest.template}
                    prompts={livePathRequest.prompts}
                    onConfirm={values => {
                      livePathRequest.answer(values);
                      setLivePathRequest(null);
                    }}
                    onCancel={() => {
                      livePathRequest.answer(null);
                      setLivePathRequest(null);
                    }}
                  />
                )}
                {manageTemplatesOpen && selectedNotebook && <ManageTemplatesDialog notebookTitle={selectedNotebook.title} templates={notebookTemplates.templates} builtin={builtinNoteTemplates(t)} loading={notebookTemplates.loading} error={notebookTemplates.error} readOnly={!canWrite} fileActions={canWriteFiles} onCreate={name => templateActions.createTemplate(selectedNotebook.id, name)} onEdit={templateActions.editTemplate} onRename={templateActions.renameTemplate} onDelete={templateActions.deleteTemplate} onClose={() => setManageTemplatesOpen(false)} />}
                {noteMove.request?.mode === 'rename' && <RenameNoteDialog path={noteMove.request.note.path} title={noteMove.request.note.title} initial={noteMove.request.name} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={title => void noteMove.confirmRename(title)} />}
                {bulkMoveOpen && bulkMoveNotebook && (
                  <FolderPickerDialog
                    notebooks={[bulkMoveNotebook]}
                    folders={folders}
                    title={t('bulk.moveDialogTitle', { count: selectedNotes.length })}
                    initial={{ notebookId: bulkMoveNotebook.id, folder: null }}
                    confirmLabel={t('bulk.moveConfirm')}
                    busy={bulkBusy}
                    onClose={() => setBulkMoveOpen(false)}
                    onConfirm={({ folder }) => {
                      setBulkMoveOpen(false);
                      void runBulkMove(bulkMoveNotebook.id, folder);
                    }}
                  />
                )}
                {/* Note Editor Modal */}
                <EditorModal key={fileEditorRevision} note={routedNote} committed={routedCommitted && typeof routedCommitted.content === 'string' ? routedCommitted as NoteItem : undefined} loading={routedLoading} isOpen={noteEditorOpen} renderCompilation={renderCompilation} behind={compilationBehind} error={actionError} />
                {phoneNotes && phoneFilterOpen && <PhoneFilterSheet onClose={() => setPhoneFilterOpen(false)} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} metadataSortFields={metadataSortFields} viewMode={viewMode} setViewMode={setViewMode} showHidden={showHidden} hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null} onShowHiddenChange={value => changeFilters({ showHidden: value })} groupByFolder={groupable ? { value: route.groupByFolder, onChange: setGroupByFolder } : undefined}>{renderSidebar(true)}</PhoneFilterSheet>}
                {addingToFocus && (
                  <AddToFocusDialog
                    focus={noteFocus}
                    tab={addingToFocus.tab}
                    label={addingToFocus.label}
                    onClose={() => setAddingToFocus(null)}
                    onPlaced={addingToFocus.tab.kind === 'note'
                      ? target => {
                        setEditingNote(null);
                        setFocusNarrowView('focus');
                        navigate(`${notebookRoute(selectedNotebookId)}?${new URLSearchParams({ focus: target })}`, { replace: true });
                      }
                      : undefined}
                  />
                )}
                {/* Commit Modal */}
                <CommitModal
                  writable={repositories.some(editable)}
                  remoteChanges={panelRemoteChanges}
                  getPreview={panelGetPreview}
                  describeChanges={panelDescribeChanges}
                  request={commitRequest}
                  restoreFile={remote
                    ? async file => {
                      const pendingDocument = pendingDocuments.find(document => document.repository === file.repository && document.file === file.path);
                      if (pendingDocument) {
                        if (file.revision !== pendingDocument.diff) throw new Error('Draft changed. Review it again.');
                        discardDocumentDraft(documentClientOf(file.path)!, pendingDocument.repository);
                        const live = documents.find(document => document.file === file.path && document.repository === pendingDocument.repository);
                        if (live) await live.reload();
                        return;
                      }
                      const entry = file.repository ? readDraftIn(file.repository, file.path) : undefined;
                      if (!entry || JSON.stringify(entry) !== file.revision) throw new Error('Draft changed. Review it again.');
                      // The draft lives in this browser, so discarding it is a local delete. Reading the remote
                      // only refreshes an open editor, and a draft is often blocked precisely because that read
                      // fails, which used to leave the draft undiscardable.
                      const latest = entry.base ? await readNote(file.path).catch(() => null) : null;
                      if (JSON.stringify(readDraft(entry.note.notebookId, file.path)) !== file.revision) throw new Error('Draft changed. Review it again.');
                      updateDraft(entry.note.notebookId, file.path, null);
                      if (latest && editingNote && sameNote(editingNote, entry.note)) setEditingNote(latest);
                    }
                    : undefined}
                  commitFiles={remote ? commitWorkingNotes : undefined}
                  repositoryHeading={repositoryHeading}
                  isOpen={isCommitOpen}
                  onClose={() => setIsCommitOpen(false)}
                  gitStatus={gitStatus}
                  onChanged={async () => {
                    await refreshWorkspace();
                    if (!remote) {
                      await refreshDocuments();
                      await agentSystemRef.current?.refresh();
                    }
                  }}
                  onCommitted={async () => {
                    // Another server instance may still cache the head from before this commit.
                    await refreshWorkspace(true);
                    if (!remote) {
                      await refreshDocuments();
                      await agentSystemRef.current?.refresh();
                    }
                    setDeletedNotes([]);
                    setUndoToast(null);
                  }}
                />
                {/* Create New Note Modal */}
              </div>
              {gistConfirmDialog}
              <ImageLightbox />
              {outlineActions.dialog && <AddToOutlineDialog key={outlineActions.dialog.id} source={outlineActions.dialog.source} busy={outlineActions.busy} error={outlineActions.error} onChoose={outlineActions.choose} onClose={outlineActions.cancel} />}
              {legacyImportOpen && (
                <LegacyOutlineDialog
                  repositories={repositories}
                  notebooks={config?.notebooks ?? []}
                  recoveries={legacyRecovery.recoveries}
                  recoveryError={legacyRecovery.error}
                  onRecoveryChanged={legacyRecovery.refresh}
                  onClose={() => setLegacyImportOpen(false)}
                  onCreated={async ref => {
                    await refreshWorkspace(true);
                    await refreshNotes();
                    const note = await readNote(ref.path, ref.notebookId);
                    if (!await handleOpenNote(note)) throw new Error(t('legacyOutline.openFailed'));
                    setLegacyImportOpen(false);
                  }}
                />
              )}
            </NoteEditingProvider>
          </NoteLocationProvider>
        </WorkspaceLinks>
      </LiveDraftsProvider>
    </CompilationActionsProvider>
  );
  // A local workspace starts its Pi agent in the background, so the agent tab opens onto a warm session.
  return (
    <PiAgentProvider webTools={remote ? webAgentTools : undefined} enabled={agentEnabled} defaultRepository={sourceId} notebooks={config?.notebooks ?? NO_NOTEBOOKS} repositories={repositories}>
      <AgentFocusCommand />
      <OutlineActionsProvider value={outlineActions.value}>
        <StatusColorProvider statuses={statusEntries}>
          {/* The Typst preview and its citations run on this machine, so only a local workspace has them. */}
          <TypstPreviewProvider enabled={!remote && !loading}>
            <PhoneNotesProvider value={phoneNotesValue}>
              <EditorModeRouteProvider>
                <WorkspaceGitSyncProvider enabled={!remote} targets={syncTargets} onSynced={refreshAfterSync} flushEditors={editorRegistry.flushEditors} onRevealChanges={() => setFileMetadataOpen(false)}>
                  <LiveEditLinkProvider target={liveEditTarget}>{content}</LiveEditLinkProvider>
                </WorkspaceGitSyncProvider>
              </EditorModeRouteProvider>
            </PhoneNotesProvider>
          </TypstPreviewProvider>
        </StatusColorProvider>
      </OutlineActionsProvider>
    </PiAgentProvider>
  );
};

export const App: React.FC = () => {
  return (
    <I18nProvider>
      <WorkspaceGate>
        <KeyboardRoot>
          <AppContent />
        </KeyboardRoot>
      </WorkspaceGate>
    </I18nProvider>
  );
};
