/**
 * The state of the infographic data editor: the draft block, which child tab and cells are selected, the cell
 * being edited, and an undo history of drafts. The reducer is pure; the text of a cell being typed lives in the
 * shared input until it is committed, so typing never goes through here.
 */

import { addChild, cellMatrix, type CellPos, clampSelection, cleanCell, clearRange, deleteRow, type Direction, duplicateRow, gridDims, type GridSelection, insertRow, isCellEditable, moveChild, moveRow, moveSelection, pasteMatrix, rangeOf, removeChild, rowsOf, setCell, single, stepCell, toggleRowHighlight } from './grid.js';
import type { InfographicBlock } from './model.js';

export interface EditorSnapshot {
  block: InfographicBlock;
  tab: number;
  sel: GridSelection;
}

/** The cell being edited. `initial` is the text to put in the input, or null when the writer's first key already did. */
export interface CellEdit {
  initial: string | null;
  /** Typing replaced the cell: arrows commit and move, as in a spreadsheet's Enter mode. Otherwise they move the caret. */
  replace: boolean;
}

export interface EditorState extends EditorSnapshot {
  edit: CellEdit | null;
  past: EditorSnapshot[];
  future: EditorSnapshot[];
  /** Set while consecutive changes belong to one edit (typing in one field), so they share one history entry. */
  mergeKey: string | null;
}

/** Where the selection goes when a cell edit is committed. `enter` moves down and adds a row after the last. */
export type CommitMove = 'enter' | 'up' | 'down' | 'left' | 'right' | 'next' | 'previous' | 'stay';

export type EditorAction = { type: 'select'; sel: GridSelection; } | { type: 'tab'; tab: number; } | { type: 'edit'; initial: string | null; replace: boolean; } | { type: 'cancel-edit'; } | { type: 'commit'; move: CommitMove; value: string; } | { type: 'clear'; } | { type: 'paste'; matrix: string[][]; } | { type: 'move'; direction: Direction; extend: boolean; } | { type: 'change'; apply: (snapshot: EditorSnapshot) => Partial<EditorSnapshot>; merge?: string; } | { type: 'undo'; } | { type: 'redo'; };

const HISTORY_LIMIT = 200;

export function initialState(block: InfographicBlock): EditorState {
  return { block, tab: 0, sel: single({ row: 0, col: 0 }), edit: null, past: [], future: [], mergeKey: null };
}

const snapshotOf = (state: EditorState): EditorSnapshot => ({ block: state.block, tab: state.tab, sel: state.sel });

/** `next` as the new draft, with the one it replaces on the undo stack unless it is a continuation of the same edit. */
function record(state: EditorState, next: EditorSnapshot, merge?: string): EditorState {
  const dims = gridDims(next.block, next.tab);
  const sel = clampSelection(next.sel, dims);
  const changed = next.block !== state.block || next.tab !== state.tab;
  if (!changed) return { ...state, sel, edit: null, mergeKey: null };
  const merged = merge !== undefined && state.mergeKey === merge && state.past.length > 0;
  const past = merged ? state.past : [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT);
  return { ...state, block: next.block, tab: next.tab, sel, edit: null, past, future: [], mergeKey: merge ?? null };
}

/**
 * Commits a cell edit, if one is pending, and moves the selection. The edit and the row Enter may add after the last
 * one are a single history entry.
 */
function commit(state: EditorState, value: string, move: CommitMove): EditorState {
  const { anchor } = state.sel;
  let block = state.block;
  const current = cellMatrix(block, state.tab)[anchor.row]?.[anchor.col] ?? '';
  if (state.edit && isCellEditable(block, state.tab, anchor) && cleanCell(value) !== current) block = setCell(block, state.tab, anchor.row, anchor.col, value);
  let dims = gridDims(block, state.tab);
  let target: CellPos | null = anchor;
  if (move === 'enter') {
    if (dims.rows > 0 && anchor.row >= dims.rows - 1) {
      block = insertRow(block, state.tab, dims.rows);
      dims = gridDims(block, state.tab);
    }
    target = { row: anchor.row + 1, col: anchor.col };
  } else if (move === 'down') target = { row: anchor.row + 1, col: anchor.col };
  else if (move === 'up') target = { row: anchor.row - 1, col: anchor.col };
  else if (move === 'left') target = { row: anchor.row, col: anchor.col - 1 };
  else if (move === 'right') target = { row: anchor.row, col: anchor.col + 1 };
  else if (move === 'next' || move === 'previous') target = stepCell(state.sel, move === 'previous', dims);
  return record(state, { block, tab: state.tab, sel: single(target ?? anchor) });
}

