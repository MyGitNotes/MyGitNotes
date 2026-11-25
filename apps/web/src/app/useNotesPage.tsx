import type { NoteListItem } from '@mygitnotes/core/note-query';
import React, { useMemo, useState } from 'react';
import { Maximize2, PanelLeft } from 'lucide-react';
import { AccountControls } from '../components/AuthControls.js';
import { BrowseColumns, LIST_COLUMN_ID, NOTEBOOK_COLUMN_ID } from '../components/BrowseColumns.js';
import { Breadcrumbs } from '../components/Breadcrumbs.js';
import { FilterChips } from '../components/FilterChips.js';
import { FocusNoteList } from '../components/FocusNoteList.js';
import { FoldedNoteDots } from '../components/FoldedNoteDots.js';
import { FolderIndex } from '../components/FolderIndex.js';
import { FolderLinks } from '../components/FolderLinks.js';
import { HeaderUtilities } from '../components/Header.js';
import { KanbanView } from '../components/KanbanView.js';
import { KanbanStatusList } from '../components/kanban/KanbanStatusList.js';
import { LegacySchemaNotice } from '../components/LegacySchemaNotice.js';
import { ListFilterButtons } from '../components/ListFilterButtons.js';
import { LoadingStatus } from '../components/LoadingStatus.js';
import type { useNotebookAppearance } from '../components/NotebookAppearance.js';
import { NotebookColumn } from '../components/NotebookColumn.js';
import { NotebookTree } from '../components/NotebookTree.js';
import { type FolderChoice, NoteListColumn } from '../components/NoteListColumn.js';
import { NoteListSentinel } from '../components/NoteListSentinel.js';
import { PhoneBrowseList } from '../components/PhoneBrowseList.js';
import { PhoneFilterSheet, PhoneListBar } from '../components/PhoneListBar.js';
import { Sidebar } from '../components/Sidebar.js';
import { Tooltip } from '../components/Tooltip.js';
import { WorkspaceSidebarPortal } from '../components/WorkspaceChrome.js';
import type { FolderCommand } from '@mygitnotes/core';
import { browsePath, phoneBrowseLayout } from '../lib/browse-layout.js';
import { folderCommandScope } from '../lib/file-change-scope.js';
import { isEmptyFocus } from '../lib/focus-view.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { listFacets } from '../lib/list-facets.js';
import type { DraggedNote } from '../lib/note-drag.js';
import { noteFolderGrouping } from '../lib/note-groups.js';
import type { WorkspaceTab } from '../lib/routes.js';
import type { NotebookConfig } from '../lib/types.js';
import type { useBrowseFacets } from './useBrowseFacets.js';
import type { BrowseColumns as BrowseColumnsState } from './useBrowseColumns.js';
import type { BoardPlacementState } from './useBoardPlacement.js';
import type { useBrowseNotes } from './useBrowseNotes.js';
import type { useBrowseRoute } from './useBrowseRoute.js';
import type { useCreateNote } from './useCreateNote.js';
import type { useDeletionUndo } from './useDeletionUndo.js';
import type { useFileNavigation } from './useFileNavigation.js';
import type { useFilterSidebar } from './useFilterSidebar.js';
import type { useFocusNoteNavigation } from './useFocusNoteNavigation.js';
import type { useFocusPanes } from './useFocusPanes.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useNoteMove } from './useNoteMove.js';
import type { useNoteRestoration } from './useNoteRestoration.js';
import type { useNoteSearchFocus } from './useNoteSearchFocus.js';
import type { useNoteSelection } from './useNoteSelection.js';
import type { useNoteSort } from './useNoteSort.js';
import type { useShortcutSurface } from './useShortcutSurface.js';
import type { useTagWorkspaceOperations } from './useTagWorkspaceOperations.js';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';
import type { useWorkspaceOverview } from './useWorkspaceOverview.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  phone: boolean;
  /** Whether a phone shows the Notes page, and whether it shows its note screen rather than its list screen. */
  phoneNotes: boolean;
  phoneNoteScreen: boolean;
  t: I18nContextValue['t'];
  config: WorkspaceState['config'];
  remote: WorkspaceState['remote'];
  loading: WorkspaceState['loading'];
  folders: WorkspaceState['folders'];
  foldersLoading: WorkspaceState['foldersLoading'];
  actionError: WorkspaceState['actionError'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  refreshDocuments: () => Promise<void>;
  staleNotice: ReturnType<typeof useWorkspaceNotes>['staleNotice'];
  readNoteForChange: ReturnType<typeof useWorkspaceNotes>['readNoteForChange'];
  notebookGroups: ReturnType<typeof useWorkspaceOverview>['notebookGroups'];
  unavailableNotebooks: ReturnType<typeof useWorkspaceOverview>['unavailableNotebooks'];
  route: ReturnType<typeof useBrowseRoute>['route'];
  activeTab: WorkspaceTab;
  selectedNotebookId: string;
  selectedNotebook: NotebookConfig | undefined;
  selectedFolder: string | null;
  folderRoot: string | undefined;
  showHidden: boolean;
  canWrite: boolean;
  canWriteFiles: boolean;
  filtersOpen: ReturnType<typeof useFilterSidebar>['filtersOpen'];
  setFiltersOpen: ReturnType<typeof useFilterSidebar>['setFiltersOpen'];
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  facets: ReturnType<typeof useBrowseFacets>;
  browse: ReturnType<typeof useBrowseNotes>;
  sort: ReturnType<typeof useNoteSort>;
  selection: ReturnType<typeof useNoteSelection>;
  tags: ReturnType<typeof useTagWorkspaceOperations>;
  bulkToolbar: React.ReactNode;
  noteFocus: ReturnType<typeof useFocusPanes>['noteFocus'];
  activeNotePath: ReturnType<typeof useFocusPanes>['activeNotePath'];
  columns: BrowseColumnsState;
  /** Whether the Notes page shows its three columns, and how the list presents its notes there. */
  notesColumns: boolean;
  presentation: 'kanban' | 'list';
  /** Where the board stands beside the Focus, and the actions that fold and unfold it. */
  board: BoardPlacementState;
  noteSearch: ReturnType<typeof useNoteSearchFocus>['noteSearch'];
  focusNoteSearch: ReturnType<typeof useNoteSearchFocus>['focusNoteSearch'];
  notebookAppearance: ReturnType<typeof useNotebookAppearance>;
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  openFromBrowse: ReturnType<typeof useFocusNoteNavigation>['openFromBrowse'];
  handleDeleteNote: ReturnType<typeof useDeletionUndo>['handleDeleteNote'];
  handleUpdateNoteStatus: ReturnType<typeof useNoteRestoration>['handleUpdateNoteStatus'];
  noteMove: ReturnType<typeof useNoteMove>;
  createNote: ReturnType<typeof useCreateNote>['createNote'];
  createUntitledCompilation: () => Promise<void>;
  openFileManager: ReturnType<typeof useFileNavigation>['openFileManager'];
  beforeFileChange: ReturnType<typeof useFileNavigation>['beforeFileChange'];
  /** The phone drawer's page links: whether they are locked, and the command palette they open. */
  navigationDisabled: boolean;
  setShortcutMode: ReturnType<typeof useShortcutSurface>['setShortcutMode'];
}

