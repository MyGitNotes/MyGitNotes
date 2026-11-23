import type { DisplayNode } from '@mygitnotes/core/focus-page';
import type { ViewMode } from './types.js';

/** The notebooks column's width, open and as its rail, and the note list's width, in px; browse-columns.css uses the same. */
export const NOTEBOOK_COLUMN_WIDTH = 232;
export const NOTEBOOK_RAIL_WIDTH = 56;
export const LIST_COLUMN_WIDTH = 320;
/** Below this viewport width the notebooks column gives way to its rail by itself. */
export const NOTEBOOK_RAIL_BELOW = 1100;
/** The note column keeps at least this much room for one pane, and each pane beside it this much more, before the notebooks column gives way. */
export const MIN_NOTE_WIDTH = 600;
export const MIN_EXTRA_PANE_WIDTH = 360;

export const BROWSE_COLUMNS_STORAGE_KEY = 'mygitnotes:browse-columns';

/** What the person folded away by hand, kept for this browser. */
export interface StoredBrowseColumns {
  notebooksCollapsed: boolean;
  listCollapsed: boolean;
}

/** How the notebooks column shows: open, as its icon rail, or not at all (both columns folded away). */
export type NotebookColumnMode = 'open' | 'rail' | 'hidden';

export interface BrowseColumnsLayout {
  notebooks: NotebookColumnMode;
  /** Whether the note list column shows. */
  list: boolean;
}

const OPEN: StoredBrowseColumns = { notebooksCollapsed: false, listCollapsed: false };

/** The stored state; a missing or damaged value reads as both columns open. */
export function readBrowseColumns(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): StoredBrowseColumns {
  try {
    const value: unknown = JSON.parse(storage?.getItem(BROWSE_COLUMNS_STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return OPEN;
    const record = value as Record<string, unknown>;
    return { notebooksCollapsed: record.notebooksCollapsed === true, listCollapsed: record.listCollapsed === true };
  } catch {
    return OPEN;
  }
}

export function saveBrowseColumns(state: StoredBrowseColumns, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(BROWSE_COLUMNS_STORAGE_KEY, JSON.stringify(state));
  } catch { /* A full or blocked storage only costs the remembered state. */ }
}

/** How many panes the displayed Focus sets side by side: a split across adds its children, a split down takes its widest child. */
export function paneColumns(node: DisplayNode | undefined): number {
  if (!node || node.kind === 'pane') return 1;
  const counts = node.children.map(paneColumns);
  return node.orientation === 'horizontal' ? counts.reduce((sum, count) => sum + count, 0) : Math.max(1, ...counts);
}

export interface CrampedInput {
  /** The viewport's width. */
  viewport: number;
  /** The width the three columns share; 0 while it is not measured. */
  width: number;
  /** Whether the note list takes its column beside the note. */
  listShown: boolean;
  /** Panes the Focus sets side by side. */
  panes: number;
}

/**
 * Whether the notebooks column should give way to its rail: under the viewport's breakpoint, or when the open column would leave the note
 * (and the panes beside it) less than their room. An unmeasured width only counts the viewport.
 */
export function notebooksCramped({ viewport, width, listShown, panes }: CrampedInput): boolean {
  if (viewport > 0 && viewport < NOTEBOOK_RAIL_BELOW) return true;
  if (width <= 0) return false;
  const room = width - NOTEBOOK_COLUMN_WIDTH - (listShown ? LIST_COLUMN_WIDTH : 0);
  return room < MIN_NOTE_WIDTH + (Math.max(1, panes) - 1) * MIN_EXTRA_PANE_WIDTH;
}

/**
 * The columns that show. The notebooks column folds to its rail when the person folded it, or when it is cramped and they have not opened it by
 * hand since (`heldOpen`); with the list folded away too, neither column shows.
 */
export function browseColumnsLayout({ stored, cramped, heldOpen }: { stored: StoredBrowseColumns; cramped: boolean; heldOpen: boolean; }): BrowseColumnsLayout {
  const notebooksCollapsed = stored.notebooksCollapsed || (cramped && !heldOpen);
  if (notebooksCollapsed && stored.listCollapsed) return { notebooks: 'hidden', list: false };
  return { notebooks: notebooksCollapsed ? 'rail' : 'open', list: !stored.listCollapsed };
}

/** The state after a toggle, and whether the notebooks column is now held open against a cramped page. */
export interface BrowseColumnsChange {
  stored: StoredBrowseColumns;
  heldOpen: boolean;
}

/** Opens or folds the notebooks column; opening it on a cramped page holds it open there. */
export function toggleNotebooks(layout: BrowseColumnsLayout, stored: StoredBrowseColumns, cramped: boolean): BrowseColumnsChange {
  if (layout.notebooks === 'open') return { stored: { ...stored, notebooksCollapsed: true }, heldOpen: false };
  return { stored: { ...stored, notebooksCollapsed: false }, heldOpen: cramped };
}

/** Shows or folds the note list, leaving the notebooks column as the person left it. */
export function toggleList(layout: BrowseColumnsLayout, stored: StoredBrowseColumns, heldOpen: boolean): BrowseColumnsChange {
  return { stored: { ...stored, listCollapsed: layout.list }, heldOpen };
}

/** Folds both columns away, or brings both back once neither shows; bringing them back by hand holds the notebooks column open. */
export function toggleColumns(layout: BrowseColumnsLayout, cramped: boolean): BrowseColumnsChange {
  if (layout.notebooks === 'hidden') return { stored: OPEN, heldOpen: cramped };
  return { stored: { notebooksCollapsed: true, listCollapsed: true }, heldOpen: false };
}

/** What the list column shows: the list beside the note, or the table or the board across the list and note columns. */
export type BrowsePresentation = 'list' | 'table' | 'kanban';

/**
 * The table while it is chosen (it is page state, put away when a note opens from it); the board on a notebook's address with `view=kanban`,
 * never beside a note the address names, so closing that note does not bring the board back; the list otherwise.
 */
export function browsePresentation({ viewMode, table, noteAddress }: { viewMode: ViewMode; table: boolean; noteAddress: boolean; }): BrowsePresentation {
  if (table) return 'table';
  return viewMode === 'kanban' && !noteAddress ? 'kanban' : 'list';
}
