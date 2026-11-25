import { boardsContaining, type CompilationRow } from '@mygitnotes/core/compilation';
import type { NoteGraphLink } from '@mygitnotes/core/note-graph';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { isNoteHidden } from '@mygitnotes/core/note-status';

/** What a board reads of a note to know whether it is a member: its tags, status and metadata. */
export interface MemberNote extends NoteRef {
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

/**
 * The notes linked to or from any of `from` by a link written inside a note (the note graph's links, ids being
 * `noteRefKey`s), in either direction, without `from` themselves.
 */
export function linkedNotes(links: readonly NoteGraphLink[], from: ReadonlySet<string>): Set<string> {
  const linked = new Set<string>();
  for (const link of links) {
    if (from.has(link.source)) linked.add(link.target);
    if (from.has(link.target)) linked.add(link.source);
  }
  for (const key of from) linked.delete(key);
  return linked;
}

/** The chips of the 筆記庫 drawer: 「不在這塊白板」 leaves out the notes on the board, 「連到選取的卡片」 keeps the notes linked to or from the selected cards. */
export interface DrawerChips {
  /** The notes the board shows, by `noteRefKey`, when 「不在這塊白板」 is on. */
  offBoard?: ReadonlySet<string>;
  /** The notes linked to or from the selected cards, by `noteRefKey`, when 「連到選取的卡片」 is on. */
  linked?: ReadonlySet<string>;
}

/** The drawer's rows: the notes its search found, kept or left out by the chips that are on, in the search's order. */
export function drawerRows<T extends NoteRef>(notes: readonly T[], { offBoard, linked }: DrawerChips): T[] {
  return notes.filter(note => {
    const key = noteRefKey(note);
    return !offBoard?.has(key) && (!linked || linked.has(key));
  });
}

/**
 * The notes 「＋N 相連」 offers for a note card: those linked to or from its note, in either direction, that the board
 * does not show and that are not hidden. Links join notes of one repository only, so every one is of the card's
 * repository. `notes` holds what is known of each candidate (its status and metadata); one not known yet is not offered.
 */
export function linkedOffBoard<T extends NoteRef & Pick<MemberNote, 'status' | 'metadata'>>(links: readonly NoteGraphLink[], note: NoteRef, shown: ReadonlySet<string>, notes: readonly T[]): T[] {
  const linked = linkedNotes(links, new Set([noteRefKey(note)]));
  return notes.filter(candidate => {
    const key = noteRefKey(candidate);
    return linked.has(key) && !shown.has(key) && !isNoteHidden({ ...candidate.metadata, status: candidate.status });
  });
}

/** The keys `linkedOffBoard` would offer, before anything is known of the notes: what to look up. */
export function linkedCandidates(links: readonly NoteGraphLink[], note: NoteRef, shown: ReadonlySet<string>): NoteRef[] {
  return [...linkedNotes(links, new Set([noteRefKey(note)]))].filter(key => !shown.has(key)).flatMap(key => {
    const at = key.indexOf(':');
    return at > 0 ? [{ notebookId: key.slice(0, at), path: key.slice(at + 1) }] : [];
  });
}

/**
 * How many other boards hold each note, for the drawer's 「N 塊白板」: the boards given (the repository's) that pin the
 * note or whose query takes it, the board shown (`current`) left out. A note on no other board is not counted.
 */
export function otherBoardCounts<T extends MemberNote>(notes: readonly T[], boards: readonly CompilationRow[], current: NoteRef): Map<string, number> {
  const others = boards.filter(board => board.notebookId !== current.notebookId || board.path !== current.path);
  const counts = new Map<string, number>();
  for (const note of notes) {
    const count = boardsContaining(note, others, [note]).length;
    if (count) counts.set(noteRefKey(note), count);
  }
  return counts;
}

/** What a dynamic board's cards come from, for the drawer's foot: a tag, or a folder shown from its notebook's root. */
export function dynamicSource(row: CompilationRow, notebooks: readonly { id: string; root: string; }[]): { kind: 'tag' | 'folder'; name: string; } | undefined {
  if (row.kind !== 'dynamic') return undefined;
  if (row.source.kind === 'tag') return { kind: 'tag', name: row.source.tag };
  const { path, notebookId } = row.source;
  const root = notebooks.find(notebook => notebook.id === notebookId)?.root.replace(/\/$/, '');
  return { kind: 'folder', name: root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path };
}

/** The drag data type of a note dragged from the 筆記庫 drawer onto a board. */
export const BOARD_NOTE_TYPE = 'application/x-mygitnotes-board-note';
export const draggedNote = (note: NoteRef) => JSON.stringify({ notebookId: note.notebookId, path: note.path });
/** The note a drop carries, or nothing for anything else dropped. */
export function droppedNote(data: string): NoteRef | undefined {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return undefined;
    const { notebookId, path } = value as Record<string, unknown>;
    return typeof notebookId === 'string' && typeof path === 'string' && notebookId && path ? { notebookId, path } : undefined;
  } catch {
    return undefined;
  }
}
