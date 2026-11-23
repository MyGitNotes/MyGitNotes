import { Tooltip } from './Tooltip.js';
import './sidebar-filters.css';
import type { FilterControls } from '../lib/filter-controls.js';
import type { FolderAction } from './FolderActions.js';
import type { FolderCommand } from '@mygitnotes/core';
import type { DraggedNote } from '../lib/note-drag.js';
import React, { useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { FolderItem } from '../lib/types.js';
import { listFacets } from '../lib/list-facets.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NavTree } from './NavTree.js';
import { useSidebarSections } from '../lib/sidebar-sections.js';
import { SidebarLinks } from './SidebarLinks.js';
import { useSidebarLinks } from '../lib/web-features.js';
import { NotebookTree } from './NotebookTree.js';
import { StatusFilterBody, TagFilterBody } from './ListFilters.js';

interface SidebarProps {
  onManageFiles: (notebookId: string, path: string, action?: FolderAction) => void;
  folders?: FolderItem[];
  /** While the folder list is still arriving: folder filters are not yet known to be missing, nor notebooks empty. */
  foldersLoading?: boolean;
  foldersWritable?: boolean;
  filters: FilterControls;
  beforeFolderChange?: (command: FolderCommand) => Promise<void>;
  onFoldersChanged?: () => Promise<void>;
  selectedFolder?: string | null;
  onSelectFolder?: (folder: string | null) => void;
  /** Moves a note dropped on a folder of the open notebook (null for the notebook itself). */
  onDropNote?: (note: DraggedNote, folder: string | null) => void;
  selectedNotebookId: string;
  /** Per-notebook counts from `/api/notes/facets`, with staged drafts already applied. */
  facets?: Record<string, NotebookFacets>;
  facetsLoading?: boolean;
  facetsError?: string;
  workspaceTagNames: string[];
  canManageTags?: boolean;
  onPreviewTagUsage?: (tag: string) => Promise<number>;
  onRenameTag?: (from: string, to: string) => Promise<void>;
  onMergeTag?: (from: string, into: string) => Promise<void>;
  onDeleteTag?: (tag: string) => Promise<void>;
  /** The folder tree alone, under a phone's list beside a Focus (BrowseSplit), whose filter sheet holds the rest. */
  dock?: 'folders';
  /** Only the filters that narrow the list (status and tags): a phone's filter sheet, where the drawer already holds the notebook tree. */
  filtersOnly?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ folders = [], foldersLoading = false, onManageFiles, foldersWritable = false, beforeFolderChange, onFoldersChanged, selectedFolder = null, onSelectFolder, onDropNote, selectedNotebookId, facets, facetsLoading = false, facetsError = '', workspaceTagNames, filters, canManageTags = false, onPreviewTagUsage, onRenameTag, onMergeTag, onDeleteTag, filtersOnly = false, dock }) => {
  const { t } = useTranslation();
  const { value, onChange } = filters;
  const sections = useSidebarSections();
  // An edition's links, at the sidebar's foot; a phone's filter sheet (`filtersOnly`) shows them itself, below its own sections.
  const links = useSidebarLinks();
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(() => new Set(selectedNotebookId ? [selectedNotebookId] : []));
  const [expansionSelection, setExpansionSelection] = useState<{ notebookId: string; folders: typeof value.folders; notebooks: typeof filters.notebooks; }>();
  if (!expansionSelection || expansionSelection.notebookId !== selectedNotebookId || expansionSelection.folders !== value.folders || expansionSelection.notebooks !== filters.notebooks) {
    setExpansionSelection({ notebookId: selectedNotebookId, folders: value.folders, notebooks: filters.notebooks });
    const next = new Set(expandedNotebooks);
    if ((!expansionSelection || expansionSelection.notebookId !== selectedNotebookId) && selectedNotebookId) next.add(selectedNotebookId);
    if (!expansionSelection || expansionSelection.folders !== value.folders || expansionSelection.notebooks !== filters.notebooks) {
      for (const nb of filters.notebooks) if (value.folders.some(path => path.startsWith(nb.root.replace(/\/$/, '') + '/'))) next.add(nb.id);
    }
    setExpandedNotebooks(next);
  }
  const [folderExpandCommand, setFolderExpandCommand] = useState<{ expanded: boolean; }>();
  // Both commands reach the notebook level: expanding opens every notebook, collapsing closes them all.
  const expandAll = (expanded: boolean) => {
    setExpandedNotebooks(expanded ? new Set(filters.notebooks.map(nb => nb.id)) : new Set());
    setFolderExpandCommand({ expanded });
  };
  const counts = listFacets(filters, facets);
  const tagManagement = canManageTags && onPreviewTagUsage && onRenameTag && onMergeTag && onDeleteTag ? { workspaceTagNames, onPreviewUsage: onPreviewTagUsage, onRename: onRenameTag, onMerge: onMergeTag, onDelete: onDeleteTag } : undefined;

  const filterSummary = (
    <div className='sidebar-filter-summary'>
      {filters.count === null ? <LoadingStatus as='span'>{t('notes.countsLoading')}</LoadingStatus> : <span role='status' data-filter-results={filters.count}>{t('filters.results', { count: filters.count })}</span>}
      {/* The line above already says the counts are loading, so the facets only speak for themselves once it stops. */}
      {facetsLoading && filters.count !== null && <LoadingStatus as='span' className='sidebar-facets-status'>{t('notes.countsLoading')}</LoadingStatus>}
      {facetsError && <span role='alert' className='sidebar-facets-status'>{t('notes.countsFailed', { message: facetsError })}</span>}
      <button type='button' className='sidebar-clear-filters' onClick={filters.onClear}>{t('filters.clear')}</button>
    </div>
  );
  const expandControls = onSelectFolder && (
    <div className='sidebar-panel-actions' role='group' aria-label={t('sidebar.notebooks')}>
      <Tooltip label={t('folder.expandAll')}>
        <button type='button' className='ui-icon-button' aria-label={t('folder.expandAll')} onClick={() => expandAll(true)}>
          <ChevronsUpDown size={15} />
        </button>
      </Tooltip>
      <Tooltip label={t('folder.collapseAll')}>
        <button type='button' className='ui-icon-button' aria-label={t('folder.collapseAll')} onClick={() => expandAll(false)}>
          <ChevronsDownUp size={15} />
        </button>
      </Tooltip>
    </div>
  );
  const notebooksBody = (
    <NavTree aria-label={t('sidebar.notebooks')}>
      {filters.notebooks.filter(nb => nb.id === selectedNotebookId).map(nb => (
        <NotebookTree
          key={nb.id}
          notebook={nb}
          filters={filters}
          facets={facets}
          folders={folders}
          foldersLoading={foldersLoading}
          foldersWritable={foldersWritable}
          selectedFolder={selectedFolder}
          onSelectFolder={folder => onSelectFolder?.(folder)}
          onManageFiles={onManageFiles}
          beforeFolderChange={beforeFolderChange}
          onFoldersChanged={onFoldersChanged}
          onDropNote={onDropNote}
          expanded={expandedNotebooks.has(nb.id)}
          onToggleExpanded={() => {
            setExpandedNotebooks(previous => {
              const next = new Set(previous);
              if (next.has(nb.id)) next.delete(nb.id);
              else next.add(nb.id);
              return next;
            });
          }}
          folderExpandCommand={folderExpandCommand}
        />
      ))}
    </NavTree>
  );
  if (dock) {
    // A phone's list screen beside a Focus shows the notebook's folders under the list; its filter sheet holds the rest.
    return <div className='notes-sidebar phone-folders' data-dock={dock}>{facetsError && <p role='alert' className='sidebar-facets-status'>{t('notes.countsFailed', { message: facetsError })}</p>}{onSelectFolder && notebooksBody}</div>;
  }

  return (
    <WorkspaceSidebar label={t('sidebar.statusFilter')} className='notes-sidebar' footer={!filtersOnly && links.length > 0 ? <SidebarLinks links={links} variant='sidebar' /> : undefined}>
      <section className='sidebar-search' aria-label={t('filters.title')}>
        {!filtersOnly && <div className='sidebar-search-row'>{expandControls}</div>}
        {filterSummary}
        {!foldersLoading && value.folders.filter(path =>
          !filters.notebooks.some(nb => path === nb.root.replace(/\/$/, '')) && !folders.some(folder => {
            const root = filters.notebooks.find(nb => nb.id === folder.notebookId)?.root.replace(/\/$/, '');
            return path === `${root}/${folder.path}`;
          })
        ).map(path => (
          <button type='button' className='sidebar-missing-filter' key={path} aria-label={t('filters.remove', { value: path })} onClick={() => onChange({ folders: value.folders.filter(item => item !== path) })}>
            {path}
            <X size={12} />
          </button>
        ))}
      </section>
      {onSelectFolder && !filtersOnly && (
        <details className='sidebar-filter-section sidebar-notebooks' open={sections.isOpen('notebooks')} onToggle={event => sections.setOpen('notebooks', event.currentTarget.open)}>
          <summary>{t('sidebar.notebooks')}</summary>
          {notebooksBody}
        </details>
      )}
      {/* Status Filters */}
      <details open={sections.isOpen('status')} onToggle={event => sections.setOpen('status', event.currentTarget.open)} className='sidebar-filter-section'>
        <summary>{t('sidebar.status')}</summary>
        <StatusFilterBody filters={filters} counts={counts} />
      </details>
      {/* Tags Cloud */}
      {Object.keys(counts.tags).length > 0 && (
        <details open={sections.isOpen('tags')} onToggle={event => sections.setOpen('tags', event.currentTarget.open)} className='sidebar-filter-section' aria-label={t('sidebar.tags')}>
          <summary>{t('sidebar.tags')}</summary>
          <TagFilterBody filters={filters} counts={counts} notebookId={selectedNotebookId} management={tagManagement} />
        </details>
      )}
    </WorkspaceSidebar>
  );
};
