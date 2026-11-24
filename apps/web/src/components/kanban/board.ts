import type React from 'react';
import type { NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import type { SortField, SortOrder } from '../../lib/note-sort.js';
import type { CardDensity } from '../../lib/kanban-prefs.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../../lib/note-drag.js';

/** A board column: one of the notebook's statuses, titled with its label and painted with its dot. */
export interface Column {
  id: string;
  title: string;
  color: string;
}

/** What a status drag needs: who may move, the note being dragged, the drop target under it, and the status change. */
export interface StatusDrag {
  /** Whether a note being edited live (編輯中) keeps its column until it is checked in. */
  liveLocked: (note: NoteListItem) => boolean;
  readOnly: boolean;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  dragged: NoteListItem | null;
  setDragged: (note: NoteListItem | null) => void;
  dragOverColumnId: string | null;
  setDragOverColumnId: (id: string | null) => void;
  focusMode?: NoteBrowseFocusMode;
}

/** What every column and card of one board shares: the statuses, the actions, and the note being dragged. */
export interface BoardContext extends StatusDrag {
  columns: Column[];
  canDelete: boolean;
  confirmDelete: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  onTotal: (columnId: string, total: number) => void;
  selectedKeys?: Set<string>;
  onToggleSelect?: (note: NoteListItem) => void;
  metadataSortFields?: readonly string[];
  /** How much each card shows. */
  density: CardDensity;
  /** Whether a column shows as a strip: as the person left it, else a strip while it holds no notes. */
  foldOf: (columnId: string, empty: boolean) => 'strip' | 'open';
  setFold: (columnId: string, fold: 'strip' | 'open') => void;
}

/** A column (or a group of the folded list) as a drop target: a note dropped on it takes the column's status, unless it is edited live or its frontmatter cannot be read. */
export function useColumnDrag(board: StatusDrag, columnId: string) {
  return {
    onDragOver: (event: React.DragEvent<HTMLElement>) => {
      if (board.readOnly) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (board.dragOverColumnId !== columnId) board.setDragOverColumnId(columnId);
    },
    onDragLeave: (event: React.DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) board.setDragOverColumnId(null);
    },
    onDrop: (event: React.DragEvent<HTMLElement>) => {
      if (board.readOnly) return;
      event.preventDefault();
      board.setDragOverColumnId(null);
      const notePath = event.dataTransfer.getData('text/plain');
      const note = board.dragged;
      board.setDragged(null);
      if (!note || (notePath && notePath !== note.path) || board.liveLocked(note) || note.frontmatterInvalid) return;
      if ((note.status || '') !== columnId) board.onUpdateNoteStatus(note, columnId);
    },
  };
}

/** A card moves between columns when the board is writable and drags into a Focus pane when the Focus accepts it. */
export function cardDragProps(board: StatusDrag, note: NoteListItem) {
  const canDragForFocus = !!board.focusMode?.canDrag(note);
  // A note being edited live (編輯中) keeps its column until it is checked in, and one whose frontmatter cannot be read
  // takes no status until it is fixed; either may still go into a Focus pane.
  const fixed = board.readOnly || board.liveLocked(note) || Boolean(note.frontmatterInvalid);
  return {
    draggable: !fixed || canDragForFocus,
    onDragStart: (event: React.DragEvent<HTMLElement>) => {
      if (fixed && !canDragForFocus) return;
      event.dataTransfer.setData('text/plain', note.path);
      if (board.focusMode) event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
      event.dataTransfer.effectAllowed = fixed ? 'copy' : 'move';
      board.setDragged(note);
    },
    onDragEnd: () => {
      board.setDragged(null);
      board.setDragOverColumnId(null);
    },
  };
}

/**
 * The query of one status's notes on the board's filter ('' asks for the notes with no status). A status filter keeps every column but only
 * its own column holds notes, and no notes without a status.
 */
export function statusQuery(query: Partial<NoteQuery>, status: string, sort: { field: SortField; order: SortOrder; }): Partial<NoteQuery> | null {
  if (!status) return query.status ? null : { ...query, withoutStatus: true, sort: sort.field, order: sort.order };
  return query.status && query.status !== status ? null : { ...query, status, sort: sort.field, order: sort.order };
}
