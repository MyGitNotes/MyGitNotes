import { displayFocus, emptyFocusLayout, findFocusPane, type FocusDisplay, type FocusLayout, type FocusNode, focusPanes, type FocusSplitNode, focusTabKey, readFocusLayout } from '@mygitnotes/core/focus-page';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import { storageOwner } from './demo-storage.js';

export const CURRENT_FOCUS = 'current';

/** View state for one Focus (the unnamed (current) one under key CURRENT_FOCUS, or a named one under its id), keyed by the ids of the layout's panes and splits. */
export interface FocusEntryView {
  activePane: string;
  /** Per pane id: the key (focusTabKey) of the displayed tab, or null when the pane is empty. */
  shown: Record<string, string | null>;
  /** Pane ids, most recently used first. */
  recent: string[];
  /** Per pane id: the keys of the tabs shown there, most recently shown first, so closing a tab returns to the one before it. */
  history: Record<string, string[]>;
  /** Split sizes (percentages) per split id, then per child id (a pane's or split's own id). */
  ratios: Record<string, Record<string, number>>;
  /** Per pane id: hide the note editor and compilation toolbars to leave room for content. */
  hideToolbar: Record<string, boolean>;
}

/** An entry as this device stored it before layouts were trees: everything indexed by pane position, sizes keyed by the old group names. Converted by `entryView`. */
export interface LegacyFocusEntryView {
  activePane: number;
  shown: (string | null)[];
  recent: number[];
  history: string[][];
  ratios: Record<string, number[]>;
  hideToolbar: boolean[];
}

export interface FocusViewState {
  /** Layout of the unnamed (current) Focus; it lives only in this browser. */
  current: FocusLayout;
  entries: Record<string, FocusEntryView | LegacyFocusEntryView>;
  /** Focus key last displayed in this notebook; null means normal browsing. */
  last: string | null;
  /** Browse region: left dock width (px), top dock height (px), collapsed flag. */
  dock: { left: number; top: number; collapsed: boolean; };
}

/**
 * Where this device keeps the Focus view of the notebook `notebookKey` served by the repository `repositoryId`. An alias
 * is unique only within one workspace, so two repositories of the same name on one origin (two visitors' `notes`, or two
 * worktrees in folders of the same name) keep views of their own.
 */
export function focusViewStorageKey(repositoryId: string, notebookKey: string): string {
  return `github-notes:focus-view:${storageOwner(repositoryId)}:${notebookKey}`;
}

/**
 * The storage key of a notebook's Focus view. A view this device kept before notebook keys, under the workspace's
 * view scope and the notebook's local id, is copied to it once; one that cannot be read is dropped by readFocusView.
 * `scope` is null for a notebook that view does not belong to: one its local id, as an old URL, does not stand for.
 */
export function adoptedFocusViewKey(repositoryId: string, scope: string | null, notebookKey: string): string {
  const key = focusViewStorageKey(repositoryId, notebookKey);
  const localId = parseNotebookKey(notebookKey)?.localId;
  try {
    if (scope !== null && localId && localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem(`github-notes:focus-view:${scope}:${localId}`);
      if (legacy !== null) localStorage.setItem(key, legacy);
    }
  } catch { /* The view starts empty when storage refuses it, as any unreadable view does. */ }
  return key;
}

const FOCUS_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isRecordOf = (value: unknown, check: (item: unknown) => boolean): boolean => isRecord(value) && Object.values(value).every(check);

function readLegacyEntry(raw: Record<string, unknown>): LegacyFocusEntryView | null {
  const { activePane, shown, recent, ratios, hideToolbar, history } = raw;
  if (typeof activePane !== 'number') return null;
  if (!Array.isArray(shown) || !shown.every(value => value === null || typeof value === 'string')) return null;
  if (!Array.isArray(recent) || !recent.every(value => typeof value === 'number')) return null;
  if (!isRecordOf(ratios, value => Array.isArray(value) && value.every(n => typeof n === 'number'))) return null;
  // Entries stored before the toolbar toggle have no hideToolbar; the retired tab bar `autoHide` flag is ignored.
  if (hideToolbar !== undefined && !(Array.isArray(hideToolbar) && hideToolbar.every(value => typeof value === 'boolean'))) return null;
  // Entries stored before the tab history start with none; one that does not validate is dropped on its own.
  const validHistory = Array.isArray(history) && history.every(isStringArray);
  return { activePane, shown: [...shown] as (string | null)[], recent: [...recent] as number[], history: validHistory ? (history as string[][]).map(pane => [...pane]) : [], ratios: ratios as Record<string, number[]>, hideToolbar: hideToolbar ? [...hideToolbar] as boolean[] : [] };
}

