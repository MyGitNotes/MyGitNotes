import type { DragEvent } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';

/** Native drag payload MIME type: carries a note's path from the browse region into a Focus pane. */
export const NOTE_DRAG_TYPE = 'application/x-mygitnotes-note';

/** Native drag payload MIME type: carries a note, as JSON `{ notebookId, path }`, onto a folder of its notebook. */
export const NOTE_MOVE_DRAG_TYPE = 'application/x-mygitnotes-note-move';

/** A note dropped onto a folder. */
export interface DraggedNote {
  notebookId: string;
  path: string;
}

/** Present on a browse view while a Focus is displayed: rows/cards get a zoom button and can be dragged into a pane. */
export interface NoteBrowseFocusMode {
  onZoomNote: (note: NoteListItem) => void;
  canDrag: (note: NoteListItem) => boolean;
}

/**
 * Starts dragging a list row or card: into a Focus pane when `focus` (the pane reads the path, also as plain text),
 * onto a folder when `move`. A drag that only moves leaves the Focus payloads out, so a pane does not accept it.
 */
export function startNoteDrag(event: DragEvent, note: Pick<NoteListItem, 'notebookId' | 'path'>, { focus, move }: { focus: boolean; move: boolean; }) {
  if (focus) {
    event.dataTransfer.setData(NOTE_DRAG_TYPE, note.path);
    event.dataTransfer.setData('text/plain', note.path);
  }
  if (move) event.dataTransfer.setData(NOTE_MOVE_DRAG_TYPE, JSON.stringify({ notebookId: note.notebookId, path: note.path }));
  event.dataTransfer.effectAllowed = 'copyMove';
}

/**
 * Whether rows drag to move with this pointer. On touch a native drag would start on the long press that selects
 * notes, so a touch screen moves a note with its Move button instead.
 */
export const pointerMovesNotes = () => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(pointer: fine)').matches;

/** Whether a native drag carries a note to move; its payload is only readable on drop. */
export const carriesNoteMove = (event: DragEvent) => event.dataTransfer.types.includes(NOTE_MOVE_DRAG_TYPE);

/** The note a drop carries to move, if it carries one. */
export function droppedNote(event: DragEvent): DraggedNote | undefined {
  try {
    const value = JSON.parse(event.dataTransfer.getData(NOTE_MOVE_DRAG_TYPE)) as Partial<DraggedNote>;
    return typeof value.notebookId === 'string' && typeof value.path === 'string' ? { notebookId: value.notebookId, path: value.path } : undefined;
  } catch {
    return undefined;
  }
}
