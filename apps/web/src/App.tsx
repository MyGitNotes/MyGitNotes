import { useNoteSort } from './app/useNoteSort.js';
import { useOutlineActions } from './app/useOutlineActions.js';
import { AssistantDock } from './components/assistant/AssistantDock.js';
import { TypstPreviewDock } from './components/typst-preview/TypstPreviewDock.js';
import { useWebAgentTools } from './app/useWebAgentTools.js';
import { AddToOutlineDialog } from './components/AddToOutlineDialog.js';
import { useFilterSidebar } from './app/useFilterSidebar.js';
import { useTheme } from './app/useTheme.js';
import { filesInitialPath } from './app/files-initial-path.js';
import { usePhoneNotesValue } from './app/usePhoneNotesValue.js';
import { noteSheetActions } from './app/noteSheetActions.js';
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
import { liveEditLinkTarget } from './app/live-edit-link.js';
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
import { ImageLightbox } from './components/ImageLightbox.js';
import { useNavigate } from 'react-router-dom';
import { hasStoredFocusView, isEmptyFocus } from './lib/focus-view.js';
import { noteLookupOptions, useNotebookTemplates } from './lib/use-note-queries.js';
import { isTemplatePath } from './lib/note-templates.js';
import { useTemplateActions } from './app/useTemplateActions.js';
import { FOCUS_NOTE_STATE, notebookRoute, parseWorkspaceRoute } from './lib/routes.js';
import { draftScope, legacyImportOffered, pageRepository } from './lib/workspace-repositories.js';
import { demoFocusesOf, useDemoScenario } from './app/useDemoScenario.js';
import { forgetNoteDrafts } from './lib/storage.js';
import { sameValue } from './lib/merge-note.js';
import React, { useEffect, useMemo, useState } from 'react';
import { builtinNoteTemplates } from './lib/builtin-templates.js';
import type { NoteItem } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
import { useNoteSelection } from './app/useNoteSelection.js';
import { FolderPickerDialog } from './components/FolderPickerDialog.js';
import { useAssetOperations } from './app/useAssetOperations.js';
import { useRoutedNote } from './app/useRoutedNote.js';
import { followMovedNote } from './app/follow-moved-note.js';
import { noteEditorProps } from './app/note-editor-props.js';
import { useNoteSearchFocus } from './app/useNoteSearchFocus.js';
import { useCompilations } from './app/useCompilations.js';
import { useBulkToolbar } from './app/useBulkToolbar.js';
import { useNotesPage } from './app/useNotesPage.js';
import { useLiveNoteCreation } from './app/useLiveNoteCreation.js';
import { useLegacyImport } from './app/useLegacyImport.js';
import { useTemplateManager } from './app/useTemplateManager.js';
import { WorkspaceBanners } from './app/WorkspaceBanners.js';
import { WorkspaceToasts } from './app/WorkspaceToasts.js';
import { WorkspaceCommitModal } from './app/WorkspaceCommitModal.js';
import { useWorkspaceHandover } from './app/useWorkspaceHandover.js';
import { WorkspaceProviders } from './app/WorkspaceProviders.js';
import { WorkspaceRightPanel } from './app/WorkspaceRightPanel.js';
import { BoardsRoute, NotebookUnavailableRoute, StudyRoute } from './app/WorkspacePages.js';
import { boardPanelActions } from './app/board-panel-actions.js';
import { useActionErrorReset } from './app/useActionErrorReset.js';
import { useCreateNote } from './app/useCreateNote.js';
import { useBoardNoteCreation } from './app/useBoardNoteCreation.js';
import { useNoteMove } from './app/useNoteMove.js';
import { noteFolder } from './lib/note-move.js';
import { RenameNoteDialog } from './components/RenameNoteDialog.js';
import { AccountControls, AgentAccessSettings, ConnectionState } from './components/AuthControls.js';
import { Header } from './components/Header.js';
import { phoneNotesScreen } from './lib/phone-notes.js';
import { KeyboardShortcuts } from './components/KeyboardShortcuts.js';
import { KeyboardRoot } from './lib/keyboard/KeyboardDispatcher.js';
import { SidebarProvider, WorkspaceSplitLayout } from './components/WorkspaceChrome.js';
import type { NewNoteActions } from './components/NewNoteMenu.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { paneColumns, paneCount } from './lib/browse-columns.js';
import { useBoardPlacement } from './app/useBoardPlacement.js';
import { browseColumnCommands, useBrowseColumns } from './app/useBrowseColumns.js';
import { NOTEBOOK_COLUMN_ID } from './components/BrowseColumns.js';
import { useNotebookAppearance } from './components/NotebookAppearance.js';
import { EditorModal } from './components/EditorModal.js';
import { useNoteEditorRegistry } from './lib/note-editing.js';
import { FocusArea } from './components/FocusArea.js';
import { FocusControls } from './components/FocusControls.js';
import { AddToFocusDialog } from './components/AddToFocusDialog.js';
import { usePhone } from './lib/use-phone.js';
import { useFocusSearch } from './lib/focus-search.js';
import { LegacyScreenRedirect } from './components/LegacyScreenRedirect.js';
import { statusLabel } from '@mygitnotes/core/note-status';
import { FileManager, FileManagerDialog } from './components/files/index.js';
import { AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { useAgentEnabled } from './lib/web-features.js';
import { RepositorySwitch, WorkspaceGate } from './components/WorkspaceSetup.js';
import { useLeaveWarning } from './lib/use-leave-warning.js';
import { useGistConfirm } from './components/GistConfirmDialog.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { liveActionLocked, liveDestinationFolder } from './components/live/live-drafts.js';

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

  const filePanel = useFilePanel();
  const { fileDialog, setFileDialog, fileMetadataContainer, setFileMetadataOpen, rightPanelWidth, setSelectedFileEntry, fileManagerRef } = filePanel;

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const { selectedNotebookId, resolveBareNotebook, folders, foldersLoading, sourceId, remote, repositories, defaultRepository, defaultRepositoryBranch, repositoryFor, canWriteNotebook, canChangeFiles, revisionFor, setRepositoryRevision, setNotebookRevision, setManifestRevision, loadError, loading, actionError, setActionError, repoRoot, repositoryChoice, coreUpdate, config, gitStatus, setGitStatus, assets, setAssets, activeWorkingNotes, readDraft, readDraftIn, updateDraft, clearCommittedDrafts, draftsUnder, focus: focusPage, documents, pendingDocuments, refreshWorkspace, membershipChanged, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current && sameNote(current, note) && !sameValue(current, note) ? note : current) });
  // A refusal is said where it happened: moving on to another note, folder, filter or search clears it.
  useActionErrorReset(location.pathname + location.search, setActionError);
  const noteLink = useNoteLinkLoad(location, editorRoute);
  /** The state an address keeps when it follows a moved note: a note the Focus shows (or is about to) stays in the Focus. */
  const followedState = () => noteLink.inFocus ? FOCUS_NOTE_STATE : location.state;
  const sort = useNoteSort(selectedNotebookId, config?.notebooks.find(notebook => notebook.id === selectedNotebookId), noteLink.inFocus);
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
  const { locateNote, remoteTrash, changeCount, repositoryHeading, notebookUnavailable, manifestWritable, canManageTags, notebookGroups, unavailableNotebooks, syncTargets, liveDrafts } = useWorkspaceOverview({ config, remote, repositories, defaultRepository, repositoryFor, sourceId, gitStatus, activeWorkingNotes, pendingDocuments, selectedNotebookId });
  const editorRegistry = useNoteEditorRegistry();

  const { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, findCommittedNote, listCommittedPaths, readCommittedNote, readNoteForChange } = useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t });

  // Tag management: rename/merge/delete across the whole workspace, one commit per repository,
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const tagWorkspace = useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite: canManageTags, t, invalidateNotes, setRepositoryRevision, setActionError });
  const { tagOperations, handleUndoTagOperation } = tagWorkspace;

  const browseRepositoryId = notebookUnavailable ? undefined : repositoryFor(selectedNotebookId)?.id;
  const { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden } = useBrowseRoute({ editorRoute, config, location, queryState, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId, focusNoteRoute: noteLink.inFocus, repositoryId: browseRepositoryId, folders, foldersLoading, phone });

  /** The repository the header names: the shown notebook's, else the default repository's. */
  const currentRepository = pageRepository(repositories, sourceId, { tab: activeTab, allNotebooks: route.allNotebooks, notebookId: selectedNotebookId });

  const browseFacets = useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route });
  const { facetsQuery, notebookFacets, notebookStatuses, statusEntries, newNoteStatuses, selectedTags, workspaceTagNames, searchQuery, viewMode, folderless } = browseFacets;

  const { hasActiveTab, focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, activeNotePath, focusDocumentPanel, setDocumentContainer, showFocus, requestClear, confirmingClear, setConfirmingClear } = useFocusPanes({ selectedNotebookId, notebookRepository: repositoryFor(selectedNotebookId)?.id ?? '', focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite: canWriteNotebook(selectedNotebookId), editorRegistry, location, navigate, editorRoute, resolveBareNotebook, focusNoteRoute: noteLink.inFocus, notebookRoot: config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root });

  const navigation = useWorkspaceNavigation({ repositoryId: browseRepositoryId, filterVocabulary: browseFacets.filterVocabulary, location, queryState, selectedFolders, setFilterQuery, navigate, route, activeTab, selectedNotebookId, folderRoot, viewMode, selectedFolder, config, editorRegistry, fileManagerRef, loading, editorRoute, resolveBareNotebook });
  const { changeFilters, clearFilters, changeAllNotebooks, setActiveTab, agentSystemRef, resourceNavigationBusy, setResourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder } = navigation;

  const changeDialog = useChangeDialog({ activeTab, agentSystemRef, remote, documents, setActionError, activeWorkingNotes, pendingDocuments, canWriteNotebook, repositoryFor });
  const { isCommitOpen, openCommitModal, panelRemoteChanges } = changeDialog;
  // With every repository hidden or unavailable there is no notebook to show, and Settings is where the person
  // recovers: it opens there (decision C8).
  const nothingToShow = !loading && !loadError && !config?.notebooks.length;
  useEffect(() => {
    if (nothingToShow && activeTab !== 'settings') navigate('/settings#settings-repositories', { replace: true });
  }, [nothingToShow, activeTab, navigate]);
  useLeaveWarning(Boolean(panelRemoteChanges?.length));

  // Aggregated tags across the workspace for autocomplete
  const availableTags = useMemo(() => Array.from(new Set(workspaceTagNames.map(tag => tag.trim()))).filter(Boolean).sort(), [workspaceTagNames]);

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

  const presentation = !phone && viewMode === 'kanban' ? 'kanban' : 'list';
  const browseNotes = useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField: sort.sortField, sortOrder: sort.sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t });
  const { notebookRoot, displayedNotes, debouncedSearch } = browseNotes;

  const { handleOpenNote, closeZoom, closeCompilationZoom } = useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, focusNoteRoute: noteLink.inFocus, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets });

  const { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus } = useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus, isTemplate, trackOpen });
  const boardPanel = boardPanelActions({ noteFocus, selectedNotebookId, flushEditors: () => editorRegistry.flushEditors(), navigate, handleOpenNote, closeZoomState: () => setEditingNote(null), showFocus: () => setFocusNarrowView('focus'), setActionError, t });

  const { handleSaveNote } = useNoteSaving({ canWriteNotebook, remote, readDraft, readCommittedNote, t, stageWorkingNote, invalidateNotes, setEditingNote, setGitStatus, defaultDraftScope: defaultRepository ? draftScope(defaultRepository) : '' });

  const { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex } = useNoteRestoration({ remote, readDraft, updateDraft, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWriteNotebook, t, config, queryClient, queryScope, stageWorkingNote, revisionFor, location, liveLocked: note => liveActionLocked(note, 'other', liveDrafts) });

  // Multi-select and bulk actions (set status, add/remove tag, move to folder) for the browse views.
  const selection = useNoteSelection({ displayedNotes, viewMode, selectedNotebookId, scopeKey: noteLink.inFocus ? returnTo : location.pathname + location.search });

  // The selected notebook's templates: its manifest's, then the files of its `.templates/` folder, with this page's working changes.
  const selectedNotebook = config?.notebooks.find(nb => nb.id === selectedNotebookId);
  // A notebook's 「外觀…」 (icon and colour), from its context menu in the notebooks column.
  const notebookAppearance = useNotebookAppearance({ notebooks: config?.notebooks ?? [], repositoryFor, refreshWorkspace, setManifestRevision });
  const notebookTemplates = useNotebookTemplates(selectedNotebook);
  const { liveCreation, dialog: liveNewNoteDialog } = useLiveNoteCreation({ repository: repositoryFor(selectedNotebookId), handleOpenNote });

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createNote } = useCreateNote({ config, selectedNotebookId, setSelectedNotebookId, folders, browsedFolder: activeTab === 'notes' ? selectedFolder : null, foldersLoading, remote, canWrite, readDraft, templates: notebookTemplates.templates, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, live: liveCreation, onCreated: note => void openFromBrowse(note), onError: setActionError });

  const outlineActions = useOutlineActions({ config, repositoryFor, readDraft, remote, sourceId, selectedNotebookId, locationKey: location.key, routedRef: editorRoute.note && editorNotebookId ? { notebookId: editorNotebookId, path: `${config?.notebooks.find(nb => nb.id === editorNotebookId)?.root}/${editorRoute.note}` } : null, prepareLeave: editorRegistry.flushEditors, openNote: handleOpenNote, openNewNote: options => void createNote(options), onError: setActionError });

  // The agent's note tools edit this page's working changes; only a remote workspace has them, as local Pi edits its files.
  const webAgentTools = useWebAgentTools({ config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote, listCommittedPaths, resolveBareNotebook });
  const { confirmGists, gistConfirmDialog } = useGistConfirm();
  const { commitWorkingNotes } = useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError, confirmGists });
  const { commitNoteFile } = useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes, activeWorkingNotes, t, statusLabel: status => statusLabel(status, statusEntries, language) });
  const legacyImport = useLegacyImport({ repositories, config, refreshWorkspace, refreshNotes, handleOpenNote, t });

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
  const liveHandover = useWorkspaceHandover({ config, remote, sourceId, activeWorkingNotes, repositoryFor, updateDraft, readDraft, stageWorkingNote, invalidateNotes, isTemplate, routedNote, handleOpenNote });
  const templateActions = useTemplateActions({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, revisionFor, queryClient, queryScope, invalidateNotes, setGitStatus, openInZoom: handleOpenNote, deleteNote: note => handleDeleteNote(note), relocateFile: noteMove.relocateFile, t });
  const templateManager = useTemplateManager({ selectedNotebook, notebookTemplates, templateActions, canWrite, canWriteFiles, t });
  const movingNotebook = noteMove.request?.mode === 'move' ? config?.notebooks.find(nb => nb.id === noteMove.request?.note.notebookId) : undefined;
  const { toolbar: bulkToolbar, moveDialog: bulkMoveDialog } = useBulkToolbar({ selection, config, remote, folders, repositories, setRepositoryRevision, setActionError, canWriteFiles, statuses: notebookStatuses, availableTags, liveDrafts, tagOperations, onUpdateNoteStatus: handleUpdateNoteStatus, beforeFileChange, onFilesChanged, invalidateNotes, t });

  // A note the Focus shows, or a linked note waiting to open there, is not shown in zoom.
  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError && !noteLink.inFocus;
  // The note a `?edit` address asks to edit live, once zoom or the Focus's active pane shows it.
  const liveEditTarget = liveEditLinkTarget({ search: location.search, state: location.state, routedNote, zoomOpen: noteEditorOpen, inFocus: noteLink.inFocus, focusPending: noteLink.pending, activeNotePath });

  // Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state.
  const editorProps = noteEditorProps({ config, remote, sourceId, gitStatus, assets, activeWorkingNotes, repositoryFor, refreshWorkspace, stageWorkingNote, updateDraft, setActionError, navigate, search: location.search, facets: facetsQuery.facets, availableTags, invalidateNotes, isTemplate, handleOpenNote, closeZoom, handleSaveNote, handleRestoreNoteFile, handleDeleteNote, commitNoteFile, handleUploadAsset, handleDeleteAsset, handleMoveAsset, beforeFileChange, onFilesChanged, returnToFocus, frameSelection, liveHandover, noteMove, templateActions, followMoved, routedPath });

  const phoneNotes = phone && activeTab === 'notes' && !route.study;
  const phoneNoteScreen = phoneNotes && phoneNotesScreen({ hasFocus: Boolean(noteFocus.layout), hasActiveTab, view: focusNarrowView }) === 'note';
  // What the Changes tool counts: pending changes, and for a local workspace the deletions awaiting commit.
  const phoneChangesCount = remote ? changeCount : changeCount + deletedNotes.length;
  const phoneNotesValue = usePhoneNotesValue(setFocusNarrowView, phoneChangesCount, canWrite ? note => void handleDeleteNote(note as NoteListItem) : undefined);
  // Wider than a phone, the Notes page keeps three columns (notebooks, list, note) whatever opens or closes; the person folds the first two
  // away, and a cramped page, or a Focus whose panes need the room, folds the notebooks column to its rail.
  const notesColumns = !phone && activeTab === 'notes' && !route.study && !notebookUnavailable;
  const columns = useBrowseColumns({ panes: paneColumns(focusDisplay?.root) });
  const board = useBoardPlacement({ presentation, focusOpen: Boolean(noteFocus.layout && !isEmptyFocus(noteFocus.layout)), panes: paneCount(focusDisplay?.root) });
  const { focusCommands, shortcutMode, setShortcutMode } = useShortcutSurface({ noteFocus, focusDisplay, t, showFocus, requestClear, zoomFocusNote, focusCapacity });
  const { noteSearch, focusNoteSearch } = useNoteSearchFocus({ notesColumns, columns, activeTab, phoneNoteScreen, setActiveTab, setFocusNarrowView });
  useAppCommands({ t, setActiveTab: tab => void setActiveTab(tab), canCreateNote: canWrite, createNote: () => void createNote(), focusNoteSearch, noteEditorOpen, pageCommands: notesColumns ? [...focusCommands, ...browseColumnCommands(columns, t, board.placement === 'folded' ? 'list' : presentation)] : focusCommands });

  // The toolbar search dims what the Focus shows that it does not match; on a phone it only filters the list.
  const focusMatches = useFocusSearch({ q: debouncedSearch, notebookId: selectedNotebookId, enabled: Boolean(noteFocus.layout) && !phone });
  const boardNotes = useBoardNoteCreation({ config, folders, foldersLoading, remote, canWriteNotebook, repositoryFor, readDraft, updateDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, facets: facetsQuery.facets, t });
  const { compilationActions, createUntitledCompilation, createUntitledBoard, renderCompilation, compilationBehind } = useCompilations({ config, remote, folders, canWriteNotebook, repositoryFor, revisionFor, stageWorkingNote, setGitStatus, setActionError, invalidateNotes, facets: facetsQuery.facets, t, selectedNotebookId, folderRoot, setSelectedFolder, locationState: location.state, routeNotebook: editorRoute.notebook, handleSaveNote, handleDeleteNote, createNote, handleOpenNote, closeCompilationZoom, openInFocus, openFromBrowse, boardPanel, boardNotes });
  const { renderNotesPage, phoneFilterSheet } = useNotesPage({ phone, phoneNotes, phoneNoteScreen, t, config, remote, loading, folders, foldersLoading, actionError, refreshWorkspace, refreshDocuments, staleNotice, readNoteForChange, notebookGroups, unavailableNotebooks, route, activeTab, selectedNotebookId, selectedNotebook, selectedFolder, folderRoot, showHidden, canWrite, canWriteFiles, filtersOpen, setFiltersOpen, navigation, facets: browseFacets, browse: browseNotes, sort, selection, tags: tagWorkspace, bulkToolbar, noteFocus, activeNotePath, columns, notesColumns, presentation, board, noteSearch, focusNoteSearch, notebookAppearance, handleOpenNote, openFromBrowse, handleDeleteNote, handleUpdateNoteStatus, noteMove, createNote, createUntitledCompilation, openFileManager, beforeFileChange, navigationDisabled: noteEditorOpen || isCommitOpen, setShortcutMode });

  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;
  if (route.legacyScreen) return <LegacyScreenRedirect laneId={route.legacyLane} notebooks={config?.notebooks || []} onMissing={setActionError} />;

  // The Notes page's Focus controls and New button sit in the header, which stays whatever the columns fold, so each is mounted once (the Focus
  // dialogs live in its controls).
  const notesActions = !notebookUnavailable && activeTab === 'notes' && !route.study && !phone;
  const focusControls = notesActions ? <FocusControls splittable={focusCapacity === 'all'} focus={noteFocus} onShow={key => void showFocus(key)} onRequestClear={requestClear} confirmingClear={confirmingClear} onConfirmingClearChange={setConfirmingClear} onReload={() => void focusPage.reload()} browseToggle={focusCapacity === 1 ? { showing: focusNarrowView === 'browse', onToggle: () => setFocusNarrowView(view => view === 'browse' ? 'focus' : 'browse') } : undefined} /> : undefined;
  // A read-only notebook shows neither the New button nor its menu.
  const newNote: NewNoteActions | undefined = notesActions && canWrite ? { onNewNote: () => void createNote(), onNewOutline: () => void createNote({ kind: 'outline' }), onNewCompilation: () => void createUntitledCompilation(), templates: [...notebookTemplates.templates.map(template => ({ id: template.id, title: template.name })), ...builtinNoteTemplates(t)], onManageTemplates: selectedNotebook ? templateManager.openTemplateManager : undefined, onNewFromTemplate: templateId => void createNote({ templateId }), onImportLegacy: legacyImportOffered(repositoryFor(selectedNotebookId)) ? legacyImport.openLegacyImport : undefined } : undefined;
  const refreshAfterSync = async () => {
    await refreshWorkspace();
    await refreshDocuments().catch(error => setActionError(error instanceof Error ? error.message : String(error)));
  };
  const focusArea = <FocusArea focus={noteFocus} capacity={focusCapacity} notebookRoot={folderRoot ?? ''} notebook={selectedNotebook} folders={folders} renderCompilation={renderCompilation} searchMatches={focusMatches} onZoomNote={zoomFocusNote} documentPanel={focusDocumentPanel} />;

  return (
    <WorkspaceProviders remote={remote} loading={loading} sourceId={sourceId} notebooks={config?.notebooks} folders={folders} repositories={repositories} agentEnabled={agentEnabled} webAgentTools={webAgentTools} outlineActions={outlineActions.value} statusEntries={statusEntries} phoneNotes={phoneNotesValue} syncTargets={syncTargets} onSynced={refreshAfterSync} onRevealChanges={() => setFileMetadataOpen(false)} liveEditTarget={liveEditTarget} compilationActions={compilationActions} liveDrafts={liveDrafts} openLink={(note, anchor, source) => void openLink(note, anchor, source)} locateNote={locateNote} noteEditing={{ register: editorRegistry.register, editorProps, flushEditors: editorRegistry.flushEditors, refreshNotes, closeZoom, addToFocus, moveNote: noteMove.moveNote, renameNote: noteMove.renameNote, renameNoteTo: noteMove.renameNoteTo }} noteSheet={noteSheetActions({ phone, notebooks: config?.notebooks, canWriteNotebook, updateStatus: handleUpdateNoteStatus, moveNote: noteMove.moveNote, deleteNote: handleDeleteNote })}>
      <div className='app-shell h-dvh min-w-0 flex-1 overflow-hidden flex flex-col font-sans transition-colors duration-200' data-workspace-tab={activeTab} data-screen-focus={Boolean(route.study)} style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}>
        <WorkspaceBanners coreBaseline={!remote && defaultRepositoryBranch === 'core'} legacyNotice={legacyImport.notice} defaultRepository={defaultRepository} manifestWritable={manifestWritable} onManifestCreated={() => refreshWorkspace(true)} />
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
              hasSidebar={activeTab !== 'boards' && !route.study && !notesColumns}
              sidebarDomId={activeTab === 'notes' ? 'notebook-panel' : activeTab === 'agent' ? 'agent-sidebar-panel' : activeTab === 'assets' ? 'assets-sidebar-panel' : activeTab === 'settings' ? 'settings-sidebar-panel' : undefined}
              closeLabel={t('sidebar.closeFilters')}
              rightPanelWidth={rightPanelWidth}
              assistant={
                <>
                  <TypstPreviewDock />
                  <AssistantDock onOpenAgents={() => setActiveTab('agent')} agentsDisabled={noteEditorOpen || isCommitOpen} swipe={(activeTab === 'notes' && !filtersOpen) || noteEditorOpen} />
                </>
              }
              rightPanel={<WorkspaceRightPanel phoneNotes={phoneNotes} documentPanel={activeTab === 'notes' && noteFocus.layout ? { enabled: activePaneNote, onContainer: setDocumentContainer } : undefined} fileMode={activeTab === 'assets'} filePanel={filePanel} canEditFileMetadata={canWriteFiles && !resourceNavigationBusy} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} currentFolder={selectedFolder && notebookRoot ? `${notebookRoot}/${selectedFolder}` : undefined} remote={remote} gitStatus={gitStatus} repoRoot={repoRoot} updateDraft={updateDraft} changeCount={changeCount} remoteTrash={remoteTrash} repositoryHeading={repositoryHeading} deletedNotes={deletedNotes} handleRestoreNote={handleRestoreNote} changeDialog={changeDialog} canWrite={canWrite} handleOpenNote={handleOpenNote} handleSaveNote={handleSaveNote} readNoteForChange={readNoteForChange} refreshAfterSync={refreshAfterSync} />}
            >
              {notebookUnavailable && ['notes', 'assets', 'boards'].includes(activeTab) && <NotebookUnavailableRoute notebookTitle={selectedNotebook?.title ?? selectedNotebookId} unavailable={notebookUnavailable} />}
              {!notebookUnavailable && activeTab === 'notes' && !route.study && renderNotesPage(focusArea)}
              {activeTab === 'agent' && (
                <main className='workspace-route agent-main'>
                  <AgentSystemView ref={agentSystemRef} notebooks={config?.notebooks || []} folders={folders} repositories={repositories} defaultRepository={sourceId} onBusyChange={setResourceNavigationBusy} remote={remote} onGitStatus={setGitStatus} />
                </main>
              )}
              {!notebookUnavailable && activeTab === 'assets' && (
                <main className='workspace-route assets-main has-sidebar-drawer'>
                  <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} onNotebookChange={id => void setSelectedNotebookId(id)} writable={canWriteFiles} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer} onShowMetadata={() => setFileMetadataOpen(true)} initialPath={filesInitialPath(location.search, folderRoot, selectedNotebook?.assets || 'assets')} onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
                </main>
              )}
              {!notebookUnavailable && activeTab === 'notes' && route.study && <StudyRoute notebooks={config?.notebooks || []} folders={folders} notebookId={selectedNotebookId} notebook={selectedNotebook} path={route.study} remote={remote} refreshWorkspace={refreshWorkspace} invalidateNotes={invalidateNotes} setGitStatus={setGitStatus} setActionError={setActionError} handleOpenNote={handleOpenNote} navigate={navigate} />}
              {!notebookUnavailable && activeTab === 'boards' && <BoardsRoute sourceKey={remote ? sourceId : repoRoot} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} folders={folders} writable={canWrite} sidePanel={boardPanel} onOpenNote={(note, anchor) => void handleOpenNote(note, anchor)} onCreate={createUntitledBoard} />}
              {activeTab === 'settings' && (
                <main className='workspace-route settings-main has-sidebar-drawer'>
                  <SettingsModal manifest={{ repositories, defaultRepository: sourceId, initialRepository: repositoryFor(selectedNotebookId)?.id ?? sourceId, onManifestRevision: setManifestRevision }} repositories={{ repositories, onMembershipChanged: membershipChanged, onOpenChanges: () => openCommitModal() }} recovery={nothingToShow} local={!remote} coreUpdates={coreUpdate} accountSettings={<AgentAccessSettings local={!remote} />} repositoryChoice={repositoryChoice && defaultRepository?.repository ? <RepositorySwitch repository={defaultRepository.repository} branch={defaultRepositoryBranch} /> : undefined} onRefreshWorkspace={refreshWorkspace} currentTheme={currentTheme} onSelectTheme={handleSelectTheme} />
                </main>
              )}
            </WorkspaceSplitLayout>
          </div>
        </SidebarProvider>
        <WorkspaceToasts undoToast={undoToast} setUndoToast={setUndoToast} handleRestoreNote={handleRestoreNote} tagOperations={tagOperations} handleUndoTagOperation={handleUndoTagOperation} />
        {notebookAppearance.element}
        {fileDialog && <FileManagerDialog notebookId={fileDialog.notebookId} notebooks={config?.notebooks || []} writable={canWriteFiles} initialPath={fileDialog.path} movePath={fileDialog.movePath} initialOperation={fileDialog.initialOperation} showDocuments={fileDialog.showDocuments} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} onClose={() => setFileDialog(undefined)} />}
        {noteMove.request?.mode === 'move' && movingNotebook && <FolderPickerDialog notebooks={[movingNotebook]} folders={folders} title={t('files.moveNoteTitle', { title: noteMove.request.note.title || noteMove.request.note.path.split('/').pop() || '' })} initial={{ notebookId: movingNotebook.id, folder: noteMove.request.note.live?.pending ? liveDestinationFolder(noteMove.request.note.live) : noteFolder(noteMove.request.note.path, movingNotebook.root) }} confirmLabel={t('bulk.moveConfirm')} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={({ folder }) => void noteMove.confirmMove(folder)}>{noteMove.request.note.live?.pending && <p className='text-xs text-muted'>{t('live.collisionNote')}</p>}</FolderPickerDialog>}
        {liveNewNoteDialog}
        {templateManager.dialog}
        {noteMove.request?.mode === 'rename' && <RenameNoteDialog path={noteMove.request.note.path} title={noteMove.request.note.title} initial={noteMove.request.name} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={title => void noteMove.confirmRename(title)} />}
        {bulkMoveDialog}
        {/* Note Editor Modal */}
        <EditorModal key={fileEditorRevision} note={routedNote} committed={routedCommitted && typeof routedCommitted.content === 'string' ? routedCommitted as NoteItem : undefined} loading={routedLoading} isOpen={noteEditorOpen} renderCompilation={renderCompilation} behind={compilationBehind} error={actionError} />
        {phoneFilterSheet}
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
        <WorkspaceCommitModal remote={remote} repositories={repositories} documents={documents} pendingDocuments={pendingDocuments} gitStatus={gitStatus} readDraft={readDraft} readDraftIn={readDraftIn} updateDraft={updateDraft} refreshWorkspace={refreshWorkspace} refreshDocuments={refreshDocuments} changeDialog={changeDialog} commitWorkingNotes={commitWorkingNotes} repositoryHeading={repositoryHeading} agentSystemRef={agentSystemRef} editingNote={editingNote} setEditingNote={setEditingNote} setDeletedNotes={setDeletedNotes} setUndoToast={setUndoToast} />
      </div>
      {gistConfirmDialog}
      <ImageLightbox />
      {outlineActions.dialog && <AddToOutlineDialog key={outlineActions.dialog.id} source={outlineActions.dialog.source} busy={outlineActions.busy} error={outlineActions.error} onChoose={outlineActions.choose} onClose={outlineActions.cancel} />}
      {legacyImport.dialog}
    </WorkspaceProviders>
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