export function reduce(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return { ...state, sel: clampSelection(action.sel, gridDims(state.block, state.tab)), mergeKey: null };
    case 'tab': {
      if (action.tab === state.tab || action.tab < 0 || action.tab >= Math.max(1, state.block.children.length)) return state;
      return { ...state, tab: action.tab, sel: single({ row: 0, col: 0 }), edit: null, mergeKey: null };
    }
    case 'edit':
      return isCellEditable(state.block, state.tab, state.sel.anchor) && rowsOf(state.block, state.tab).length ? { ...state, edit: { initial: action.initial, replace: action.replace }, sel: single(state.sel.anchor), mergeKey: null } : state;
    case 'cancel-edit':
      return { ...state, edit: null };
    case 'commit':
      return commit(state, action.value, action.move);
    case 'move':
      return { ...state, sel: moveSelection(state.sel, action.direction, gridDims(state.block, state.tab), action.extend), mergeKey: null };
    case 'clear': {
      const range = rangeOf(state.sel);
      return record(state, { ...snapshotOf(state), block: clearRange(state.block, state.tab, range) });
    }
    case 'paste': {
      const pasted = pasteMatrix(state.block, state.tab, state.sel.anchor, action.matrix);
      return record(state, { ...snapshotOf(state), block: pasted.block, sel: pasted.selection });
    }
    case 'change': {
      const patch = action.apply(snapshotOf(state));
      return record(state, { ...snapshotOf(state), ...patch }, action.merge);
    }
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...previous, edit: null, past: state.past.slice(0, -1), future: [snapshotOf(state), ...state.future], mergeKey: null };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...next, edit: null, past: [...state.past, snapshotOf(state)], future: rest, mergeKey: null };
    }
  }
}

/** The state as it would be once a pending cell edit is committed in place. */
export function committed(state: EditorState, value: string | null): EditorState {
  return state.edit && value !== null ? reduce(state, { type: 'commit', move: 'stay', value }) : state;
}

type Edit = (snapshot: EditorSnapshot) => Partial<EditorSnapshot>;

/** Row operations as `change` actions' edits; each leaves the selection on the row it concerns. */
export const rowEdits = {
  insert: (at: number): Edit => snapshot => ({ block: insertRow(snapshot.block, snapshot.tab, at), sel: single({ row: at, col: snapshot.sel.anchor.col }) }),
  duplicate: (row: number): Edit => snapshot => ({ block: duplicateRow(snapshot.block, snapshot.tab, row), sel: single({ row: row + 1, col: snapshot.sel.anchor.col }) }),
  remove: (row: number): Edit => snapshot => {
    const block = deleteRow(snapshot.block, snapshot.tab, row);
    return { block, sel: single({ row: Math.min(row, Math.max(0, rowsOf(block, snapshot.tab).length - 1)), col: snapshot.sel.anchor.col }) };
  },
  move: (from: number, to: number): Edit => snapshot => ({ block: moveRow(snapshot.block, snapshot.tab, from, to), sel: single({ row: to, col: snapshot.sel.anchor.col }) }),
  highlight: (row: number): Edit => snapshot => ({ block: toggleRowHighlight(snapshot.block, snapshot.tab, row) }),
};

/** Child container operations as `change` actions' edits; the active tab follows the container concerned. */
export const childEdits = {
  add: (): Edit => snapshot => {
    const block = addChild(snapshot.block);
    return { block, tab: Math.max(0, block.children.length - 1), sel: single({ row: 0, col: 0 }) };
  },
  remove: (index: number): Edit => snapshot => {
    const block = removeChild(snapshot.block, index);
    const active = index === snapshot.tab ? index : index < snapshot.tab ? snapshot.tab - 1 : snapshot.tab;
    return { block, tab: Math.max(0, Math.min(active, block.children.length - 1)), sel: single({ row: 0, col: 0 }) };
  },
  move: (from: number, to: number): Edit => snapshot => ({ block: moveChild(snapshot.block, from, to), tab: to }),
};
