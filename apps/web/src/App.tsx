import { useNoteSort } from './app/useNoteSort.js';
import { LegacyOutlineDialog } from './components/LegacyOutlineDialog.js';
import { useLegacyBookmarkRecovery } from './lib/use-legacy-bookmark-recovery.js';
import { Button } from './components/Button.js';
import { useOutlineActions } from './app/useOutlineActions.js';
import { OutlineActionsProvider } from './lib/outline-actions.js';
import { PiAgentProvider } from './lib/pi-agent/session.js';
import { AgentFocusCommand } from './components/pi-agent/AgentFocusCommand.js';
import { AssistantDock } from './components/assistant/AssistantDock.js';
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
import { useNoteSaving } from './app/useNoteSaving.js';
import { useDeletionUndo } from './app/useDeletionUndo.js';
import { useNoteRestoration } from './app/useNoteRestoration.js';
import { useWorkingNoteCommit } from './app/useWorkingNoteCommit.js';
import { useFileNavigation } from './app/useFileNavigation.js';
import { useChangeDialog } from './app/useChangeDialog.js';
import { useQuickNoteCommit } from './app/useQuickNoteCommit.js';
import { useShortcutSurface } from './app/useShortcutSurface.js';
import { useAppCommands } from './app/useAppCommands.js';
import { type NoteListItem, noteQueryStatuses, type NoteRef, noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import { useWorkspaceSync } from './lib/use-workspace-sync.js';
import { discardDocumentDraft } from './lib/use-workspace-document.js';
import { documentClientOf } from './lib/workspace-document-clients.js';
import { WorkspaceLinks } from './components/WorkspaceLinks.js';
import { type NoteLocation, NoteLocationProvider, readOnlyReason } from './lib/note-location.js';
import { ImageLightbox } from './components/ImageLightbox.js';
import { useNavigate } from 'react-router-dom';
import { useFoldAnimation } from './lib/use-fold-animation.js';
import { notebookRoute, noteRoute, noteTrail, parseWorkspaceRoute, trailCompilation } from './lib/routes.js';
import { draftScope, pageRepository } from './lib/workspace-repositories.js';
import { clearLocalDraft, moveLocalDraft } from './lib/storage.js';
import { sameValue } from './lib/merge-note.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchFileDiff, fetchGitStatus, readNote } from './lib/api.js';
import { workingDiff } from './lib/working-notes.js';
import { NoteListSentinel } from './components/NoteListSentinel.js';
import type { NotebookConfig, NoteItem } from './lib/types.js';
import { useTagWorkspaceOperations } from './app/useTagWorkspaceOperations.js';
import { useNoteSelection } from './app/useNoteSelection.js';
import { useBulkNoteActions } from './app/useBulkNoteActions.js';
import { BulkActionsToolbar } from './components/BulkActionsToolbar.js';
import { FolderPickerDialog } from './components/FolderPickerDialog.js';
import { useAssetOperations } from './app/useAssetOperations.js';
import { useRoutedNote } from './app/useRoutedNote.js';
import { UNTITLED_STEM, useCreateNote } from './app/useCreateNote.js';
import { useNoteMove } from './app/useNoteMove.js';
import { folderCommandScope } from './lib/file-change-scope.js';
import { noteFolder } from './lib/note-move.js';
import { RenameNoteDialog } from './components/RenameNoteDialog.js';
import { AgentAccessSettings, AuthControls, ConnectionState } from './components/AuthControls.js';
import { Header } from './components/Header.js';
import { KeyboardShortcuts } from './components/KeyboardShortcuts.js';
import { type NoteSearchHandle, NoteToolbar } from './components/NoteToolbar.js';
import { KeyboardRoot } from './lib/keyboard/KeyboardDispatcher.js';
import { PageToolbar, SidebarProvider, WorkspaceSidebarPortal, WorkspaceSplitLayout } from './components/WorkspaceChrome.js';
import { useVisualViewport } from './lib/use-visual-viewport.js';
import { Sidebar } from './components/Sidebar.js';
import { NoteCollection } from './components/NoteCollection.js';
import { noteFolderGrouping } from './lib/note-groups.js';
import { KanbanView } from './components/KanbanView.js';
import { EditorModal } from './components/EditorModal.js';
import type { NoteEditorSharedProps } from './components/note-editor/types.js';
import { NoteEditingProvider, useNoteEditorRegistry } from './lib/note-editing.js';
import { FocusArea } from './components/FocusArea.js';
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
import { useCompilationActionsValue } from './app/useCompilationActionsValue.js';
import { BrowseDock, BrowseDockToggle } from './components/BrowseDock.js';
import { RightPanel } from './components/RightPanel.js';
import { FileManager, FileManagerDialog, FileMetadata } from './components/files/index.js';
import { AgentSystemView } from './components/AgentSystemView.js';
import { SettingsModal } from './components/SettingsModal.js';
import { useAccountControls, useAgentEnabled } from './lib/web-features.js';
import { DerivedManifestNotice, RepositorySwitch, WorkspaceGate } from './components/WorkspaceSetup.js';
import { useLeaveWarning } from './lib/use-leave-warning.js';
import { CommitModal } from './components/CommitModal.js';
import { Breadcrumbs } from './components/Breadcrumbs.js';
import { FolderIndex } from './components/FolderIndex.js';
import { FolderLinks } from './components/FolderLinks.js';
import { I18nProvider, useTranslation } from './lib/i18n/index.js';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';
import { LoadingStatus } from './components/LoadingStatus.js';

const CompilationStudy = React.lazy(() => import('./components/CompilationStudy.js').then(module => ({ default: module.CompilationStudy })));
const NotebookGraphPage = React.lazy(() => import('./components/NotebookGraphPage.js').then(module => ({ default: module.NotebookGraphPage })));

/** A stable empty list while the workspace config loads, so the agent provider's value does not churn. */
const NO_NOTEBOOKS: NotebookConfig[] = [];

/** The workspace itself, behind the sign-in gate; the entry loads it as its own chunk. */
export const AppContent: React.FC = () => {
  useVisualViewport();
  const { t } = useTranslation();
  const renderAccountControls = useAccountControls();
  const { sortField, sortOrder, handleSortChange } = useNoteSort();

  const { filtersOpen, setFiltersOpen, location, queryState, setFilterQuery } = useFilterSidebar();

  const { currentTheme, handleSelectTheme } = useTheme();

  const [editingNote, setEditingNote] = useState<NoteListItem | null>(null);
  const [fileEditorRevision, setFileEditorRevision] = useState(0);

  const { fileDialog, setFileDialog, fileMetadataContainer, setFileMetadataContainer, fileMetadataOpen, setFileMetadataOpen, rightPanelWidth, setRightPanelWidth, selectedFileEntry, setSelectedFileEntry, fileManagerRef } = useFilePanel();

  // The URL owns page, notebook, folder and filter selection.
  const navigate = useNavigate();
  const editorRoute = useMemo(() => parseWorkspaceRoute(location.pathname, location.search), [location.pathname, location.search]);

  const { selectedNotebookId, resolveBareNotebook, folders, foldersLoading, sourceId, remote, repositories, defaultRepository, defaultRepositoryBranch, repositoryFor, canWriteNotebook, revisionFor, setRepositoryRevision, setNotebookRevision, setManifestRevision, loadError, loading, actionError, setActionError, repoRoot, repositoryChoice, coreUpdate, config, gitStatus, setGitStatus, assets, setAssets, activeWorkingNotes, readDraft, readDraftIn, updateDraft, clearCommittedDrafts, draftsUnder, focus: focusPage, documents, pendingDocuments, refreshWorkspace, membershipChanged, stageWorkingNote } = useWorkspaceSync({ routeNotebook: editorRoute.notebook || undefined, onStageNote: note => setEditingNote(current => current && sameNote(current, note) && !sameValue(current, note) ? note : current) });
  const agentEnabled = useAgentEnabled(remote);
  const refreshDocuments = async () => {
    await Promise.all(documents.map(document => document.refresh()));
  };
  // The selected notebook's repository decides what the browse, create and file views may write.
  const canWrite = canWriteNotebook(selectedNotebookId);
  /** Where a note lives, for the note Info tab: the repository and branch of its notebook, and why it is read-only. */
  const locateNote = (note: NoteRef): NoteLocation | undefined => {
    const repository = repositoryFor(note.notebookId);
    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (!notebook) return undefined;
    const name = repository?.repository ?? (repository?.id.startsWith('local:') ? repository.id.slice('local:'.length) : repository?.id ?? '');
    const readOnly = readOnlyReason(repository);
    return { notebook: notebook.title, repository: name, branch: repository?.branch ?? '', path: note.path, readOnly, gists: repository?.type === 'github' && !readOnly };
  };
  /** Pending changes across repositories; a path names a file only within its repository, so each repository counts its own. */
  // A remote deletion is a working change held in the trash, which the Changes panel lists and counts apart.
  const remoteTrash = useMemo(() => Object.values(activeWorkingNotes).flatMap(entry => entry.deleted && entry.base ? [entry.base] : []), [activeWorkingNotes]);
  const changeCount = remote ? Object.keys(activeWorkingNotes).length + pendingDocuments.length : repositories.filter(repository => !repository.unavailable).reduce((sum, repository) => {
    const status = repository.id === sourceId ? gitStatus : repository.gitStatus;
    return sum + (status ? new Set([...status.staged, ...status.modified, ...status.untracked]).size : 0);
  }, 0);
  /** With several repositories, Changes groups entries under each repository and its branch. */
  const repositoryHeading = repositories.length > 1
    ? (id: string | undefined) => {
      const repository = repositories.find(candidate => candidate.id === id);
      const name = repository?.title ?? (id?.startsWith('local:') ? id.slice('local:'.length) : id ?? '');
      return repository?.branch ? `${name} · ${repository.branch}` : name;
    }
    : undefined;
  /** Why the selected notebook's repository cannot serve it; its notebook views show this instead. */
  const notebookUnavailable = repositoryFor(selectedNotebookId)?.unavailable;
  /** Whether the default repository, when it keeps no manifest, can create one from its derived layout. */
  const manifestWritable = Boolean(defaultRepository?.write);
  // A workspace-wide tag change commits to every repository that serves a notebook.
  const canManageTags = repositories.some(repository => repository.notebooks.length) && repositories.every(repository => repository.write || !repository.notebooks.length);
  const editorRegistry = useNoteEditorRegistry();

  const { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, findCommittedNote, readCommittedNote, readNoteForChange } = useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t });

  // Tag management: rename/merge/delete across the whole workspace, one commit per repository,
  // with a session-lifetime undo (kept in `tagOperations.history` until page reload).
  const { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation } = useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite: canManageTags, t, invalidateNotes, setRepositoryRevision, setActionError });

  const { editorNotebookId, returnTo, route, activeTab, sidebarGestureRef, selectedFolders, folderRoot, selectedFolder, scopeNotebookId, selectedStatus, showHidden } = useBrowseRoute({ editorRoute, config, location, queryState, setFileMetadataOpen, loading, loadError, filtersOpen, setFiltersOpen, selectedNotebookId });

  /** The repository the header names: the shown notebook's, else the default repository's. */
  const currentRepository = pageRepository(repositories, sourceId, { tab: activeTab, allNotebooks: route.allNotebooks, notebookId: selectedNotebookId });
  /** With several repositories, the notebook switcher groups notebooks under each repository's title. */
  const notebookGroups = repositories.length > 1 ? repositories.filter(repository => repository.notebooks.length).map(repository => ({ label: repository.title, notebooks: repository.notebooks })) : undefined;

  const { facetsQuery, notebookFacets, notebookStatuses, statusEntries, newNoteStatuses, selectedTags, workspaceTagNames, noteTagActions, searchQuery, viewMode, folderless } = useBrowseFacets({ showHidden, config, scopeNotebookId, selectedFolders, selectedNotebookId, route, canManageTags, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag });

  const { focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, focusDocumentPanel, setDocumentContainer, showFocus, requestClear, confirmingClear, setConfirmingClear } = useFocusPanes({ selectedNotebookId, notebookRepository: repositoryFor(selectedNotebookId)?.id ?? '', focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite: canWriteNotebook(selectedNotebookId), editorRegistry, location, navigate, editorRoute, resolveBareNotebook });

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

  const { deletedNotes, setDeletedNotes, undoToast, setUndoToast, handleDeleteNote, handleRestoreNote } = useDeletionUndo({ canWriteNotebook, revisionFor, setNotebookRevision, updateDraft, editingNote, setEditingNote, navigate, returnTo, remote, setActionError, readNoteForChange, invalidateNotes, gitStatus, setGitStatus, repositoryFor });

  useSourceReset({ sourceId, setEditingNote, setDeletedNotes });

  const { routedNote, routedCommitted, routedLoading, routeError } = useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote });

  const { notebookRoot, folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup, debouncedSearch, groupable, groupedByFolder } = useBrowseNotes({ scopeNotebookId, selectedFolders, selectedTags, route, searchQuery, selectedStatus, showHidden, config, selectedNotebookId, selectedFolder, activeTab, sortField, sortOrder, viewMode, facetsQuery, notebookFacets, folders, notebookStatuses, changeAllNotebooks, changeFilters, clearFilters, folderless, t });

  const { handleOpenNote } = useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets });

  const { openInFocus, openFromBrowse, openLink, zoomFocusNote, addToFocus } = useFocusNoteNavigation({ noteFocus, selectedNotebookId, setFocusNarrowView, handleOpenNote, setAddingToFocus });

  const { handleSaveNote } = useNoteSaving({ canWriteNotebook, remote, readDraft, readCommittedNote, t, stageWorkingNote, invalidateNotes, setEditingNote, setGitStatus, defaultDraftScope: defaultRepository ? draftScope(defaultRepository) : '' });

  const { handleRestoreNoteFile, handleUpdateNoteStatus, handleOpenFolderIndex } = useNoteRestoration({ remote, readDraft, updateDraft, setEditingNote, navigate, returnTo, invalidateNotes, setGitStatus, setActionError, handleSaveNote, readNoteForChange, selectedNotebookId, canWriteNotebook, t, config, queryClient, queryScope, stageWorkingNote, revisionFor, location });

  // Multi-select and bulk actions (set status, add/remove tag, move to folder) for the browse views.
  const { selectedNotes, selectedKeys, toggleSelect, clearSelection } = useNoteSelection({ displayedNotes, viewMode, selectedNotebookId, scopeKey: location.pathname + location.search });
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveNotebookId = selectedNotes.length > 0 && selectedNotes.every(note => note.notebookId === selectedNotes[0].notebookId) ? selectedNotes[0].notebookId : undefined;
  const bulkMoveNotebook = config?.notebooks.find(nb => nb.id === bulkMoveNotebookId);

  // Create New Note dialog: its form state and the handlers that render or persist a new note draft.
  const { createNote } = useCreateNote({ config, selectedNotebookId, setSelectedNotebookId, folders, browsedFolder: activeTab === 'notes' ? selectedFolder : null, foldersLoading, remote, canWrite, readDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, sourceId, newNoteStatuses, t, onCreated: note => void openFromBrowse(note), onError: setActionError });

  const outlineActions = useOutlineActions({ config, repositoryFor, readDraft, remote, sourceId, selectedNotebookId, locationKey: location.key, routedRef: editorRoute.note && editorNotebookId ? { notebookId: editorNotebookId, path: `${config?.notebooks.find(nb => nb.id === editorNotebookId)?.root}/${editorRoute.note}` } : null, prepareLeave: editorRegistry.flushEditors, openNote: handleOpenNote, openNewNote: options => void createNote(options), onError: setActionError });

  // The agent's note tools edit this page's working changes; only a remote workspace has them, as local Pi edits its files.
  const webAgentTools = useWebAgentTools({ config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote, resolveBareNotebook });
  const { commitWorkingNotes } = useWorkingNoteCommit({ documents, sourceId, t, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError });
  const { commitNoteFile } = useQuickNoteCommit({ remote, repositoryFor, refreshWorkspace, commitWorkingNotes, activeWorkingNotes, t });
  const legacyRecovery = useLegacyBookmarkRecovery(repositories.map(repository => repository.id));
  const [legacyImportOpen, setLegacyImportOpen] = useState(false);

  // Assets are scoped to whichever notebook the open note (or the selected browse notebook) belongs to.
  const { handleUploadAsset, handleDeleteAsset, handleMoveAsset } = useAssetOperations({ editingNote, selectedNotebookId, remote, setAssets, setGitStatus });

  const { beforeFileChange, openFileManager, onFilesChanged, openFileIndex } = useFileNavigation({ editorRegistry, draftsUnder, remote, readDraft, t, config, setFileDialog, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, setActionError, navigate, location, returnTo, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex });
  /** The unsaved copy an editor keeps in this browser for a note path, which a moved note leaves behind, and the conflicted copy, which follows the note. */
  const forgetDrafts = (notebookId: string, path: string, destination: string) => {
    const repository = repositoryFor(notebookId);
    const scope = (repository ? draftScope(repository) : '') || repository?.branch || '';
    clearLocalDraft(scope, path);
    moveLocalDraft(`${scope}:conflict`, path, destination);
  };
  const noteMove = useNoteMove({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, saveNote: handleSaveNote, focus: focusPage, queryClient, queryScope, flushEditors: editorRegistry.flushEditors, beforeFileChange, onFilesChanged, setNotebookRevision, forgetDrafts, relocateCurrentFocus: noteFocus.relocatePaths, setActionError, t });
  const movingNotebook = noteMove.request?.mode === 'move' ? config?.notebooks.find(nb => nb.id === noteMove.request?.note.notebookId) : undefined;
  const { bulkBusy, runBulkStatus, runBulkTag, runBulkMove } = useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus: handleUpdateNoteStatus, beforeFileChange, onFilesChanged, repositories, remote, canWrite, t, invalidateNotes, setRepositoryRevision, setActionError, tagOperations, config });

  const noteEditorOpen = (Boolean(routedNote) || routedLoading) && !routeError;

  // Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state.
  const editorProps = (note: NoteItem, committed?: NoteItem): NoteEditorSharedProps => {
    // The note's repository decides whether it may be written and where its drafts are kept.
    const repository = repositoryFor(note.notebookId);
    const writable = Boolean(repository?.write);
    const draft = activeWorkingNotes[noteRefKey(note)];
    const repositoryStatus = repository?.id === sourceId ? gitStatus : repository?.gitStatus ?? null;
    return {
      statuses: noteQueryStatuses(config?.notebooks || [], note.notebookId, Object.keys(facetsQuery.facets?.[note.notebookId]?.statuses || {})),
      metadataFields: config?.notebooks.find(nb => nb.id === note.notebookId)?.metadata,
      onSave: params => handleSaveNote({ ...params, notebookId: note.notebookId }),
      onRestoreFile: path => handleRestoreNoteFile(path, note.notebookId),
      onCommitFile: writable ? (path, version) => commitNoteFile(path, note.notebookId, version) : undefined,
      // The same diff the Changes panel shows: a remote note's draft against its base, a local note's worktree against HEAD.
      readDiff: remote ? draft && (async () => workingDiff({ [note.path]: draft })) : () => fetchFileDiff({ path: note.path, repository: repository?.id }, 'current'),
      // A path names a file only within its repository: a remote note is dirty when it holds a draft, a local one when its worktree reports it.
      isDirty: remote ? Boolean(draft) : Boolean(repositoryStatus && [...repositoryStatus.modified, ...repositoryStatus.staged, ...repositoryStatus.untracked].includes(note.path)),
      availableTags,
      assets,
      onUploadAsset: !writable ? undefined : handleUploadAsset,
      onDeleteAsset: !writable ? undefined : handleDeleteAsset,
      onMoveAsset: !writable ? undefined : handleMoveAsset,
      beforeFileChange: !writable ? undefined : beforeFileChange,
      onFilesChanged: !writable ? undefined : onFilesChanged,
      readOnly: !writable,
      autoSave: true,
      draftMode: remote,
      remoteBase: draft?.base || (committed && typeof committed.content === 'string' ? committed : undefined),
      conflictReason: draft?.blocked,
      onMarkConflict: remote
        ? (reason, draft, base) => {
          stageWorkingNote(draft, base, reason);
        }
        : undefined,
      onReadRemote: remote && draft?.base === null ? undefined : (path: string) => readNote(path, note.notebookId),
      branch: repository?.branch ?? '',
      draftScope: repository ? draftScope(repository) : '',
    };
  };
  const closeZoom = () => {
    setEditingNote(null);
    const trail = noteTrail(location.state);
    const previous = trail[trail.length - 1];
    if (previous) navigate(previous, { replace: true, state: trail.length > 1 ? { noteTrail: trail.slice(0, -1) } : null });
    else navigate(returnTo, { replace: true });
  };

  // The browse region's toggle, where the Notes toolbar shows one: collapsing it folds the sidebar and the header away with it so the Focus gets the room.
  // Only where that toggle can bring them back, so no page and no screen size is left without navigation.
  const browseDock = activeTab === 'notes' && !route.study && noteFocus.layout && focusCapacity !== 1 ? { collapsed: noteFocus.view.dock.collapsed, toggle: () => noteFocus.setDock({ collapsed: !noteFocus.view.dock.collapsed }) } : undefined;
  // A zoomed note covers the page and has no Focus under it; the sidebar and header keep their fold meanwhile, so closing the zoom does not replay the animation.
  const browseCollapsed = Boolean(browseDock?.collapsed) || (activeTab === 'notes' && !route.study && focusCapacity !== 1 && noteEditorOpen && noteFocus.view.dock.collapsed);
  const headerFolding = useFoldAnimation(browseCollapsed);
  const { focusCommands, shortcutMode, setShortcutMode } = useShortcutSurface({ noteFocus, focusDisplay, t, showFocus, requestClear, zoomFocusNote, focusCapacity, browseDock });
  const noteSearch = useRef<NoteSearchHandle>(null);
  // Searching from another page opens Notes, then focuses the toolbar search once it has rendered.
  const noteSearchPending = useRef(false);
  const focusNoteSearch = () => {
    if (noteSearch.current) return noteSearch.current.focus();
    if (activeTab === 'notes') return;
    noteSearchPending.current = true;
    void setActiveTab('notes');
  };
  useEffect(() => {
    if (!noteSearchPending.current || activeTab !== 'notes') return;
    noteSearchPending.current = false;
    noteSearch.current?.focus();
  }, [activeTab]);
  useAppCommands({ t, setActiveTab: tab => void setActiveTab(tab), canCreateNote: canWrite, createNote: () => void createNote(), focusNoteSearch, noteEditorOpen, pageCommands: focusCommands });

  // With a Focus displayed, the browse region docks beside it (flat, folder) or above it (kanban).
  const topDock = viewMode === 'kanban';
  const browseFocusMode = noteFocus.layout ? { onZoomNote: (note: NoteListItem) => void handleOpenNote(note), canDrag: (note: NoteListItem) => noteFocus.editable && note.notebookId === selectedNotebookId } : undefined;
  // Either dock collapses and reopens from the toolbar's left end.
  const dockToggle = noteFocus.layout && focusCapacity !== 1 ? <BrowseDockToggle placement={topDock ? 'top' : 'left'} collapsed={noteFocus.view.dock.collapsed} onCollapsedChange={collapsed => noteFocus.setDock({ collapsed })} /> : undefined;
  // An outline or compilation list offers its own kind; every kind starts at the notebook root, moved from its editor.
  const newKind = route.kind === 'outline' || route.kind === 'compilation' ? route.kind : 'note';
  const createNewKind = () => {
    if (newKind === 'outline') void createNote({ kind: 'outline' });
    else if (newKind === 'compilation') void createUntitledCompilation();
    else void createNote();
  };
  // The index names its folder, or the notebook at its root, so it reads as that folder's page rather than a note called "Index".
  const indexFolderName = selectedFolder ? breadcrumbs[breadcrumbs.length - 1].name : config?.notebooks.find(nb => nb.id === selectedNotebookId)?.title ?? '';
  // Held here, not in the list, so a folder stays collapsed when the list moves between the table and cards or beside a docked panel.
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
      <LegacySchemaNotice schemaVersion={config?.schema_version} />
      {actionError && <p role='alert' className='mb-3 text-sm text-danger'>{actionError}</p>}
      {selectedNotes.length > 0 && <BulkActionsToolbar count={selectedNotes.length} statuses={notebookStatuses} availableTags={availableTags} busy={bulkBusy} readOnly={!canWrite} canMove={Boolean(bulkMoveNotebookId)} onSetStatus={status => void runBulkStatus(status)} onAddTag={tag => void runBulkTag('add', tag)} onRemoveTag={tag => void runBulkTag('remove', tag)} onMove={() => setBulkMoveOpen(true)} onClear={clearSelection} />}
      {staleNotice && <p role='alert' className='mb-3 text-sm text-warning'>{staleNotice}</p>}
      {listResult.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: listResult.error })}</p>}
      {facetsQuery.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.countsFailed', { message: facetsQuery.error })}</p>}
      {indexLookup.error && <p role='alert' className='mb-3 text-sm text-danger'>{t('notes.loadFailed', { message: indexLookup.error })}</p>}
      {listResult.loading && <LoadingStatus className='mb-3 text-sm text-muted'>{t('notes.loading')}</LoadingStatus>}
      {!folderless && (
        <>
          <Breadcrumbs segments={breadcrumbs} currentFolder={selectedFolder} onSelectFolder={setSelectedFolder} subfolderCount={immediateSubfolders.length} noteCount={listResult.total} />
          <FolderLinks folders={immediateSubfolders} onSelect={setSelectedFolder}>{folderIndex && <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} />}</FolderLinks>
        </>
      )}
      {(viewMode === 'list' || viewMode === 'flat') && (
        <>
          <NoteCollection showMobileSort={false} focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} canDelete={canWrite} confirmDelete={remote} notes={displayedNotes} loading={listResult.loading} uncommitted={listResult.uncommitted} hasFolderEntries={immediateSubfolders.length > 0 || Boolean(folderIndex)} onOpenNote={note => void openFromBrowse(note)} onDeleteNote={handleDeleteNote} onMoveNote={note => noteMove.moveNote(note)?.()} onUpdateNoteStatus={handleUpdateNoteStatus} newKind={newKind} onNewNote={createNewKind} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} tagActions={noteTagActions} leading={viewMode === 'flat' && folderIndex ? <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} /> : undefined} highlightQuery={debouncedSearch} selectedKeys={selectedKeys} onToggleSelect={toggleSelect} groupOf={noteGroupOf} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} />
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
          onMoveNote={note => noteMove.moveNote(note)?.()}
          onNewNoteWithStatus={(status) => {
            void createNote(status);
          }}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={handleSortChange}
          selectedKeys={selectedKeys}
          onToggleSelect={toggleSelect}
        />
      )}
    </>
  );
  // The toolbar search dims what the Focus shows that it does not match; on a phone it only filters the list.
  const phone = usePhone();
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
      onOpenNote={note => void (async () => {
        if (pane === undefined || !await openInFocus(note, pane, 'beside')) await handleOpenNote(note);
      })()}
      onOpenFolder={openCompilationFolder}
      onClose={pane === undefined ? closeZoom : undefined}
    />
  );

  // A note opened from a zoomed compilation leaves that compilation mounted behind it.
  const behindPath = trailCompilation(location.state, editorRoute.notebook, config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root ?? '');
  const compilationBehind = behindPath ? { notebookId: selectedNotebookId, path: behindPath } : null;
  if (loading || loadError) return <ConnectionState loading={loading} error={loadError} onRetry={refreshWorkspace} />;
  if (route.legacyScreen) return <LegacyScreenRedirect laneId={route.legacyLane} notebooks={config?.notebooks || []} onMissing={setActionError} />;

  const content = (
    <CompilationActionsProvider value={compilationActions}>
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
              {defaultRepository?.manifest === 'derived' && defaultRepository.config && <DerivedManifestNotice repository={defaultRepository.id} config={defaultRepository.config} configRevision={defaultRepository.configRevision} canWrite={manifestWritable} onCreated={() => refreshWorkspace(true)} />}
              {/* Top Header */}
              <div className='workspace-header-fold' data-folded={browseCollapsed || undefined} data-animating={headerFolding || undefined} {...(browseCollapsed ? { inert: '' } : {})}>
                <Header unavailableNotebooks={repositories.filter(repository => repository.unavailable).flatMap(repository => repository.notebooks)} workspaceTitle={currentRepository?.title || 'MyGitNotes'} notebookGroups={notebookGroups} accountControls={renderAccountControls ? renderAccountControls({ local: !remote }) : <AuthControls local={!remote} />} notebooks={config?.notebooks || []} selectedNotebookId={selectedNotebookId} onSelectNotebook={id => void setSelectedNotebookId(id)} notebookDisabled={loading || resourceNavigationBusy || notebookSwitchBusy} activeTab={activeTab} setActiveTab={setActiveTab} onCreateNote={() => void createNote()} createNoteDisabled={!canWrite} onOpenCommands={() => setShortcutMode('palette')} navigationDisabled={noteEditorOpen || isCommitOpen} />
              </div>
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
                    hasSidebar={activeTab !== 'graph' && !route.study}
                    sidebarCollapsed={browseCollapsed}
                    sidebarDomId={activeTab === 'notes' ? 'notebook-panel' : activeTab === 'agent' ? 'agent-sidebar-panel' : activeTab === 'assets' ? 'assets-sidebar-panel' : activeTab === 'settings' ? 'settings-sidebar-panel' : undefined}
                    closeLabel={t('sidebar.closeFilters')}
                    rightPanelWidth={rightPanelWidth}
                    rightPanel={
                      <RightPanel
                        documentPanel={activeTab === 'notes' && noteFocus.layout ? { enabled: activePaneNote, onContainer: setDocumentContainer } : undefined}
                        fileMode={activeTab === 'assets'}
                        metadataOpen={fileMetadataOpen}
                        onMetadataOpenChange={setFileMetadataOpen}
                        fileMetadata={selectedFileEntry
                          ? (
                            <FileMetadata
                              entry={selectedFileEntry}
                              onEdit={canWrite && !resourceNavigationBusy
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
                        onSynced={remote ? undefined : async () => {
                          await refreshWorkspace();
                          await refreshDocuments();
                        }}
                        repositoryHeading={repositoryHeading}
                        syncTargets={remote ? undefined : repositories.filter(repository => !repository.unavailable).map(repository => ({ id: repository.id, label: repository.repository ?? repository.id.replace(/^local:/, ''), gitStatus: repository.id === sourceId ? gitStatus : repository.gitStatus ?? null }))}
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
                    {!notebookUnavailable && activeTab === 'notes' && !route.study && (
                      <>
                        <WorkspaceSidebarPortal>
                          <Sidebar
                            selectedNotebookId={selectedNotebookId}
                            folders={folders}
                            foldersLoading={foldersLoading}
                            onManageFiles={openFileManager}
                            foldersWritable={canWrite}
                            filters={filterProps}
                            facets={facetsQuery.facets}
                            facetsLoading={facetsQuery.loading}
                            facetsError={facetsQuery.error}
                            workspaceTagNames={workspaceTagNames}
                            beforeFolderChange={command => beforeFileChange(folderCommandScope(command, config?.notebooks.find(nb => nb.id === command.notebookId)?.root ?? ''))}
                            onFoldersChanged={async () => {
                              await refreshWorkspace(remote);
                              await refreshDocuments();
                            }}
                            selectedFolder={selectedFolder}
                            onSelectFolder={setSelectedFolder}
                            onDropNote={(note, folder) => void noteMove.moveTo({ ...note, title: '' }, folder)}
                            changeCount={changeCount}
                            onPulled={remote ? undefined : async () => {
                              await refreshWorkspace();
                              await refreshDocuments();
                            }}
                            repoRoot={repoRoot}
                            canManageTags={canWrite}
                            onPreviewTagUsage={previewTagUsage}
                            onRenameTag={handleRenameTag}
                            onMergeTag={handleMergeTag}
                            onDeleteTag={handleDeleteTag}
                          />
                        </WorkspaceSidebarPortal>
                        {/* Main Content Area */}
                        <main className='workspace-main notes-main'>
                          <PageToolbar>
                            {dockToggle}
                            <NoteToolbar searchRef={noteSearch} onImportLegacy={() => setLegacyImportOpen(true)} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} groupByFolder={groupable ? { value: route.groupByFolder, onChange: setGroupByFolder } : undefined} readOnly={!canWrite} viewMode={viewMode} setViewMode={setViewMode} hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null} showHidden={showHidden} onShowHiddenChange={value => changeFilters({ showHidden: value })} onNewNote={() => void createNote()} onNewOutline={() => void createNote({ kind: 'outline' })} onNewCompilation={() => void createUntitledCompilation()} templates={config?.notebooks.find(nb => nb.id === selectedNotebookId)?.templates} onNewFromTemplate={templateId => void createNote({ templateId })} query={searchQuery} onQueryChange={value => changeFilters({ q: value })} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} focusControls={<FocusControls splittable={focusCapacity === 'all'} focus={noteFocus} onShow={key => void showFocus(key)} onRequestClear={requestClear} confirmingClear={confirmingClear} onConfirmingClearChange={setConfirmingClear} onReload={() => void focusPage.reload()} browseToggle={focusCapacity === 1 ? { showing: focusNarrowView === 'browse', onToggle: () => setFocusNarrowView(view => view === 'browse' ? 'focus' : 'browse') } : undefined} />} />
                          </PageToolbar>
                          {noteFocus.layout
                            ? (
                              <BrowseDock placement={topDock ? 'top' : 'left'} size={topDock ? noteFocus.view.dock.top : noteFocus.view.dock.left} onSizeChange={size => noteFocus.setDock(topDock ? { top: size } : { left: size })} collapsed={noteFocus.view.dock.collapsed} narrow={focusCapacity === 1} narrowView={focusNarrowView} browse={browseRegion()}>
                                <FocusArea focus={noteFocus} capacity={focusCapacity} notebookRoot={folderRoot ?? ''} folders={folders} renderCompilation={renderCompilation} searchMatches={focusMatches} onZoomNote={zoomFocusNote} documentPanel={focusDocumentPanel} />
                              </BrowseDock>
                            )
                            : <div className='workspace-scroll'>{browseRegion()}</div>}
                        </main>
                      </>
                    )}
                    {activeTab === 'agent' && (
                      <main className='workspace-route agent-main'>
                        <AgentSystemView ref={agentSystemRef} notebooks={config?.notebooks || []} folders={folders} repositories={repositories} defaultRepository={sourceId} onBusyChange={setResourceNavigationBusy} remote={remote} onGitStatus={setGitStatus} />
                      </main>
                    )}
                    {!notebookUnavailable && activeTab === 'assets' && (
                      <main className='workspace-route assets-main has-sidebar-drawer'>
                        <FileManager key={`${sourceId}:${selectedNotebookId}`} ref={fileManagerRef} notebookId={selectedNotebookId} notebooks={config?.notebooks || []} onNotebookChange={id => void setSelectedNotebookId(id)} writable={canWrite} onSelectionChange={setSelectedFileEntry} metadataContainer={fileMetadataContainer} onShowMetadata={() => setFileMetadataOpen(true)} initialPath={new URLSearchParams(location.search).get('asset') || (new URLSearchParams(location.search).has('directory') ? `${folderRoot}/${config?.notebooks.find(nb => nb.id === selectedNotebookId)?.assets || 'assets'}${new URLSearchParams(location.search).get('directory') ? '/' + new URLSearchParams(location.search).get('directory') : ''}` : undefined)} onBusyChange={setResourceNavigationBusy} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} />
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
              {fileDialog && <FileManagerDialog notebookId={fileDialog.notebookId} notebooks={config?.notebooks || []} writable={canWrite} initialPath={fileDialog.path} movePath={fileDialog.movePath} initialOperation={fileDialog.initialOperation} showDocuments={fileDialog.showDocuments} beforeChange={beforeFileChange} onChanged={onFilesChanged} onOpenIndex={openFileIndex} onClose={() => setFileDialog(undefined)} />}
              {noteMove.request?.mode === 'move' && movingNotebook && <FolderPickerDialog notebooks={[movingNotebook]} folders={folders} title={t('files.moveNoteTitle', { title: noteMove.request.note.title || noteMove.request.note.path.split('/').pop() || '' })} initial={{ notebookId: movingNotebook.id, folder: noteFolder(noteMove.request.note.path, movingNotebook.root) }} confirmLabel={t('bulk.moveConfirm')} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={({ folder }) => void noteMove.confirmMove(folder)} />}
              {noteMove.request?.mode === 'rename' && <RenameNoteDialog path={noteMove.request.note.path} title={noteMove.request.note.title} busy={noteMove.busy} onClose={noteMove.cancel} onConfirm={title => void noteMove.confirmRename(title)} />}
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
              <EditorModal key={fileEditorRevision} note={routedNote} committed={routedCommitted && typeof routedCommitted.content === 'string' ? routedCommitted as NoteItem : undefined} loading={routedLoading} isOpen={noteEditorOpen} renderCompilation={renderCompilation} behind={compilationBehind} />
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
                writable={repositories.some(repository => repository.write)}
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
    </CompilationActionsProvider>
  );
  // A local workspace starts its Pi agent in the background, so the agent tab opens onto a warm session.
  return (
    <PiAgentProvider webTools={remote ? webAgentTools : undefined} enabled={agentEnabled} defaultRepository={sourceId} notebooks={config?.notebooks ?? NO_NOTEBOOKS} repositories={repositories}>
      <AgentFocusCommand />
      <OutlineActionsProvider value={outlineActions.value}>
        {/* The shell and the assistant dock share a row; the dock is part of the layout, not an overlay on it. */}
        <div className='app-frame'>
          <StatusColorProvider statuses={statusEntries}>{content}</StatusColorProvider>
          <AssistantDock onOpenAgents={() => setActiveTab('agent')} agentsDisabled={noteEditorOpen || isCommitOpen} />
        </div>
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