function readEntry(raw: unknown): FocusEntryView | LegacyFocusEntryView | null {
  if (!isRecord(raw)) return null;
  if (Array.isArray(raw.shown)) return readLegacyEntry(raw);
  const { activePane, shown, recent, ratios, hideToolbar, history } = raw;
  if (typeof activePane !== 'string') return null;
  if (!isRecordOf(shown, value => value === null || typeof value === 'string')) return null;
  if (!isStringArray(recent)) return null;
  if (!isRecordOf(ratios, value => isRecordOf(value, size => typeof size === 'number'))) return null;
  if (hideToolbar !== undefined && !isRecordOf(hideToolbar, value => typeof value === 'boolean')) return null;
  return { activePane, shown: { ...shown as Record<string, string | null> }, recent: [...recent], history: isRecordOf(history, isStringArray) ? { ...history as Record<string, string[]> } : {}, ratios: structuredClone(ratios) as Record<string, Record<string, number>>, hideToolbar: { ...hideToolbar as Record<string, boolean> | undefined } };
}

const OLD_DEFAULT_DOCK_LEFT = 320;
/** The top dock was 280 px until a Kanban board above a Focus showed only 101 px of cards, cutting a card with tags off at its action row. */
const OLD_DEFAULT_DOCK_TOP = 280;

export function emptyFocusView(): FocusViewState {
  return { current: emptyFocusLayout(), entries: {}, last: null, dock: { left: 240, top: 340, collapsed: false } };
}

/** Tolerant reader for whatever JSON was stored: never throws, drops or defaults whatever doesn't validate. */
export function readFocusView(raw: unknown): FocusViewState {
  if (!isRecord(raw)) return emptyFocusView();
  let current = emptyFocusLayout();
  try {
    current = readFocusLayout(raw.current);
  } catch { /* A scratch Focus that does not validate starts empty. */ }
  const entries: FocusViewState['entries'] = {};
  if (isRecord(raw.entries)) {
    for (const [key, value] of Object.entries(raw.entries)) {
      const entry = readEntry(value);
      if (entry) entries[key] = entry;
    }
  }
  const last = typeof raw.last === 'string' && FOCUS_KEY_RE.test(raw.last) ? raw.last : null;
  const defaults = emptyFocusView().dock;
  const dockRaw = isRecord(raw.dock) ? raw.dock : {};
  // 320 was the default width before the note list shrank to two lines; a dock still at it never chose that width, so it takes the new default.
  const left = typeof dockRaw.left === 'number' && Number.isFinite(dockRaw.left) && dockRaw.left >= 0 && dockRaw.left !== OLD_DEFAULT_DOCK_LEFT ? dockRaw.left : defaults.left;
  // Views stored before the card dock moved to the top keep their height under `bottom`.
  const topRaw = dockRaw.top ?? dockRaw.bottom;
  // Like the old width, a height still at the old default never chose it and takes the new one.
  const top = typeof topRaw === 'number' && Number.isFinite(topRaw) && topRaw >= 0 && topRaw !== OLD_DEFAULT_DOCK_TOP ? topRaw : defaults.top;
  const collapsed = typeof dockRaw.collapsed === 'boolean' ? dockRaw.collapsed : defaults.collapsed;
  return { current, entries, last, dock: { left, top, collapsed } };
}

function splitNodes(node: FocusNode): FocusSplitNode[] {
  return node.kind === 'pane' ? [] : [node, ...node.children.flatMap(splitNodes)];
}

/**
 * A legacy entry in terms of the layout's ids: array index `i` is the `i`-th pane in pane order, and a size group named like the old layout
 * component's (`<division>`, `<group>.<index>`) is the split named `<division>`, `<group>-<index>`, which is what the migration of a division gives.
 */
function converted(stored: LegacyFocusEntryView, layout: FocusLayout): FocusEntryView {
  const ids = focusPanes(layout).map(pane => pane.id);
  const byPane = <T>(values: readonly T[]): Record<string, T> => Object.fromEntries(values.flatMap((value, index) => ids[index] === undefined ? [] : [[ids[index], value]]));
  const splits = new Map(splitNodes(layout.root).map(node => [node.id, node]));
  const ratios = Object.entries(stored.ratios).flatMap(([group, sizes]) => {
    const split = splits.get(group.replaceAll('.', '-'));
    return split && split.children.length === sizes.length ? [[split.id, Object.fromEntries(split.children.map((child, index) => [child.id, sizes[index]]))] as const] : [];
  });
  return { activePane: ids[stored.activePane] ?? '', shown: byPane(stored.shown), recent: stored.recent.flatMap(index => ids[index] === undefined ? [] : [ids[index]]), history: byPane(stored.history), ratios: Object.fromEntries(ratios), hideToolbar: byPane(stored.hideToolbar) };
}

