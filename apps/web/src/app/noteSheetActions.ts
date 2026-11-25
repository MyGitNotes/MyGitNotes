import type { NoteListItem } from '@mygitnotes/core/note-query';
import { configuredNoteStatuses } from '@mygitnotes/core/note-status';
import type { NoteSheetActions } from '../components/NoteActionSheet.js';
import type { NotebookConfig } from '../lib/types.js';

interface Params {
  /** Only a phone has the note menu its rows and whiteboard cards open. */
  phone: boolean;
  notebooks: readonly NotebookConfig[] | undefined;
  canWriteNotebook: (notebookId: string) => boolean;
  updateStatus: (note: NoteListItem, status: string) => unknown;
  moveNote: (note: NoteListItem) => (() => void) | undefined;
  deleteNote: (note: NoteListItem) => unknown;
}

/** The actions a phone's note menu runs: the page's own status change, move dialog and delete, as its desktop rows and menus run them. */
export function noteSheetActions({ phone, notebooks, canWriteNotebook, updateStatus, moveNote, deleteNote }: Params): NoteSheetActions | undefined {
  if (!phone) return undefined;
  return { statusesOf: notebookId => configuredNoteStatuses(notebooks?.find(notebook => notebook.id === notebookId)), writable: note => canWriteNotebook(note.notebookId), updateStatus: (note, status) => void updateStatus(note, status), move: moveNote, remove: note => void deleteNote(note) };
}
