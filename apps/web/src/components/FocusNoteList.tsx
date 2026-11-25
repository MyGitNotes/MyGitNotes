import React, { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CircleCheck, GalleryHorizontalEnd, Trash2 } from 'lucide-react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { noteUpdatedTime } from '../lib/note-sort.js';
import { type NoteBrowseFocusMode, pointerMovesNotes, startNoteDrag } from '../lib/note-drag.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { useNoteHoverCard } from '../lib/use-note-hover-card.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';
import { HighlightText } from './HighlightText.js';
import { NoteGroupHeading } from './NoteGroupHeading.js';
import { NoteHoverCard } from './NoteHoverCard.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { useNoteActionSheet } from './NoteActionSheet.js';
import { SwipeRow } from './SwipeRow.js';
import { LiveBadge } from './live/LiveBadge.js';
import { useLiveLock } from './live/live-drafts.js';
import { type BrowseKind, NotesEmptyState } from './NotesEmptyState.js';
import type { NoteGroupOf } from '../lib/note-groups.js';
import './focus-list.css';

/** A row stays one height whatever its title: the title always reserves two lines, or one above the meta line. */
const TITLE_LINES = 2;

/** A row's second line in the list column: the note's updated date, then its tags. */
function rowMetaText(note: NoteListItem): string {
  const updated = noteUpdatedTime(note);
  const date = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  return [date, ...note.tags].join(' · ');
}

/**
 * The notes of a list that sits in the narrow dock beside a Focus: a status dot and a title of up to two lines per row, the rest of
 * what a card shows (every tag, both dates, the folder, an excerpt, and the actions) in a hover card beside the dock.
 */
interface FocusNoteListProps {
  notes: NoteListItem[];
  /** Staged drafts the server cannot return yet; listed above the committed rows. */
  uncommitted?: NoteListItem[];
  hasFolderEntries?: boolean;
  /** The first page is still in flight, so nothing is known to be missing yet. */
  loading?: boolean;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onNewNote: () => void;
  /** What the list shows, so its empty state offers to create the same kind. */
  newKind?: BrowseKind;
  /** Present while a Focus is displayed: rows get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** An entry listed as the first row, such as the folder index in the flat view. */
  leading?: ReactNode;
  /** Active search text: highlights matches in the title and shows a matched-content snippet. */
  highlightQuery?: string;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on rows while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a row's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
  /** Present while the notes come grouped by folder: a header row starts each folder. */
  groupOf?: NoteGroupOf;
  /** Group keys whose notes are hidden under their heading. */
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  /**
   * A phone's rows: pushed right a row offers 變更狀態, pushed left 刪除, and held it opens the note's menu (`NoteActionSheet`), all
   * through the same status, move and delete actions as the rows' menus elsewhere. Without the page's note menu, rows stay as they are.
   */
  swipeActions?: boolean;
}