/** Normalizes a stored entry (if any) against `layout`: one shown slot, tab history and toolbar flag per pane, a valid activePane, and recent covering every pane. A legacy entry is converted to pane ids first. */
export function entryView(state: FocusViewState, key: string, layout: FocusLayout): FocusEntryView {
  const raw = state.entries[key];
  const stored = raw && Array.isArray(raw.shown) ? converted(raw as LegacyFocusEntryView, layout) : raw as FocusEntryView | undefined;
  const panes = focusPanes(layout);
  const ids = panes.map(pane => pane.id);
  const activePane = stored && ids.includes(stored.activePane) ? stored.activePane : ids[0];
  const shown = Object.fromEntries(panes.map(pane => {
    const storedKey = stored?.shown[pane.id];
    if (storedKey && pane.tabs.some(tab => focusTabKey(tab) === storedKey)) return [pane.id, storedKey];
    return [pane.id, pane.tabs[0] ? focusTabKey(pane.tabs[0]) : null];
  }));
  const recent = [...new Set([...(stored?.recent || []).filter(pane => ids.includes(pane)), ...ids])];
  // A pane's history holds only its open tabs, each once, led by the shown one.
  const history = Object.fromEntries(panes.map(pane => {
    const open = new Set(pane.tabs.map(focusTabKey));
    const keys = [shown[pane.id], ...(stored?.history[pane.id] || [])].filter((value): value is string => value !== null && open.has(value));
    return [pane.id, [...new Set(keys)]];
  }));
  const hideToolbar = Object.fromEntries(ids.map(id => [id, stored?.hideToolbar[id] === true]));
  return { activePane, shown, recent, history, ratios: stored?.ratios || {}, hideToolbar };
}

export function activatePane(entry: FocusEntryView, pane: string): FocusEntryView {
  return { ...entry, activePane: pane, recent: [pane, ...entry.recent.filter(p => p !== pane)] };
}

export function showTab(entry: FocusEntryView, pane: string, key: string): FocusEntryView {
  return activatePane({ ...entry, shown: { ...entry.shown, [pane]: key }, history: { ...entry.history, [pane]: [key, ...(entry.history[pane] || []).filter(value => value !== key)] } }, pane);
}

/** The pane a row clicked in the browse region opens into. */
export function browseTarget(entry: FocusEntryView): string {
  return entry.activePane;
}

/** For lane cards and [[links]] opened from inside a pane: the most recently used pane other than the source, in pane order `panes`; undefined when there is no other pane. */
export function sideTarget(entry: FocusEntryView, source: string, panes: readonly string[]): string | undefined {
  if (panes.length <= 1) return undefined;
  return entry.recent.find(pane => pane !== source && panes.includes(pane)) ?? panes[(panes.indexOf(source) + 1) % panes.length];
}

/**
 * Given the layout before closing `key` in `pane` and that pane's tab history, the key that should be shown afterward:
 * the tab shown there before it, as a stack; else the next tab right, else left, else none.
 */
export function shownAfterClose(layout: FocusLayout, pane: string, key: string, history: readonly string[] = []): string | null {
  const tabs = findFocusPane(layout, pane)?.tabs ?? [];
  const index = tabs.findIndex(tab => focusTabKey(tab) === key);
  if (index === -1) return null;
  const previous = history.find(value => value !== key && tabs.some(tab => focusTabKey(tab) === value));
  if (previous) return previous;
  const right = tabs[index + 1];
  if (right) return focusTabKey(right);
  const left = tabs[index - 1];
  return left ? focusTabKey(left) : null;
}

/** Narrow screens display several stored panes as one merged pane; picks which stored pane and key to show for it. */
export function groupShown(entry: FocusEntryView, layout: FocusLayout, group: readonly string[]): { pane: string; key: string | null; } {
  const keyIn = (pane: string): string | null => {
    const key = entry.shown[pane];
    return key && findFocusPane(layout, pane)?.tabs.some(tab => focusTabKey(tab) === key) ? key : null;
  };
  if (group.includes(entry.activePane)) return { pane: entry.activePane, key: keyIn(entry.activePane) };
  for (const pane of group) {
    const key = keyIn(pane);
    if (key) return { pane, key };
  }
  return { pane: group[0], key: null };
}

/** One pane on screen: the stored panes it stands for, and the stored pane and tab key it currently shows. */
export interface DisplayedPane {
  panes: string[];
  pane: string;
  key: string | null;
}

