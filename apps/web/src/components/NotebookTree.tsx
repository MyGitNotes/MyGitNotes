import type { MouseEvent } from 'react';
import { BookOpen, GalleryHorizontalEnd, ListTree } from 'lucide-react';
import type { FolderCommand } from '@mygitnotes/core';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import type { DraggedNote } from '../lib/note-drag.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { FolderAction } from './FolderActions.js';
import { FolderTree, NoteDropTarget } from './FolderTree.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NavTreeRow } from './NavTree.js';
import { hasNotebookMark, NotebookMark } from './NotebookMark.js';

export interface NotebookTreeProps {
  /** The open notebook. */
  notebook: NotebookConfig;
  filters: FilterControls;
  facets?: Record<string, NotebookFacets>;
  folders: FolderItem[];
  foldersLoading: boolean;
  foldersWritable: boolean;
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  onManageFiles: (notebookId: string, path: string, action?: FolderAction) => void;
  beforeFolderChange?: (command: FolderCommand) => Promise<void>;
  onFoldersChanged?: () => Promise<void>;
  /** Moves a note dropped on a folder of the notebook (null for the notebook itself). */
  onDropNote?: (note: DraggedNote, folder: string | null) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Opens or closes every folder at once (the sidebar's expand and collapse all). */
  folderExpandCommand?: { expanded: boolean; };
  /** The notebook row's context menu, where the page offers 「外觀…」. */
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * The open notebook's row with its folders under it, then its outlines and compilations: the sidebar's and the notebooks
 * column's tree of the notebook. The row shows the notebook's mark where it has one; every row is named by a tooltip.
 */
export function NotebookTree({ notebook: nb, filters, facets, folders, foldersLoading, foldersWritable, selectedFolder, onSelectFolder, onManageFiles, beforeFolderChange, onFoldersChanged, onDropNote, expanded, onToggleExpanded, folderExpandCommand, onContextMenu }: NotebookTreeProps): JSX.Element {
  const { t } = useTranslation();
  const { value, onChange } = filters;
  const root = nb.root.replace(/\/$/, '');
  const selectedPaths = value.folders.filter(path => path.startsWith(root + '/')).map(path => path.slice(root.length + 1));
  const count = facets ? facets[nb.id]?.total ?? 0 : null;
  const hasFolders = folders.some(folder => folder.notebookId === nb.id);
  const compilationList = value.kind === 'compilation';
  const outlineList = value.kind === 'outline';
  const isSelected = !compilationList && !outlineList && selectedFolder === null && value.folders.length === 0;
  const compilationCount = facets ? facets[nb.id]?.compilations.total ?? 0 : null;
  const outlineCount = facets ? facets[nb.id]?.outlines.total ?? 0 : null;
  const counted = (count: number | null, key: 'folder.noteCount' | 'folder.notesCount' | 'outline.count' | 'sidebar.compilationCount') => count === null ? t('notes.countsLoading') : t(key, { count });
  return (
    <section className='sidebar-notebook-group' data-selected={isSelected || selectedPaths.length > 0}>
      <NoteDropTarget className='sidebar-notebook-drop' onDrop={foldersWritable && onDropNote ? note => note.notebookId === nb.id && onDropNote(note, null) : undefined}>
        <NavTreeRow hasChildren isExpanded={expanded} onToggleExpand={onToggleExpanded} icon={hasNotebookMark(nb) ? <NotebookMark notebook={nb} size='row' /> : <BookOpen size={16} />} title={nb.title} selected={isSelected} onSelect={() => onSelectFolder(null)} suffix={<span className='sidebar-notebook-count'>{count ?? '—'}</span>} tooltip={{ detail: counted(count, count === 1 ? 'folder.noteCount' : 'folder.notesCount') }} buttonProps={onContextMenu && { onContextMenu }} />
      </NoteDropTarget>
      <div id={`notebook-folders-${nb.id}`} hidden={!expanded} className='sidebar-notebook-folders'>{hasFolders ? <FolderTree onManageFiles={(path, action) => onManageFiles(nb.id, path, action)} folders={folders} notebookId={nb.id} selected={selectedFolder} onSelect={onSelectFolder} allFoldersSelected={value.folders.length === 0} selectedPaths={selectedPaths} writable={foldersWritable} beforeChange={beforeFolderChange} onChanged={onFoldersChanged} onDropNote={onDropNote} expandCommand={folderExpandCommand} /> : foldersLoading ? <LoadingStatus className='sidebar-notebook-empty'>{t('folder.loading')}</LoadingStatus> : <p className='sidebar-notebook-empty'>{t('folder.subfolderCount', { count: 0 })}</p>}</div>
      <NavTreeRow icon={<ListTree size={16} />} title={t('outline.list')} selected={outlineList} className='sidebar-compilations-row' onSelect={() => onChange({ kind: 'outline', folders: [] })} suffix={<span className='sidebar-notebook-count'>{outlineCount ?? '—'}</span>} tooltip={{ detail: counted(outlineCount, 'outline.count') }} />
      <NavTreeRow icon={<GalleryHorizontalEnd size={16} />} title={t('sidebar.compilations')} selected={compilationList} className='sidebar-compilations-row' onSelect={() => onChange({ kind: 'compilation', folders: [] })} suffix={<span className='sidebar-notebook-count'>{compilationCount ?? '—'}</span>} tooltip={{ detail: counted(compilationCount, 'sidebar.compilationCount') }} />
    </section>
  );
}