export function FocusNoteList({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onUpdateNoteStatus, onNewNote, newKind, focusMode, leading, highlightQuery = '', selectedKeys, onToggleSelect, groupOf, collapsedGroups, onToggleGroup, swipeActions = false }: FocusNoteListProps) {
  const { t } = useTranslation();
  const liveLock = useLiveLock();
  const touchSelection = useNoteTouchSelection(onToggleSelect, !readOnly && Boolean(onMoveNote));
  const list = useRef<HTMLDivElement>(null);
  const hover = useNoteHoverCard();
  const sheet = useNoteActionSheet();
  const phoneRows = swipeActions && sheet !== null;
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = [...uncommitted, ...notes].find(n => noteRefKey(n) === path);
    if (note) onDeleteNote(note);
  });

  if (!loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries) {
    return <NotesEmptyState readOnly={readOnly} kind={newKind} onNewNote={onNewNote} />;
  }

  const movable = !readOnly && Boolean(onMoveNote) && pointerMovesNotes();
  const rowMeta = Boolean(focusMode?.rowMeta);
  const selectionActive = Boolean(selectedKeys?.size);

  /** Arrow keys move between rows; Enter or Space opens the one focused. */
  const onRowKeyDown = (note: NoteListItem, event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenNote(note);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-focus-row]') ?? []);
    const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const renderRow = (note: NoteListItem, draft = false) => {
    const key = noteRefKey(note);
    const canDrag = !!focusMode?.canDrag(note);
    // A note being edited live (編輯中) keeps its folder and status until it is checked in.
    const canMove = movable && !liveLock(note, 'move');
    const selected = !draft && (selectedKeys?.has(key) ?? false);
    const open = focusMode?.openPath === note.path;
    const hovered = hover.target?.note && noteRefKey(hover.target.note) === key;
    const swipes = phoneRows && !draft;
    // A phone's rows have no hover card: focus coming back from the note's menu would otherwise pop one up.
    const rowHandlers = swipes ? { onKeyDown: () => {} } : hover.rowProps(note);
    const itemProps = touchSelection.itemProps(note, onOpenNote, !draft);
    const row = (
      <div
        key={key}
        role={swipes ? undefined : 'listitem'}
        data-focus-row=''
        data-open={open || undefined}
        data-selected={selected || undefined}
        data-hovered={hovered || undefined}
        tabIndex={0}
        aria-current={open ? 'true' : undefined}
        draggable={canDrag || canMove}
        onDragStart={canDrag || canMove
          ? event => startNoteDrag(event, note, { focus: canDrag, move: canMove })
          : undefined}
        className='focus-row'
        {...(swipes ? { onClick: itemProps.onClick } : itemProps)}
        {...rowHandlers}
        onKeyDown={event => {
          rowHandlers.onKeyDown(event);
          if (!event.defaultPrevented) onRowKeyDown(note, event);
        }}
      >
        {selectionActive && !draft && <NoteSelectBox title={note.title} checked={selected} onToggle={() => onToggleSelect?.(note)} className='focus-row-check' />}
        <NoteStatusSelect unreadable={note.frontmatterInvalid} dotOnly statuses={statuses} status={note.status} readOnly={readOnly || draft} lockedReason={liveLock(note, 'other')} label={t('notes.statusFor', { title: note.title })} onChange={status => onUpdateNoteStatus(note, status)} />
        <span className='focus-row-text'>
          <span className='focus-row-title' style={{ ['--title-lines' as string]: rowMeta ? 1 : TITLE_LINES }}>
            {isCompilationPath(note.path) && <GalleryHorizontalEnd className='focus-row-kind' aria-hidden='true' />}
            <HighlightText text={note.title} query={highlightQuery} />
          </span>
          {rowMeta && <span className='focus-row-meta'>{rowMetaText(note)}</span>}
        </span>
        <LiveBadge live={note.live} title={note.title} />
      </div>
    );
    if (!swipes || !sheet) return row;
    const ask = (mode?: 'status' | 'delete') => sheet.show({ note, mode, open: () => onOpenNote(note), statuses, source: 'list', select: !mode && onToggleSelect ? () => onToggleSelect(note) : undefined });
    const statusAction = !readOnly && !note.frontmatterInvalid && !liveLock(note, 'other');
    const deleteAction = canDelete && !readOnly && !liveLock(note, 'delete');
    return (
      <SwipeRow
        key={key}
        onHold={() => ask()}
        start={statusAction && (
          <button
            type='button'
            className='swipe-row-action'
            data-tone='primary'
            onClick={() => ask('status')}
          >
            <CircleCheck aria-hidden='true' />
            {t('noteActions.status')}
          </button>
        )}
        end={deleteAction && (
          <button type='button' className='swipe-row-action' data-tone='danger' onClick={() => ask('delete')}>
            <Trash2 aria-hidden='true' />
            {t('common.delete')}
          </button>
        )}
      >
        {row}
      </SwipeRow>
    );
  };

  const deleteNote = (note: NoteListItem) => {
    const key = noteRefKey(note);
    const fires = !confirmDelete || pendingDeletePath === key;
    requestDelete(key);
    return fires;
  };

  return (
    <div ref={list} className='focus-note-list'>
      {leading && <div className='note-collection-leading'>{leading}</div>}
      {uncommitted.length > 0 && (
        <section className='focus-list-uncommitted'>
          <h3>{t('notes.uncommitted')}</h3>
          <div role='list'>{uncommitted.map(note => renderRow(note, true))}</div>
        </section>
      )}
      <div role='list' className='focus-list-rows'>
        {notes.map((note, index) => {
          const group = groupOf?.(note);
          const header = group && (index === 0 || groupOf!(notes[index - 1]).key !== group.key) ? <NoteGroupHeading group={group} collapsed={collapsedGroups?.has(group.key) ?? false} onToggle={onToggleGroup} /> : null;
          if (group && collapsedGroups?.has(group.key)) return header ? <React.Fragment key={noteRefKey(note)}>{header}</React.Fragment> : null;
          return header ? <React.Fragment key={noteRefKey(note)}>{header}{renderRow(note)}</React.Fragment> : renderRow(note);
        })}
      </div>
      {hover.target && <NoteHoverCard key={noteRefKey(hover.target.note)} target={hover.target} cardRef={hover.card} cardProps={hover.cardProps} statuses={statuses} readOnly={readOnly} readNote={focusMode?.readNote} onUpdateStatus={onUpdateNoteStatus} onZoom={focusMode?.onZoomNote} onMove={onMoveNote} onDelete={canDelete ? deleteNote : undefined} deleteArmed={pendingDeletePath === noteRefKey(hover.target.note)} onMenuOpenChange={hover.holdOpen} onDone={() => hover.close()} />}
    </div>
  );
}
