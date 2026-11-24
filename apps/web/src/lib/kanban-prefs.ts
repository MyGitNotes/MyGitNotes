import { useSyncExternalStore } from 'react';
import { DOCK_SPLIT_MAX, DOCK_SPLIT_MIN } from './focus-view.js';

/** How the board and its folded list are set up on this device. */
export const KANBAN_PREFS_KEY = 'mygitnotes:kanban';
/** The board's height above the Focus, before the board moved beside it; its value means nothing beside the Focus, so it is dropped. */
export const LEGACY_BOARD_SHARE_KEY = 'github-notes:kanban-board-share';

/** A card's size: its title and one line (`compact`), or with its tags and buttons (`normal`). */
export type CardDensity = 'compact' | 'normal';

export interface KanbanPrefs {
  density: CardDensity;
  /** Columns the person folded to a strip (`strip`) or opened (`open`), by status ('' is no status); the rest follow whether they hold notes. */
  columns: Readonly<Record<string, 'strip' | 'open'>>;
  /** Status groups folded in the folded list, by status ('' is no status). */
  foldedGroups: readonly string[];
  /** Whether the board, beside a one-pane Focus, is folded into the list column; with more panes it always is. */
  folded: boolean;
  /** The board's share of the width it shares with the Focus beside it, in percent. */
  boardShare: number;
}

export const DEFAULT_BOARD_SHARE = 60;
export const DEFAULT_KANBAN_PREFS: KanbanPrefs = { density: 'normal', columns: {}, foldedGroups: [], folded: false, boardShare: DEFAULT_BOARD_SHARE };

export const clampBoardShare = (value: number) => Math.min(DOCK_SPLIT_MAX, Math.max(DOCK_SPLIT_MIN, Math.round(value)));

const storage = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The stored preferences; a missing or damaged value, or any field of it, reads as the default. */
export function parseKanbanPrefs(raw: string | null): KanbanPrefs {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? 'null');
  } catch {
    return DEFAULT_KANBAN_PREFS;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_KANBAN_PREFS;
  const record = value as Record<string, unknown>;
  const columns = typeof record.columns === 'object' && record.columns !== null && !Array.isArray(record.columns) ? Object.fromEntries(Object.entries(record.columns).filter((entry): entry is [string, 'strip' | 'open'] => entry[1] === 'strip' || entry[1] === 'open')) : {};
  const foldedGroups = Array.isArray(record.foldedGroups) ? record.foldedGroups.filter((id): id is string => typeof id === 'string') : [];
  const boardShare = typeof record.boardShare === 'number' && Number.isFinite(record.boardShare) ? clampBoardShare(record.boardShare) : DEFAULT_BOARD_SHARE;
  return { density: record.density === 'compact' ? 'compact' : 'normal', columns, foldedGroups, folded: record.folded === true, boardShare };
}

/** The stored text; a blocked storage reads as none. */
function readStoredRaw(): string | null {
  try {
    return storage()?.getItem(KANBAN_PREFS_KEY) ?? null;
  } catch {
    return null;
  }
}

let cached: { raw: string | null; prefs: KanbanPrefs; } | undefined;
const listeners = new Set<() => void>();

/** The preferences as stored now; the same object while the stored text stays the same. */
export function readKanbanPrefs(): KanbanPrefs {
  const raw = readStoredRaw();
  if (!cached || cached.raw !== raw) cached = { raw, prefs: parseKanbanPrefs(raw) };
  return cached.prefs;
}

/** Stores a change and tells every board on the page; a full or blocked storage keeps it for this page only. */
export function updateKanbanPrefs(change: Partial<KanbanPrefs> | ((prefs: KanbanPrefs) => Partial<KanbanPrefs>)): void {
  const current = readKanbanPrefs();
  const next = { ...current, ...(typeof change === 'function' ? change(current) : change) };
  const raw = JSON.stringify(next);
  try {
    storage()?.setItem(KANBAN_PREFS_KEY, raw);
    storage()?.removeItem(LEGACY_BOARD_SHARE_KEY);
  } catch { /* Kept in memory below, until the stored text changes. */ }
  cached = { raw: readStoredRaw(), prefs: next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KANBAN_PREFS_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The board's preferences on this device, shared by every board, strip and folded list on the page. */
export function useKanbanPrefs(): [KanbanPrefs, typeof updateKanbanPrefs] {
  const prefs = useSyncExternalStore(subscribe, readKanbanPrefs, () => DEFAULT_KANBAN_PREFS);
  return [prefs, updateKanbanPrefs];
}