/** The Notes page's views: its browse region (the list or board with its notices), the folders and filters beside it, a phone's screens and the three columns. */
export function useNotesPage({ phone, phoneNotes, phoneNoteScreen, t, config, remote, loading, folders, foldersLoading, actionError, refreshWorkspace, refreshDocuments, staleNotice, readNoteForChange, notebookGroups, unavailableNotebooks, route, activeTab, selectedNotebookId, selectedNotebook, selectedFolder, folderRoot, showHidden, canWrite, canWriteFiles, filtersOpen, setFiltersOpen, navigation, facets, browse, sort, selection, tags, bulkToolbar, noteFocus, activeNotePath, columns, notesColumns, presentation, board, noteSearch, focusNoteSearch, notebookAppearance, handleOpenNote, openFromBrowse, handleDeleteNote, handleUpdateNoteStatus, noteMove, createNote, createUntitledCompilation, openFileManager, beforeFileChange, navigationDisabled, setShortcutMode }: Params) {
  const { changeFilters, setActiveTab, resourceNavigationBusy, notebookSwitchBusy, setSelectedNotebookId, setSelectedFolder, setViewMode, setGroupByFolder } = navigation;
  const { facetsQuery, notebookFacets, notebookStatuses, workspaceTagNames, searchQuery, viewMode, folderless } = facets;
  const { folderIndex, baseQuery, listResult, displayedNotes, filterProps, immediateSubfolders, breadcrumbs, indexLookup, highlightQuery, groupable, groupedByFolder } = browse;
  const { sortField, sortOrder, handleSortChange, metadataSortFields } = sort;
  const { selectedKeys, toggleSelect } = selection;
  const { previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag } = tags;
  /** The notebook whose folders the person folded under its row in the notebooks column; another notebook opens unfolded. */
  const [foldedTree, setFoldedTree] = useState<string | null>(null);
  const [phoneFilterOpen, setPhoneFilterOpen] = useState(false);
  // A shown Focus (Default or named) with no open note: a phone's list screen then shows the list alone, without the folders under it.
  const focusEmpty = Boolean(noteFocus.layout && isEmptyFocus(noteFocus.layout));
  // Beside a Focus of several panes, or by the person's choice, the board folds into the list column as a status list.
  const boardFolded = board.placement === 'folded';
  const browseFocusMode = noteFocus.layout || phone || presentation === 'list' ? { onZoomNote: (note: NoteListItem) => void handleOpenNote(note), canDrag: (note: NoteListItem) => !phone && noteFocus.editable && note.notebookId === selectedNotebookId, rowMeta: !phone && presentation === 'list', openPath: activeNotePath, readNote: readNoteForChange } : undefined;
  // A phone's list screen beside a Focus shows the path line over the list, and the chips of the filters in force where the filters are out of sight.
  const layout = phoneBrowseLayout({ phone, focusShown: activeTab === 'notes' && !route.study && Boolean(noteFocus.layout) && !focusEmpty, viewMode });
  /** Whether the folders show beside the list (the notebooks column, or a phone's drawer while the path line names the folder), so the list keeps only the folder's index. */
  const folderTree = !phone || layout.path;
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
      {bulkToolbar}
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
      {viewMode === 'kanban' && boardFolded && (
        <>
          {folderIndex && <FolderIndex note={folderIndex} folder={indexFolderName} onOpenNote={note => void openFromBrowse(note)} />}
          <KanbanStatusList focusMode={browseFocusMode} statuses={notebookStatuses} readOnly={!canWrite} query={baseQuery} hiddenNote={folderIndex} onOpenNote={note => void openFromBrowse(note)} onUpdateNoteStatus={handleUpdateNoteStatus} sortField={sortField} sortOrder={sortOrder} selectedKeys={selectedKeys} onToggleSelect={toggleSelect} />
        </>
      )}
      {viewMode === 'kanban' && !boardFolded && (
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
  /** A phone's list screen: beside a Focus the path line over the list, and the list. */
  const phoneList = (withPath: boolean) => {
    const path = browsePath({ kind: route.kind, notebookTitle: selectedNotebook?.title ?? '', breadcrumbs, labels: { outline: t('outline.list'), compilations: t('sidebar.compilations') } });
    const count = filterProps.count;
    return (
      <PhoneBrowseList
        path={withPath && (
          <>
            <Tooltip label={path}>
              <span className='phone-browse-path-text'>{path}</span>
            </Tooltip>
            {count === null ? <LoadingStatus as='span' className='phone-browse-count'>{t('notes.countsLoading')}</LoadingStatus> : <span className='phone-browse-count'>{t(count === 1 ? 'folder.noteCount' : 'folder.notesCount', { count })}</span>}
          </>
        )}
      >
        {browseRegion()}
      </PhoneBrowseList>
    );
  };
  const beforeFolderChange = (command: FolderCommand) => beforeFileChange(folderCommandScope(command, config?.notebooks.find(nb => nb.id === command.notebookId)?.root ?? ''));
  const onFoldersChanged = async () => {
    await refreshWorkspace(remote);
    await refreshDocuments();
  };
  const dropNoteOnFolder = (note: DraggedNote, folder: string | null) => void noteMove.moveTo({ ...note, title: '' }, folder);
  /** A phone's drawer of notebooks and filters on two tabs; its filter sheet shows only the status and tags. */
  const renderSidebar = (filtersOnly = false) => <Sidebar selectedNotebookId={selectedNotebookId} folders={folders} foldersLoading={foldersLoading} onManageFiles={openFileManager} foldersWritable={canWriteFiles} filters={filterProps} facets={facetsQuery.facets} facetsLoading={facetsQuery.loading} facetsError={facetsQuery.error} workspaceTagNames={workspaceTagNames} beforeFolderChange={beforeFolderChange} onFoldersChanged={onFoldersChanged} selectedFolder={selectedFolder} onSelectFolder={setSelectedFolder} onDropNote={dropNoteOnFolder} canManageTags={canWriteFiles} onPreviewTagUsage={previewTagUsage} onRenameTag={handleRenameTag} onMergeTag={handleMergeTag} onDeleteTag={handleDeleteTag} filtersOnly={filtersOnly} tabbed={!filtersOnly} />;
  /** The Notes page below the header: a phone's list or note screen with its drawer, or the three columns. */
  const renderNotesPage = (focusArea: React.ReactNode) => {
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
        onPresentationChange={next => {
          if (next !== presentation) setViewMode(next === 'kanban' ? 'kanban' : 'flat');
        }}
        onCollapse={presentation === 'list' || boardFolded ? columns.toggleList : undefined}
        expandBoard={boardFolded ? { onExpand: board.unfold } : undefined}
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
            sortable={presentation !== 'kanban' || boardFolded}
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
    // At the Focus's top left while the board stands beside it: fold the board into the list column, the Focus taking the room.
    const foldLabel = t('kanban.foldBoard');
    const foldBoard = (
      <Tooltip label={foldLabel} detail={t('kanban.foldBoardDetail')}>
        <button type='button' className='ui-icon-button browse-column-toggle' aria-label={foldLabel} onClick={board.fold}>
          <Maximize2 size={16} aria-hidden='true' />
        </button>
      </Tooltip>
    );
    return (phone
      ? (
        <>
          <WorkspaceSidebarPortal>
            <HeaderUtilities className='phone-drawer-utilities' activeTab={activeTab} setActiveTab={setActiveTab} navigationDisabled={navigationDisabled} onOpenCommands={() => setShortcutMode('palette')} accountControls={<AccountControls local={!remote} />} /> {renderSidebar()}
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
            {noteFocus.layout && !focusEmpty ? <div className='phone-notes-screen'>{phoneNoteScreen ? <div className='phone-notes-focus'>{focusArea}</div> : phoneList(layout.path)}</div> : phoneList(false)}
          </main>
        </>
      )
      : (
        <main className='workspace-main notes-main'>
          <BrowseColumns layout={columns.layout} measure={columns.measure} presentation={presentation} focusOpen={Boolean(noteFocus.layout) && !focusEmpty} boardFolded={boardFolded} notebooks={notebookColumn} list={listColumn} note={noteFocus.layout ? focusArea : <p className='browse-note-empty'>{t('browse.noFocus')}</p>} restore={restoreColumns} fold={foldBoard} />
        </main>
      ));
  };
  const phoneFilterSheet = phoneNotes && phoneFilterOpen && <PhoneFilterSheet onClose={() => setPhoneFilterOpen(false)} sortField={sortField} sortOrder={sortOrder} onSortChange={handleSortChange} metadataSortFields={metadataSortFields} viewMode={viewMode} setViewMode={setViewMode} showHidden={showHidden} hiddenNoteCount={facetsQuery.facets ? notebookFacets.hidden : null} onShowHiddenChange={value => changeFilters({ showHidden: value })} groupByFolder={groupable ? { value: route.groupByFolder, onChange: setGroupByFolder } : undefined}>{renderSidebar(true)}</PhoneFilterSheet>;
  return { renderNotesPage, phoneFilterSheet };
}
