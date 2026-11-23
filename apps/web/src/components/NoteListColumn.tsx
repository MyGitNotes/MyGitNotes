import type { ReactNode } from 'react';
import { Kanban, List, PanelLeft, Table2 } from 'lucide-react';
import type { BrowsePresentation } from '../lib/browse-columns.js';
import { useTranslation } from '../lib/i18n/index.js';
import { LoadingStatus } from './LoadingStatus.js';
import { Select } from './Select.js';

/** A folder the list header's folder menu offers while the notebooks column is a rail; `value` is '' for the notebook's root. */
export interface FolderChoice {
  value: string;
  label: string;
}

export interface NoteListColumnProps {
  /** The column's element, which its fold toggle controls. */
  columnId: string;
  notebookTitle: string;
  /** Below the notebook: the folders down to the one shown, or the kind of list (outlines, compilations). */
  path: string[];
  /** The notes the list holds, or null while counting. */
  count: number | null;
  presentation: BrowsePresentation;
  onPresentationChange: (presentation: BrowsePresentation) => void;
  /** Folds the list away; absent while the list spans the note column (the table, the board). */
  onCollapse?: () => void;
  /** While the notebooks column is a rail, the folder is picked from the path instead. */
  folderMenu?: { folders: FolderChoice[]; value: string; onChange: (folder: string) => void; };
  /** The Status, Tags and Sort buttons under the header. */
  chips: ReactNode;
  /** The list, the table or the board. */
  children: ReactNode;
}

const PRESENTATIONS = [{ value: 'list', label: 'browse.viewList', Icon: List }, { value: 'table', label: 'browse.viewTable', Icon: Table2 }, { value: 'kanban', label: 'browse.viewKanban', Icon: Kanban }] as const;

/**
 * Column 2 of the Notes page: a header naming where the list is (notebook › folder) and how many notes it holds, the switch between the
 * list, the table and the board, and the toggle that folds the list away; then the Status, Tags and Sort buttons; then the list.
 */
export function NoteListColumn({ columnId, notebookTitle, path, count, presentation, onPresentationChange, onCollapse, folderMenu, chips, children }: NoteListColumnProps): JSX.Element {
  const { t } = useTranslation();
  const collapseLabel = t('browse.collapseList');
  return (
    <>
      <header className='browse-list-header'>
        <h2 className='browse-list-path' data-browse-content='' title={[notebookTitle, ...path].join(' › ')}>
          <span>{notebookTitle}</span>
          {folderMenu
            ? (
              <>
                <span className='browse-list-separator' aria-hidden='true'>›</span>
                <Select aria-label={t('browse.folder')} value={folderMenu.value} onValueChange={folderMenu.onChange} options={folderMenu.folders} />
              </>
            )
            : path.map((segment, index) => (
              <span key={`${index}:${segment}`} className='browse-list-segment'>
                <span className='browse-list-separator' aria-hidden='true'>›</span> {segment}
              </span>
            ))}
        </h2>
        <span className='browse-list-count' data-browse-content=''>{count === null ? <LoadingStatus as='span'>{t('notes.countsLoading')}</LoadingStatus> : t(count === 1 ? 'folder.noteCount' : 'folder.notesCount', { count })}</span>
        <div className='browse-view-switch' role='group' aria-label={t('browse.view')}>
          {PRESENTATIONS.map(({ value, label, Icon }) => (
            <button key={value} type='button' aria-label={t(label)} title={t(label)} aria-pressed={presentation === value} onClick={() => onPresentationChange(value)}>
              <Icon size={16} aria-hidden='true' />
            </button>
          ))}
        </div>
        {onCollapse && (
          <button type='button' className='ui-icon-button browse-column-toggle' data-column-toggle='' aria-label={collapseLabel} title={collapseLabel} aria-expanded='true' aria-controls={columnId} onClick={onCollapse}>
            <PanelLeft size={16} aria-hidden='true' />
          </button>
        )}
      </header>
      <div className='browse-list-filters'>{chips}</div>
      <div className='workspace-scroll browse-list-body' data-browse-content=''>{children}</div>
    </>
  );
}
