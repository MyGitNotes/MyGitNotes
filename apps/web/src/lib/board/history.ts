import type { CompilationBoard, CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import { compilationText } from '../compilation-rows.js';

/** What a board edit changes in a row: a custom compilation's items (its chapters) and the board. */
export interface BoardSnapshot {
  items?: CompilationItem[];
  board?: CompilationBoard;
}
/** One gesture: the row's board part before and after it. */
interface Step {
  before: BoardSnapshot;
  after: BoardSnapshot;
}
/** The board's edits of this visit: steps to undo, newest last, and the steps undone, to redo. */
export interface BoardHistory {
  past: Step[];
  future: Step[];
}

/** The most gestures a visit can undo; the oldest goes first. */
const KEPT_STEPS = 100;
export const emptyHistory: BoardHistory = { past: [], future: [] };

export const snapshotOf = (row: CompilationRow): BoardSnapshot => ({ ...(row.kind === 'custom' ? { items: row.items } : {}), ...(row.board ? { board: row.board } : {}) });

/**
 * The row with a snapshot's items and board put back, its other fields (title, arrangement, tags) as they are now, so
 * undoing a board edit never undoes a rename made in the header.
 */
export function applySnapshot(row: CompilationRow, snapshot: BoardSnapshot): CompilationRow {
  const next: CompilationRow = { ...row };
  delete next.board;
  if (snapshot.board) next.board = snapshot.board;
  return next.kind === 'custom' && snapshot.items ? { ...next, items: snapshot.items } : next;
}

/** The history with a gesture recorded as its newest step; a new step drops what was undone. */
export function recordStep(history: BoardHistory, before: CompilationRow, after: CompilationRow): BoardHistory {
  return { past: [...history.past, { before: snapshotOf(before), after: snapshotOf(after) }].slice(-KEPT_STEPS), future: [] };
}

/** What moving through the history gives: the row to write and the history after it; `stale` when the board changed outside it. */
export type HistoryMove = { row: CompilationRow; history: BoardHistory; } | { stale: true; };

/**
 * Whether the row's items and board are what a snapshot holds, compared as the file would be written (a row read back
 * from the stored file is another object with the same content).
 */
const holds = (row: CompilationRow, snapshot: BoardSnapshot) => compilationText(applySnapshot(row, snapshot)) === compilationText(row);

/**
 * Undoes the newest step: the row as it was before it, and the history with the step ready to redo. When the items or
 * the board changed outside the history since (the header's add or arrange dialog, another arrangement, another
 * writer), putting the old snapshot back would undo that change too, so the history is `stale` and nothing is undone.
 */
export function undoStep(history: BoardHistory, row: CompilationRow): HistoryMove | undefined {
  const step = history.past.at(-1);
  if (!step) return undefined;
  if (!holds(row, step.after)) return { stale: true };
  return { row: applySnapshot(row, step.before), history: { past: history.past.slice(0, -1), future: [...history.future, step] } };
}

/** Redoes the step undone last; `stale` as for `undoStep` when the board changed outside the history since. */
export function redoStep(history: BoardHistory, row: CompilationRow): HistoryMove | undefined {
  const step = history.future.at(-1);
  if (!step) return undefined;
  if (!holds(row, step.before)) return { stale: true };
  return { row: applySnapshot(row, step.after), history: { past: [...history.past, step], future: history.future.slice(0, -1) } };
}
