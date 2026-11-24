import type { ReactNode } from 'react';
import { Columns3, Kanban, List, PanelLeft } from 'lucide-react';
import type { BrowsePresentation } from '../lib/browse-columns.js';
import { useTranslation } from '../lib/i18n/index.js';
import { bindingsFor, keymapEntry } from '../lib/keyboard/keymap.js';
import { formatKeys } from '../lib/keyboard/keys.js';
import { keyEnvironment } from '../lib/keyboard/platform.js';
import { LoadingStatus } from './LoadingStatus.js';
import { type MarkedNotebook, NotebookMark } from './NotebookMark.js';
import { Select } from './Select.js';
import { Tooltip } from './Tooltip.js';

/** A folder the list header's folder menu offers while the notebooks column is a rail; `value` is '' for the notebook's root. */
export interface FolderChoice {
  value: string;
  label: string;
}

export interface NoteListColumnProps {
  /** The column's element, which its fold toggle controls. */
  columnId: string;
  notebookTitle: string;
  /** The notebook shown, whose mark goes before its name where it has one. */
  notebook?: MarkedNotebook;
  /** Below the notebook: the folders down to the one shown, or the kind of list (outlines, compilations). */
  path: string[];
  /** The notes the list holds, or null while counting. */
  count: number | null;
  presentation: BrowsePresentation;
  onPresentationChange: (presentation: BrowsePresentation) => void;
  /** Folds the list away; absent while the list spans the note column (the board). */
  onCollapse?: () => void;
  /** While the board is folded into the list column: 「展開看板」, which `onExpand` does, or explains why not while it is absent. */
  expandBoard?: { onExpand?: () => void; };
  /** While the notebooks column is a rail, the folder is picked from the path instead. */
  folderMenu?: { folders: FolderChoice[]; value: string; onChange: (folder: string) => void; };
  /** The Status, Tags and Sort buttons under the header. */
  chips: ReactNode;
  /** The list or the board. */
  children: ReactNode;
}

const PRESENTATIONS = [{ value: 'list', label: 'browse.viewList', Icon: List }, { value: 'kanban', label: 'browse.viewKanban', Icon: Kanban }] as const;

/**
 * Column 2 of the Notes page: a header naming where the list is (notebook › folder) and how many notes it holds, the switch between the
 * list and the board, and the toggle that folds the list away; then the Status, Tags and Sort buttons; then the list.
 */
export function NoteListColumn({ columnId, notebookTitle, notebook, path, count, presentation, onPresentationChange, onCollapse, expandBoard, folderMenu, chips, children }: NoteListColumnProps): JSX.Element {
  const { t } = useTranslation();
  const collapseLabel = t('browse.collapseList');
  const [collapseKeys] = bindingsFor(keymapEntry('browse.toggleList'), keyEnvironment);
  return (
    <>
      <header className='browse-list-header'>
        <Tooltip label={[notebookTitle, ...path].join(' › ')}>
          <h2 className='browse-list-path' data-browse-content=''>
            {notebook && <NotebookMark notebook={notebook} size='inline' />}
            {/* Beside the rail the folder picker takes the whole path, its root choice named after the notebook, so it is never cut short. */}
            {folderMenu ? <Select aria-label={t('browse.folder')} value={folderMenu.value} onValueChange={folderMenu.onChange} options={folderMenu.folders} /> : (
              <>
                <span>{notebookTitle}</span>
                {path.map((segment, index) => (
                  <span key={`${index}:${segment}`} className='browse-list-segment'>
                    <span className='browse-list-separator' aria-hidden='true'>›</span> {segment}
                  </span>
                ))}
              </>
            )}
          </h2>
        </Tooltip>
        <span className='browse-list-count' data-browse-content=''>{count === null ? <LoadingStatus as='span'>{t('notes.countsLoading')}</LoadingStatus> : t(count === 1 ? 'folder.noteCount' : 'folder.notesCount', { count })}</span>
        <div className='browse-view-switch' role='group' aria-label={t('browse.view')}>
          {PRESENTATIONS.map(({ value, label, Icon }) => (
            <Tooltip key={value} label={t(label)}>
              <button
                type='button'
                aria-label={t(label)}
                aria-pressed={presentation === value}
                onClick={() => onPresentationChange(value)}
              >
                <Icon size={16} aria-hidden='true' />
              </button>
            </Tooltip>
          ))}
        </div>
        {expandBoard && (
          // Kept focusable while it cannot expand, so its tooltip still says why.
          <Tooltip label={t('kanban.expandBoard')} detail={expandBoard.onExpand ? undefined : t('kanban.expandBoardPanes')}>
            <button type='button' className='ui-icon-button' aria-label={t('kanban.expandBoard')} aria-disabled={expandBoard.onExpand ? undefined : 'true'} onClick={expandBoard.onExpand}>
              <Columns3 size={16} aria-hidden='true' />
            </button>
          </Tooltip>
        )}
        {onCollapse && (
          <Tooltip label={collapseLabel} detail={collapseKeys && formatKeys(collapseKeys, keyEnvironment).join(' ')}>
            <button type='button' className='ui-icon-button browse-column-toggle' data-column-toggle='' aria-label={collapseLabel} aria-expanded='true' aria-controls={columnId} onClick={onCollapse}>
              <PanelLeft size={16} aria-hidden='true' />
            </button>
          </Tooltip>
        )}
      </header>
      <div className='browse-list-filters'>{chips}</div>
      <div className='workspace-scroll browse-list-body' data-browse-content=''>{children}</div>
    </>
  );
}
