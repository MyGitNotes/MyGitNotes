import type React from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { CardDensity } from '../../lib/kanban-prefs.js';
import { NOTE_DRAG_TYPE, type NoteBrowseFocusMode } from '../../lib/note-drag.js';

/** A board column: one of the notebook's statuses, titled with its label and painted with its dot. */
export interface Column {
  id: string;
  title: string;
  color: string;
}

/** What every column and card of one board shares: the statuses, the actions, and the note being dragged. */
export interface BoardContext {
  /** Whether a note being edited live (編輯中) keeps its column until it is checked in. */
  liveLocked: (note: NoteListItem) => boolean;
  columns: Column[];
  readOnly: boolean;
  canDelete: boolean;
  confirmDelete: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  dragged: NoteListItem | null;
  setDragged: (note: NoteListItem | null) => void;
  dragOverColumnId: string | null;
  setDragOverColumnId: (id: string | null) => void;
  onTotal: (columnId: string, total: number) => void;
  focusMode?: NoteBrowseFocusMode;
  selectedKeys?: Set<string>;
  onToggleSelect?: (note: NoteListItem) => void;
  metadataSortFields?: readonly string[];
  /** How much each card shows. */
  density: CardDensity;
  /** Whether a column shows as a strip: as the person left it, else a strip while it holds no notes. */
  foldOf: (columnId: string, empty: boolean) => 'strip' | 'open';
  setFold: (columnId: string, fold: 'strip' | 'open') => void;
}

/** A column as a drop target: a note dropped on it takes the column's status, unless it is edited live or its frontmatter cannot be read. */
export function useColumnDrag(board: BoardContext, columnId: string) {
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
export function cardDragProps(board: BoardContext, note: NoteListItem) {
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
