import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../../lib/i18n/index.js';
import { useKanbanPrefs } from '../../lib/kanban-prefs.js';
import type { NoteBrowseFocusMode } from '../../lib/note-drag.js';
import { noteUpdatedTime, type SortField, type SortOrder } from '../../lib/note-sort.js';
import { useStatusDotClass, useStatusLabel } from '../../lib/status-color.js';
import { useNoteList } from '../../lib/use-note-queries.js';
import { useNoteTouchSelection } from '../../lib/use-note-touch-selection.js';
import { LiveBadge } from '../live/LiveBadge.js';
import { useLiveLock } from '../live/live-drafts.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { NoteSelectBox } from '../NoteSelectBox.js';
import { FrontmatterInvalid } from '../NoteStatusSelect.js';
import { cardDragProps, type StatusDrag, statusQuery, useColumnDrag } from './board.js';
import './kanban.css';

/** Rows a group shows before its 「還有 N 則」, and how many more each press adds. */
export const GROUP_ROWS = 5;
const MORE_ROWS = 20;

export interface KanbanStatusListProps {
  /** The board's filter; each group adds its status, as the board's columns do. */
  query: Partial<NoteQuery>;
  /** The folder index, which the board leaves out. */
  hiddenNote?: NoteListItem;
  statuses: string[];
  readOnly?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  /** The Focus beside the list: rows drag into its panes and the active pane's note is marked. */
  focusMode?: NoteBrowseFocusMode;
  selectedKeys?: Set<string>;
  onToggleSelect?: (note: NoteListItem) => void;
}

/**
 * The board folded into the list column beside the Focus: one group per column, in the board's order, the notes with no status last. Each
 * group folds on its header (kept for this device), and a row dropped onto another group takes its status, by the board's rules.
 */
export function KanbanStatusList({ query, hiddenNote, statuses, readOnly = false, onOpenNote, onUpdateNoteStatus, sortField = 'updated', sortOrder = 'desc', focusMode, selectedKeys, onToggleSelect }: KanbanStatusListProps) {
  const { t } = useTranslation();
  const liveLock = useLiveLock();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  const [prefs, updatePrefs] = useKanbanPrefs();
  const [dragged, setDragged] = useState<NoteListItem | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const drag: StatusDrag = { liveLocked: note => Boolean(liveLock(note, 'other')), readOnly, onUpdateNoteStatus, dragged, setDragged, dragOverColumnId, setDragOverColumnId, focusMode };
  // Inside the board, sorting by status means by update, as the board's columns do.
  const sort = { field: sortField === 'status' ? 'updated' : sortField, order: sortOrder };
  const toggle = (id: string) => updatePrefs(current => ({ foldedGroups: current.foldedGroups.includes(id) ? current.foldedGroups.filter(group => group !== id) : [...current.foldedGroups, id] }));
  const group = (id: string, title: string, dot: string) => <StatusGroup key={id} id={id} title={title} dot={dot} query={query} hiddenNote={hiddenNote} sort={sort} drag={drag} folded={prefs.foldedGroups.includes(id)} onToggle={() => toggle(id)} onOpenNote={onOpenNote} selectedKeys={selectedKeys} onToggleSelect={onToggleSelect} />;
  return <div className='kanban-status-list' role='group' aria-label={t('kanban.statusList')}>{statuses.map(status => group(status, labelOf(status), dotClass(status)))}{group('', t('kanban.noStatus'), 'bg-muted')}</div>;
}

interface StatusGroupProps {
  /** The status ('' for the notes with none, a group that leaves the list while it is empty). */
  id: string;
  title: string;
  dot: string;
  query: Partial<NoteQuery>;
  hiddenNote?: NoteListItem;
  sort: { field: SortField; order: SortOrder; };
  drag: StatusDrag;
  folded: boolean;
  onToggle: () => void;
  onOpenNote: (note: NoteListItem) => void;
  selectedKeys?: Set<string>;
  onToggleSelect?: (note: NoteListItem) => void;
}

function StatusGroup({ id, title, dot, query, hiddenNote, sort, drag, folded, onToggle, onOpenNote, selectedKeys, onToggleSelect }: StatusGroupProps) {
  const { t } = useTranslation();
  const hide = hiddenNote && (hiddenNote.status || '') === id ? hiddenNote.path : undefined;
  const result = useNoteList(statusQuery(query, id, sort), { hide });
  const drop = useColumnDrag(drag, id);
  const [limit, setLimit] = useState(GROUP_ROWS);
  const notes = [...result.uncommitted, ...result.notes];
  if (!id && !result.loading && !result.total && !notes.length) return null;
  // The note the active pane shows stays in sight even past the group's first rows.
  const openPath = drag.focusMode?.openPath;
  const shown = notes.filter((note, index) => index < limit || note.path === openPath);
  const rest = Math.max(0, result.total - shown.length);
  const more = () => {
    const next = limit + MORE_ROWS;
    setLimit(next);
    if (notes.length < next) result.loadMore();
  };
  return (
    <section className='kanban-group' data-status-group={id} data-over={drag.dragOverColumnId === id || undefined} aria-label={title} onDragOver={drop.onDragOver} onDragLeave={drop.onDragLeave} onDrop={drop.onDrop}>
      <h3 className='kanban-group-header'>
        <button type='button' aria-expanded={!folded} onClick={onToggle}>
          <ChevronRight className='kanban-group-chevron' size={14} aria-hidden='true' />
          <span className={`status-dot ${dot}`} aria-hidden='true' />
          <span className='kanban-group-title'>{title}</span>
          <span className='kanban-group-count'>{result.total}</span>
        </button>
      </h3>
      {!folded && <>{result.error && <p role='alert' className='kanban-group-note text-danger'>{result.error}</p>}{result.loading && <LoadingStatus className='kanban-group-note'>{t('notes.loading')}</LoadingStatus>}{shown.length > 0 && <ul className='kanban-group-rows'>{shown.map(note => <StatusRow key={noteRefKey(note)} note={note} drag={drag} onOpenNote={onOpenNote} selectedKeys={selectedKeys} onToggleSelect={onToggleSelect} />)}</ul>}{rest > 0 && <button type='button' className='kanban-group-more' onClick={more}>{t('kanban.moreNotes', { count: rest })}</button>}</>}
    </section>
  );
}

function StatusRow({ note, drag, onOpenNote, selectedKeys, onToggleSelect }: { note: NoteListItem; drag: StatusDrag; onOpenNote: (note: NoteListItem) => void; selectedKeys?: Set<string>; onToggleSelect?: (note: NoteListItem) => void; }) {
  const touchSelection = useNoteTouchSelection(onToggleSelect);
  const updated = noteUpdatedTime(note);
  const date = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const active = drag.focusMode?.openPath === note.path;
  const selectionActive = Boolean(selectedKeys?.size);
  const selected = selectedKeys?.has(noteRefKey(note)) ?? false;
  return (
    <li>
      <div
        role='button'
        tabIndex={0}
        className='kanban-row'
        data-notepath={note.path}
        data-dragging={drag.dragged?.path === note.path || undefined}
        aria-current={active ? 'true' : undefined}
        {...cardDragProps(drag, note)}
        {...touchSelection.itemProps(note, onOpenNote)}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          onOpenNote(note);
        }}
      >
        {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => onToggleSelect?.(note)} />}
        <span className='kanban-row-title'>{note.title}</span>
        {note.frontmatterInvalid && <FrontmatterInvalid iconOnly />}
        <LiveBadge live={note.live} title={note.title} />
        <span className='kanban-row-date'>{date}</span>
      </div>
    </li>
  );
}