/** What the screen shows at `capacity` panes (1, 2 or all): the display tree and one entry per displayed pane, in display order. */
export function displayedPanes(entry: FocusEntryView, layout: FocusLayout, capacity: 1 | 2 | 'all'): { root: FocusDisplay['root']; panes: DisplayedPane[]; } {
  const display = displayFocus(layout, capacity);
  return { root: display.root, panes: display.groups.map(group => ({ panes: group, ...groupShown(entry, layout, group) })) };
}

type Ratios = FocusEntryView['ratios'];

const parentSplit = (layout: FocusLayout, id: string): FocusSplitNode | undefined => splitNodes(layout.root).find(split => split.children.some(child => child.id === id));

/** A split's sizes: the stored ones while they cover exactly its children, else equal shares. */
function sizesOf(ratios: Ratios, split: FocusSplitNode): Record<string, number> {
  const stored = ratios[split.id];
  const covers = stored !== undefined && Object.keys(stored).length === split.children.length && split.children.every(child => typeof stored[child.id] === 'number');
  return covers ? stored : Object.fromEntries(split.children.map(child => [child.id, 100 / split.children.length]));
}

/**
 * The sizes after pane `created` was split off `target`. Beside a pane in a split along the same axis the new pane takes half of the target's share;
 * a wrapped pane starts a split of 50/50 that keeps the share the pane had in its parent.
 */
export function splitRatios(ratios: Ratios, before: FocusLayout, after: FocusLayout, target: string, created: string): Ratios {
  const parent = parentSplit(after, created);
  if (!parent) return ratios;
  const old = splitNodes(before.root).find(split => split.id === parent.id);
  if (old?.children.some(child => child.id === target)) {
    const sizes = sizesOf(ratios, old), half = sizes[target] / 2;
    return { ...ratios, [parent.id]: { ...sizes, [target]: half, [created]: half } };
  }
  const next: Ratios = { ...ratios, [parent.id]: { [target]: 50, [created]: 50 } };
  const grand = parentSplit(before, target);
  if (grand) {
    const sizes = sizesOf(ratios, grand);
    next[grand.id] = Object.fromEntries(Object.entries(sizes).map(([child, size]) => [child === target ? parent.id : child, size]));
  }
  return next;
}

/**
 * The sizes after `removed` left the layout: its share goes to the previous sibling, else the next. A split left with one child is replaced by it, which
 * keeps the share the split had; a child split along the grandparent's axis is flattened into it, each of its children keeping its part of that share.
 */
export function collapseRatios(ratios: Ratios, before: FocusLayout, removed: string): Ratios {
  const parent = parentSplit(before, removed);
  if (!parent) return ratios;
  const sizes = sizesOf(ratios, parent), index = parent.children.findIndex(child => child.id === removed);
  const neighbour = parent.children[index - 1] ?? parent.children[index + 1];
  const { [removed]: share, ...rest } = sizes;
  const next: Ratios = { ...ratios };
  delete next[parent.id];
  if (parent.children.length > 2) return { ...next, [parent.id]: { ...rest, [neighbour.id]: rest[neighbour.id] + share } };
  const grand = parentSplit(before, parent.id);
  if (!grand) return next;
  const grandSizes = sizesOf(ratios, grand), flattened = neighbour.kind === 'split' && neighbour.orientation === grand.orientation;
  const inner = neighbour.kind === 'split' ? sizesOf(ratios, neighbour) : {};
  if (flattened) delete next[neighbour.id];
  next[grand.id] = Object.fromEntries(
    Object.entries(grandSizes).flatMap(([child, size]): [string, number][] => {
      if (child !== parent.id) return [[child, size]];
      return flattened ? Object.entries(inner).map(([grandchild, part]): [string, number] => [grandchild, size * part / 100]) : [[neighbour.id, size]];
    }),
  );
  return next;
}

/** `entry` kept to what `layout` still has: state of removed panes and sizes of removed splits are dropped, and the active pane falls back to the most recently used one left. */
export function retainPanes(entry: FocusEntryView, layout: FocusLayout): FocusEntryView {
  const panes = focusPanes(layout).map(pane => pane.id), splits = splitNodes(layout.root).map(split => split.id);
  const keep = <T>(record: Record<string, T>, ids: string[]) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.includes(id)));
  const recent = entry.recent.filter(pane => panes.includes(pane));
  return { activePane: panes.includes(entry.activePane) ? entry.activePane : recent[0] ?? panes[0], shown: keep(entry.shown, panes), recent, history: keep(entry.history, panes), ratios: keep(entry.ratios, splits), hideToolbar: keep(entry.hideToolbar, panes) };
}
