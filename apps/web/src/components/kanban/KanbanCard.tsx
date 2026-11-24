import { ArrowLeft, ArrowRight, Clock, GripVertical, Trash2 } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import { useTranslation } from '../../lib/i18n/index.js';
import { noteUpdatedTime } from '../../lib/note-sort.js';
import { useDeleteConfirm } from '../../lib/use-delete-confirm.js';
import { useNoteTouchSelection } from '../../lib/use-note-touch-selection.js';
import { LiveBadge } from '../live/LiveBadge.js';
import { useLiveLock } from '../live/live-drafts.js';
import { NoteMoveButton } from '../NoteMoveButton.js';
import { NoteSelectBox } from '../NoteSelectBox.js';
import { FrontmatterInvalid } from '../NoteStatusSelect.js';
import { NoteTags } from '../NoteTags.js';
import { NoteZoomButton } from '../NoteZoomButton.js';
import { Tooltip } from '../Tooltip.js';
import { type BoardContext, cardDragProps } from './board.js';

/** A note on the board: its title and tags, its date, and the buttons that open, move, step it to the next column or delete it. */
export function KanbanCard({ note, board, index }: { note: NoteListItem; board: BoardContext; index: number; }) {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(board.onToggleSelect);
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(board.confirmDelete, () => board.onDeleteNote(note));
  const isBeingDragged = Boolean(board.dragged && sameNote(board.dragged, note));
  const updated = noteUpdatedTime(note);
  const formattedDate = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  const selectionActive = Boolean(board.selectedKeys?.size);
  const selected = board.selectedKeys?.has(noteRefKey(note)) ?? false;
  // A pending note may still be discarded (delete) and moved where its live editor can.
  const liveLock = useLiveLock();
  const locked = liveLock(note, 'other');
  const moveLocked = liveLock(note, 'move'), deleteLocked = liveLock(note, 'delete');
  return (
    <Tooltip label={selectionActive ? undefined : t('notes.multiSelectHint')}>
      <div data-notepath={note.path} {...cardDragProps(board, note)} {...touchSelection.itemProps(note, board.onOpenNote)} className={`p-3 rounded-lg border transition-all cursor-grab active:cursor-grabbing group shadow-xs ${isBeingDragged ? 'opacity-40 scale-[0.98] border-primary shadow-inner' : 'hover:shadow-sm hover:border-muted'}`} style={{ backgroundColor: 'var(--color-surface)', borderColor: isBeingDragged ? 'var(--color-primary)' : 'var(--color-line)' }}>
        <div className='flex items-start justify-between gap-1 mb-1.5'>
          <div className='flex items-start gap-1.5 min-w-0 flex-1'>
            {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => board.onToggleSelect?.(note)} className='mt-0.5' />}
            <div className='font-medium text-fg text-sm line-clamp-2 transition min-w-0'>{note.title}</div>
            {note.frontmatterInvalid && <FrontmatterInvalid iconOnly />}
            <LiveBadge live={note.live} title={note.title} />
          </div>
          {/* A note being edited live keeps its column, so its card offers no handle to drag it to another. */}
          {!board.liveLocked(note) && <GripVertical className='w-3.5 h-3.5 text-muted shrink-0 opacity-0 group-hover:opacity-100 transition' />}
        </div>
        {note.tags.length > 0 && <NoteTags tags={note.tags} oneLine className='mb-2.5' />}
        {/* Card Actions & Timestamp */}
        <div className='flex items-center justify-between pt-2 border-t text-muted text-xs' style={{ borderColor: 'var(--color-line)' }} onClick={(e) => e.stopPropagation()}>
          <div className='flex items-center gap-1.5 text-muted'>
            <span className='flex items-center gap-1 text-[11px]'>
              <Clock className='w-3 h-3 text-muted' />
              {formattedDate}
            </span>
          </div>
          <div className='flex items-center gap-1'>
            {board.focusMode && <NoteZoomButton onClick={() => board.focusMode?.onZoomNote(note)} />}
            {!board.readOnly && board.onMoveNote && <NoteMoveButton onClick={() => board.onMoveNote?.(note)} reason={moveLocked} />}
            {!board.readOnly && index > 0 && (
              <Tooltip label={locked ?? t('kanban.moveTo', { title: board.columns[index - 1].title })}>
                <button
                  type='button'
                  onClick={() => board.onUpdateNoteStatus(note, board.columns[index - 1].id)}
                  disabled={Boolean(locked)}
                  aria-label={t('kanban.moveTo', { title: board.columns[index - 1].title })}
                  className='p-1 hover:text-primary rounded hover:bg-fg/5 transition disabled:opacity-40 disabled:cursor-not-allowed'
                >
                  <ArrowLeft className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
            )}
            {!board.readOnly && index >= 0 && index < board.columns.length - 1 && (
              <Tooltip label={locked ?? t('kanban.moveTo', { title: board.columns[index + 1].title })}>
                <button type='button' onClick={() => board.onUpdateNoteStatus(note, board.columns[index + 1].id)} disabled={Boolean(locked)} aria-label={t('kanban.moveTo', { title: board.columns[index + 1].title })} className='p-1 hover:text-primary rounded hover:bg-fg/5 transition disabled:opacity-40 disabled:cursor-not-allowed'>
                  <ArrowRight className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
            )}
            {!board.readOnly && board.canDelete && (
              <Tooltip label={deleteLocked ?? (pendingDeletePath === noteRefKey(note) ? t('notes.confirmDelete') : note.live?.pending ? t('live.discard') : t('notes.delete'))}>
                <button type='button' onClick={() => requestDelete(noteRefKey(note))} disabled={Boolean(deleteLocked)} aria-label={t('notes.delete')} className={pendingDeletePath === noteRefKey(note) ? 'p-1 text-on-danger bg-danger hover:bg-danger/90 rounded transition' : 'kanban-card-delete p-1 rounded transition opacity-40 enabled:hover:opacity-100 enabled:hover:text-danger enabled:hover:bg-danger-soft'}>
                  <Trash2 className='w-3.5 h-3.5' />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
