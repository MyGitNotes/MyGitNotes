import { z } from 'zod';
import { NewerVersionError } from './newer-version-error.js';
import { KEY_SEPARATOR, NOTEBOOK_ID_MAX_LENGTH, NOTEBOOK_KEY_MAX_LENGTH } from './notebook-key.js';
import type { WorkspaceDocument } from './workspace-documents.js';

export const FOCUS_PAGE_FILE = '.github-notes-focus.yaml';
export const FOCUS_MAX_BYTES = 512 * 1024;
export const FOCUS_MAX_FOCUSES = 40;
export const FOCUS_MAX_PANES = 8;
/** Nested split levels a layout may have; a lone pane is depth 0. */
export const FOCUS_MAX_DEPTH = 4;
export const FOCUS_MAX_TABS = 100;
/** The version the Focus file is read into; version 1 (a division and a flat list of panes) is migrated on read. */
const FOCUS_VERSION = 2;

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */
// A local id on disk, a notebook key on the wire.
const notebookId = z.string().min(1).max(NOTEBOOK_KEY_MAX_LENGTH);
const focusName = z.string().trim().min(1).max(100);

/** A tab names a note or a compilation by its repository-relative path. */
export const FocusTabSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('note'), path: repoPath }).strict()]);
export type FocusTab = z.infer<typeof FocusTabSchema>;

export function focusTabKey(tab: FocusTab): string {
  return `note:${tab.path}`;
}

export type FocusOrientation = 'horizontal' | 'vertical';
/** A leaf of the layout: the tabs one pane holds. */
export interface FocusPaneNode {
  kind: 'pane';
  id: string;
  tabs: FocusTab[];
}
/** Children laid out along one axis: `horizontal` places them left to right, `vertical` top to bottom. */
export interface FocusSplitNode {
  kind: 'split';
  id: string;
  orientation: FocusOrientation;
  children: FocusNode[];
}
export type FocusNode = FocusPaneNode | FocusSplitNode;
export interface FocusLayout {
  root: FocusNode;
}
export interface Focus extends FocusLayout {
  id: string;
  notebookId: string;
  name: string;
}
export interface FocusPage {
  version: 2;
  focuses: Focus[];
}

const PaneNodeSchema = z.object({ kind: z.literal('pane'), id, tabs: z.array(FocusTabSchema) }).strict();
const SplitNodeSchema = z.object({ kind: z.literal('split'), id, orientation: z.enum(['horizontal', 'vertical']), children: z.array(z.lazy((): z.ZodType<FocusNode, z.ZodTypeDef, unknown> => FocusNodeSchema)).min(1) }).strict();
export const FocusNodeSchema: z.ZodType<FocusNode, z.ZodTypeDef, unknown> = z.discriminatedUnion('kind', [PaneNodeSchema, SplitNodeSchema]);

/** Whether a raw layout nests deeper than a valid one can, found without recursion so a hostile file cannot exhaust the stack of the schema that follows. */
function nestedTooDeep(root: unknown): boolean {
  const stack: [unknown, number][] = [[root, 1]];
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, level] = item;
    const children = (node as { children?: unknown; } | null)?.children;
    if (!Array.isArray(children)) continue;
    if (level > FOCUS_MAX_DEPTH + 1) return true;
    for (const child of children) stack.push([child, level + 1]);
  }
  return false;
}
/** Runs before a layout schema and stops the parse (an issue ends a `pipe`) when the layout nests too deeply. */
const guardDepth = z.unknown().superRefine((value, context) => {
  if (nestedTooDeep((value as { root?: unknown; } | null)?.root)) context.addIssue({ code: 'custom', message: 'Focus layout is nested too deeply' });
});

/** A note may sit in several panes at once; within one pane a tab key is unique. Drops a later duplicate, keeping the first. */
function normalizeNode(node: FocusNode): FocusNode {
  if (node.kind === 'pane') {
    const seen = new Set<string>();
    const tabs = node.tabs.filter(tab => {
      const key = focusTabKey(tab);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return tabs.length === node.tabs.length ? node : { ...node, tabs };
  }
  const children = node.children.map(normalizeNode).flatMap(child => child.kind === 'split' && child.orientation === node.orientation ? child.children : [child]);
  if (children.length === 1) return children[0];
  return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
}

/**
 * The canonical form of a layout: a split with one child is replaced by it, a split inside a split of the same orientation is
 * flattened into it, and a duplicate tab within a pane is dropped. Same reference when nothing changes.
 */
export function normalizeFocus<T extends FocusLayout>(layout: T): T {
  const root = normalizeNode(layout.root);
  return root === layout.root ? layout : { ...layout, root };
}

function layoutDepth(node: FocusNode): number {
  return node.kind === 'pane' ? 0 : 1 + Math.max(...node.children.map(layoutDepth));
}

/** Shared by a bare layout and a named Focus. Runs after `normalizeFocus`, so tab keys are already unique per pane. */
function checkFocusLayout(layout: FocusLayout, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  let panes = 0, tabs = 0;
  const stack = [layout.root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (ids.has(node.id)) context.addIssue({ code: 'custom', message: 'Duplicate Focus node id' });
    ids.add(node.id);
    if (node.kind === 'pane') {
      panes++;
      tabs += node.tabs.length;
    } else stack.push(...node.children);
  }
  if (panes > FOCUS_MAX_PANES) context.addIssue({ code: 'custom', message: 'Focus layout has too many panes' });
  if (layoutDepth(layout.root) > FOCUS_MAX_DEPTH) context.addIssue({ code: 'custom', message: 'Focus layout is nested too deeply' });
  if (tabs > FOCUS_MAX_TABS) context.addIssue({ code: 'custom', message: 'Focus layout has too many tabs' });
}

export const FocusLayoutSchema = guardDepth.pipe(z.object({ root: FocusNodeSchema }).strict().transform(normalizeFocus).superRefine(checkFocusLayout)) as z.ZodType<FocusLayout, z.ZodTypeDef, unknown>;
export const FocusSchema = guardDepth.pipe(z.object({ id, notebookId, name: focusName, root: FocusNodeSchema }).strict().transform(normalizeFocus).superRefine(checkFocusLayout)) as z.ZodType<Focus, z.ZodTypeDef, unknown>;

/** Focus ids are unique and a Focus name is unique within its notebook; shared by every stored version. */
function checkFocusPage(page: { focuses: { id: string; notebookId: string; name: string; }[]; }, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  const names = new Map<string, Set<string>>();
  for (const focus of page.focuses) {
    if (ids.has(focus.id)) context.addIssue({ code: 'custom', message: 'Duplicate Focus id' });
    ids.add(focus.id);
    const used = names.get(focus.notebookId) || new Set<string>();
    if (used.has(focus.name)) context.addIssue({ code: 'custom', message: 'Duplicate Focus name in notebook' });
    used.add(focus.name);
    names.set(focus.notebookId, used);
  }
}
export const FocusPageSchema = z.object({ version: z.literal(FOCUS_VERSION), focuses: z.array(FocusSchema).max(FOCUS_MAX_FOCUSES) }).strict().superRefine(checkFocusPage) as z.ZodType<FocusPage, z.ZodTypeDef, unknown>;

export class FocusError extends Error {
  constructor(public readonly code: 'tab-limit' | 'focus-limit' | 'duplicate-name' | 'unknown-focus' | 'invalid-pane' | 'pane-limit' | 'depth-limit', message: string) {
    super(message);
  }
}

export const emptyFocusPage = (): FocusPage => ({ version: FOCUS_VERSION, focuses: [] });
export const emptyFocusLayout = (): FocusLayout => ({ root: { kind: 'pane', id: 'p1', tabs: [] } });

/** Panes in depth-first order: left to right, top to bottom. This is the order wherever panes are numbered or cycled. */
export function focusPanes(layout: FocusLayout): FocusPaneNode[] {
  const panes: FocusPaneNode[] = [];
  const visit = (node: FocusNode) => {
    if (node.kind === 'pane') panes.push(node);
    else node.children.forEach(visit);
  };
  visit(layout.root);
  return panes;
}
export function findFocusPane(layout: FocusLayout, pane: string): FocusPaneNode | undefined {
  return focusPanes(layout).find(candidate => candidate.id === pane);
}
/** The position of `pane` in pane order, or -1. */
export function focusPaneIndex(layout: FocusLayout, pane: string): number {
  return focusPanes(layout).findIndex(candidate => candidate.id === pane);
}

// ---- Divisions: the seven fixed arrangements of version 1, kept to read old files and to write them while every Focus is one.

export const FOCUS_DIVISIONS = ['single', 'columns-2', 'rows-2', 'major-left', 'major-top', 'columns-3', 'grid-2x2'] as const;
export type FocusDivision = typeof FOCUS_DIVISIONS[number];
const PANE_COUNTS: Record<FocusDivision, number> = { single: 1, 'columns-2': 2, 'rows-2': 2, 'major-left': 3, 'major-top': 3, 'columns-3': 3, 'grid-2x2': 4 };

/**
 * A division's tree, from its panes' tabs. Pane `i` is `p<i+1>`, the root split is named after the division and child split `j` of split `X` is `X-j`,
 * so reading a version 1 file always gives the same ids and a device keeps the splitter sizes it recorded under the old group names.
 */
export function legacyFocusTree(division: FocusDivision, panes: readonly (readonly FocusTab[])[]): FocusNode {
  const pane = (index: number): FocusPaneNode => ({ kind: 'pane', id: `p${index + 1}`, tabs: [...panes[index]] });
  const split = (splitId: string, orientation: FocusOrientation, children: FocusNode[]): FocusSplitNode => ({ kind: 'split', id: splitId, orientation, children });
  switch (division) {
    case 'single':
      return pane(0);
    case 'columns-2':
      return split(division, 'horizontal', [pane(0), pane(1)]);
    case 'rows-2':
      return split(division, 'vertical', [pane(0), pane(1)]);
    case 'columns-3':
      return split(division, 'horizontal', [pane(0), pane(1), pane(2)]);
    case 'major-left':
      return split(division, 'horizontal', [pane(0), split(`${division}-1`, 'vertical', [pane(1), pane(2)])]);
    case 'major-top':
      return split(division, 'vertical', [pane(0), split(`${division}-1`, 'horizontal', [pane(1), pane(2)])]);
    case 'grid-2x2':
      return split(division, 'vertical', [split(`${division}-0`, 'horizontal', [pane(0), pane(1)]), split(`${division}-1`, 'horizontal', [pane(2), pane(3)])]);
  }
}

/** The shape of a node without its tabs, to compare layouts structurally. */
function skeleton(node: FocusNode): string {
  return node.kind === 'pane' ? node.id : `${node.id}:${node.orientation}(${node.children.map(skeleton).join(',')})`;
}

/** The division whose tree (ids included) `layout` is, if any. A layout that is none can only be stored as version 2. */
export function legacyDivisionOf(layout: FocusLayout): FocusDivision | undefined {
  const panes = focusPanes(layout);
  const shape = skeleton(layout.root);
  return FOCUS_DIVISIONS.find(division => PANE_COUNTS[division] === panes.length && skeleton(legacyFocusTree(division, panes.map(pane => pane.tabs))) === shape);
}

const LegacyPaneSchema = z.object({ tabs: z.array(FocusTabSchema) }).strict();
const legacyFields = { division: z.enum(FOCUS_DIVISIONS), panes: z.array(LegacyPaneSchema) };
function checkLegacyLayout(layout: { division: FocusDivision; panes: { tabs: FocusTab[]; }[]; }, context: z.RefinementCtx): void {
  if (layout.panes.length !== PANE_COUNTS[layout.division]) context.addIssue({ code: 'custom', message: 'Focus pane count must match the division' });
  if (layout.panes.reduce((sum, pane) => sum + pane.tabs.length, 0) > FOCUS_MAX_TABS) context.addIssue({ code: 'custom', message: 'Focus layout has too many tabs' });
}
const LegacyLayoutSchema = z.object(legacyFields).strict().superRefine(checkLegacyLayout);
const LegacyFocusSchema = z.object({ id, notebookId, name: focusName, ...legacyFields }).strict().superRefine(checkLegacyLayout);
/** Version 1 of the Focus file, as stored. */
const LegacyFocusPageSchema = z.object({ version: z.literal(1), focuses: z.array(LegacyFocusSchema).max(FOCUS_MAX_FOCUSES) }).strict().superRefine(checkFocusPage);
type LegacyLayout = z.infer<typeof LegacyLayoutSchema>;
type LegacyFocusPage = z.infer<typeof LegacyFocusPageSchema>;

const legacyTree = (layout: LegacyLayout): FocusNode => legacyFocusTree(layout.division, layout.panes.map(pane => pane.tabs));

/** A layout as this device stored it: the tree, or a version 1 division with its panes (a scratch Focus kept before the tree). Throws when it is neither. */
export function readFocusLayout(value: unknown): FocusLayout {
  if (typeof value === 'object' && value !== null && 'division' in value) return FocusLayoutSchema.parse({ root: legacyTree(LegacyLayoutSchema.parse(value)) });
  return FocusLayoutSchema.parse(value);
}

interface LegacyLaneTab {
  kind?: unknown;
}

/** Lane tabs belong to a workspace not yet migrated to compilations (`pnpm migrate-workspace`); they are left out of a version 1 file, so the rest of Focus still opens and files can still move, instead of every read failing on them. */
function withoutLaneTabs<T>(value: T): T {
  const focuses = (value as { focuses?: unknown; } | null)?.focuses;
  if (!Array.isArray(focuses)) return value;
  return {
    ...value,
    focuses: focuses.map(focus => {
      const panes = (focus as { panes?: unknown; } | null)?.panes;
      if (!Array.isArray(panes)) return focus;
      return { ...focus, panes: panes.map(pane => Array.isArray((pane as { tabs?: unknown; } | null)?.tabs) ? { ...pane, tabs: (pane as { tabs: LegacyLaneTab[]; }).tabs.filter(tab => tab?.kind !== 'lane') } : pane) };
    }),
  };
}

/**
 * Reads a Focus file of any stored version into the tree. A version 1 file migrates deterministically (`legacyFocusTree`): reading it
 * twice gives the same page. A version newer than this build understands fails with a `NewerVersionError`.
 */
export function readFocusPage(value: unknown): FocusPage {
  const version = (value as { version?: unknown; } | null)?.version;
  if (typeof version === 'number' && version > FOCUS_VERSION) throw new NewerVersionError('Focus');
  if (version !== 1) return FocusPageSchema.parse(value);
  const legacy = LegacyFocusPageSchema.parse(withoutLaneTabs(value));
  return FocusPageSchema.parse({ version: FOCUS_VERSION, focuses: legacy.focuses.map(({ division, panes, ...focus }) => ({ ...focus, root: legacyTree({ division, panes }) })) });
}

/**
 * What is stored for `page`. While every Focus is a division the file stays version 1, which a deployment that only knows version 1 still reads;
 * one Focus in another shape makes the whole file version 2.
 */
export function writeFocusPage(page: FocusPage): FocusPage | LegacyFocusPage {
  const divisions = page.focuses.map(legacyDivisionOf);
  if (!divisions.every((division): division is FocusDivision => division !== undefined)) return page;
  return { version: 1, focuses: page.focuses.map((focus, index) => ({ id: focus.id, notebookId: focus.notebookId, name: focus.name, division: divisions[index], panes: focusPanes(focus).map(pane => ({ tabs: pane.tabs })) })) };
}

/** First pane (in pane order) holding `key`, for UI heuristics that only need to know whether a tab exists somewhere — never for deciding where to place or remove one. */
export function findFocusTab(layout: FocusLayout, key: string): { pane: string; index: number; } | undefined {
  for (const pane of focusPanes(layout)) {
    const index = pane.tabs.findIndex(tab => focusTabKey(tab) === key);
    if (index !== -1) return { pane: pane.id, index };
  }
  return undefined;
}
/** `key`'s index within `pane` specifically, or -1. Placement and removal are pane-scoped: a tab may sit in several panes at once. */
export function findFocusTabInPane(layout: FocusLayout, pane: string, key: string): number {
  return findFocusPane(layout, pane)?.tabs.findIndex(tab => focusTabKey(tab) === key) ?? -1;
}
export function focusTabCount(layout: FocusLayout): number {
  return focusPanes(layout).reduce((total, pane) => total + pane.tabs.length, 0);
}

/** Replaces the panes `change` returns a new node for; untouched subtrees keep their references. */
function mapPanes(node: FocusNode, change: (pane: FocusPaneNode) => FocusPaneNode): FocusNode {
  if (node.kind === 'pane') return change(node);
  const children = node.children.map(child => mapPanes(child, change));
  return children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
}
function requirePane(layout: FocusLayout, pane: string): FocusPaneNode {
  const found = findFocusPane(layout, pane);
  if (!found) throw new FocusError('invalid-pane', 'Pane does not exist');
  return found;
}
function withTabs<T extends FocusLayout>(layout: T, pane: string, tabs: FocusTab[]): T {
  return { ...layout, root: mapPanes(layout.root, current => current.id === pane ? { ...current, tabs } : current) };
}

/** Places `tab` in `pane` only: a tab already open in another pane is untouched there, so the same note may end up open in several panes. Already in `pane`, it moves to `index` instead of duplicating. */
export function placeTab<T extends FocusLayout>(layout: T, tab: FocusTab, pane: string, index?: number): T {
  const target = [...requirePane(layout, pane).tabs];
  const key = focusTabKey(tab);
  const existingIndex = target.findIndex(current => focusTabKey(current) === key);
  if (existingIndex === -1 && focusTabCount(layout) >= FOCUS_MAX_TABS) throw new FocusError('tab-limit', 'Focus layout has too many tabs');
  if (existingIndex !== -1) target.splice(existingIndex, 1);
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, tab);
  return withTabs(layout, pane, target);
}

/** Places several tabs in `pane` in one pass (one mutation instead of one per tab): each is placed only if `pane` does not already hold it. */
export function placeTabs<T extends FocusLayout>(layout: T, tabs: FocusTab[], pane: string): { layout: T; added: number; skipped: number; } {
  const target = [...requirePane(layout, pane).tabs];
  const held = new Set(target.map(focusTabKey));
  let total = focusTabCount(layout), added = 0, skipped = 0;
  for (const tab of tabs) {
    const key = focusTabKey(tab);
    if (held.has(key) || total >= FOCUS_MAX_TABS) {
      skipped++;
      continue;
    }
    target.push(tab);
    held.add(key);
    total++;
    added++;
  }
  return { layout: withTabs(layout, pane, target), added, skipped };
}

/** The id for a new node of `layout`: `prefix` and the smallest number not used by any pane or split, such as `p3` or `s2`. */
export function nextFocusId(layout: FocusLayout, prefix: 'p' | 's'): string {
  const used = new Set<string>();
  const visit = (node: FocusNode) => {
    used.add(node.id);
    if (node.kind === 'split') node.children.forEach(visit);
  };
  visit(layout.root);
  let number = 1;
  while (used.has(`${prefix}${number}`)) number++;
  return `${prefix}${number}`;
}

/** `pane` and its tabs removed from the tree; a split left with one child is replaced by it. The only pane of a layout becomes empty instead. */
function withoutPane<T extends FocusLayout>(layout: T, pane: string): T {
  const remove = (node: FocusNode): FocusNode | undefined => {
    if (node.kind === 'pane') return node.id === pane ? undefined : node;
    const children = node.children.flatMap(child => remove(child) ?? []);
    if (children.length === node.children.length && children.every((child, index) => child === node.children[index])) return node;
    return children.length > 0 ? { ...node, children } : undefined;
  };
  const root = remove(layout.root);
  return normalizeFocus(root ? { ...layout, root } : { ...layout, root: { kind: 'pane', id: pane, tabs: [] } });
}

/** Removes `key` from `fromPane`, then places it in `toPane` (a no-op move when they're the same pane and the tab is already there). A source pane left empty is removed. Used for an explicit cross-pane move; `placeTab` alone never removes a tab from another pane. */
export function moveTab<T extends FocusLayout>(layout: T, fromPane: string, toPane: string, key: string, index?: number): T {
  const source = requirePane(layout, fromPane);
  const removeIndex = source.tabs.findIndex(tab => focusTabKey(tab) === key);
  if (removeIndex === -1) throw new FocusError('invalid-pane', 'Tab is not in the source pane');
  const emptied = fromPane !== toPane && source.tabs.length === 1;
  const withoutSource = fromPane === toPane ? layout : withTabs(layout, fromPane, source.tabs.filter((_, i) => i !== removeIndex));
  const placed = placeTab(withoutSource, source.tabs[removeIndex], toPane, index);
  return emptied ? withoutPane(placed, fromPane) : placed;
}

/** Removes `key` from `pane`. A pane left empty is removed too, unless it is the only pane. */
export function closeTab<T extends FocusLayout>(layout: T, pane: string, key: string): T {
  const current = findFocusPane(layout, pane);
  const index = current?.tabs.findIndex(tab => focusTabKey(tab) === key) ?? -1;
  if (!current || index === -1) return layout;
  const closed = withTabs(layout, pane, current.tabs.filter((_, i) => i !== index));
  return current.tabs.length === 1 && layout.root.kind === 'split' ? withoutPane(closed, pane) : closed;
}

/** Removes `pane` with its tabs, for an empty pane (D4). The only pane of a layout is emptied instead. */
export function closePane<T extends FocusLayout>(layout: T, pane: string): T {
  requirePane(layout, pane);
  return withoutPane(layout, pane);
}

export type FocusEdge = 'left' | 'right' | 'top' | 'bottom';
export const edgeOrientation = (edge: FocusEdge): FocusOrientation => edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';

/**
 * Opens a new pane holding `tab` on the `edge` side of `pane`. Beside a pane whose parent splits along the edge's axis the new pane joins that split;
 * otherwise the pane is wrapped in a split of its own. Throws `pane-limit`, `depth-limit` or `tab-limit` instead of building a layout over a limit.
 */
export function splitPane<T extends FocusLayout>(layout: T, pane: string, edge: FocusEdge, tab: FocusTab): { layout: T; pane: string; } {
  requirePane(layout, pane);
  if (focusPanes(layout).length >= FOCUS_MAX_PANES) throw new FocusError('pane-limit', 'Focus layout has too many panes');
  if (focusTabCount(layout) >= FOCUS_MAX_TABS) throw new FocusError('tab-limit', 'Focus layout has too many tabs');
  const created = nextFocusId(layout, 'p'), wrapper = nextFocusId(layout, 's');
  const orientation = edgeOrientation(edge), first = edge === 'left' || edge === 'top';
  const fresh: FocusPaneNode = { kind: 'pane', id: created, tabs: [tab] };
  const insert = (node: FocusNode): FocusNode => {
    if (node.kind === 'pane') {
      return node.id === pane ? { kind: 'split', id: wrapper, orientation, children: first ? [fresh, node] : [node, fresh] } : node;
    }
    const index = node.children.findIndex(child => child.id === pane);
    if (index !== -1 && node.orientation === orientation) {
      const children = [...node.children];
      children.splice(first ? index : index + 1, 0, fresh);
      return { ...node, children };
    }
    return { ...node, children: node.children.map(insert) };
  };
  const next = normalizeFocus({ ...layout, root: insert(layout.root) });
  if (layoutDepth(next.root) > FOCUS_MAX_DEPTH) throw new FocusError('depth-limit', 'Focus layout is nested too deeply');
  return { layout: next, pane: created };
}

/** Moves the tab `key` of `from` into a new pane on the `edge` side of `target`. A source pane left empty is removed first, which can free the room the new pane needs. A no-op when `from` is `target` and holds only that tab. */
export function moveTabToSplit<T extends FocusLayout>(layout: T, from: string, key: string, target: string, edge: FocusEdge): { layout: T; pane: string; } {
  const source = requirePane(layout, from);
  requirePane(layout, target);
  const tab = source.tabs.find(candidate => focusTabKey(candidate) === key);
  if (!tab) throw new FocusError('invalid-pane', 'Tab is not in the source pane');
  if (from === target && source.tabs.length === 1) return { layout, pane: from };
  const removed = withTabs(layout, from, source.tabs.filter(candidate => candidate !== tab));
  return splitPane(source.tabs.length === 1 ? withoutPane(removed, from) : removed, target, edge, tab);
}

/** Folds every pane's tabs, in pane order and without duplicates, into one pane that keeps the first pane's id. */
export function mergePanes<T extends FocusLayout>(layout: T): T {
  if (layout.root.kind === 'pane') return layout;
  const panes = focusPanes(layout), seen = new Set<string>();
  const tabs = panes.flatMap(pane => pane.tabs).filter(tab => !seen.has(focusTabKey(tab)) && seen.add(focusTabKey(tab)));
  return { ...layout, root: { kind: 'pane', id: panes[0].id, tabs } };
}

export function pruneFocus<T extends FocusLayout>(layout: T, exists: (tab: FocusTab) => boolean): T {
  const root = mapPanes(layout.root, pane => {
    const tabs = pane.tabs.filter(exists);
    return tabs.length === pane.tabs.length ? pane : { ...pane, tabs };
  });
  return root === layout.root ? layout : { ...layout, root };
}

/** A pane of what the screen shows: the stored panes it stands for, in pane order. */
export interface DisplayLeaf {
  kind: 'pane';
  /** The first stored pane's id. */
  id: string;
  panes: string[];
}
export interface DisplaySplit {
  kind: 'split';
  id: string;
  orientation: FocusOrientation;
  children: DisplayNode[];
}
export type DisplayNode = DisplayLeaf | DisplaySplit;
/** What the screen shows at a capacity: the layout, and the stored panes behind each displayed pane in display order. */
export interface FocusDisplay {
  root: DisplayNode;
  groups: string[][];
}

const leafOf = (panes: FocusPaneNode[]): DisplayLeaf => ({ kind: 'pane', id: panes[0].id, panes: panes.map(pane => pane.id) });
function displayOf(node: FocusNode): DisplayNode {
  return node.kind === 'pane' ? leafOf([node]) : { kind: 'split', id: node.id, orientation: node.orientation, children: node.children.map(displayOf) };
}

/**
 * Narrow-screen display: with room for every pane (`'all'`) the stored tree; on a phone (1) one pane holding every tab; on a tablet (2) the root split's first
 * child as one pane and everything else as the other, along the root's orientation.
 */
export function displayFocus(layout: FocusLayout, capacity: 1 | 2 | 'all'): FocusDisplay {
  const panes = focusPanes(layout);
  const display = (root: DisplayNode): FocusDisplay => ({ root, groups: displayPanes(root) });
  if (capacity === 'all' || panes.length <= capacity) return display(displayOf(layout.root));
  if (capacity === 1 || layout.root.kind === 'pane') return display(leafOf(panes));
  const first = focusPanes({ root: layout.root.children[0] });
  return display({ kind: 'split', id: 'display-2', orientation: layout.root.orientation, children: [leafOf(first), leafOf(panes.slice(first.length))] });
}
function displayPanes(node: DisplayNode): string[][] {
  return node.kind === 'pane' ? [node.panes] : node.children.flatMap(displayPanes);
}

/** Mutates `layout` in place, pointing each note tab at the path `move` gives it. Returns whether any note path changed. */
export function relocateFocusLayout(layout: FocusLayout, move: (path: string) => string): boolean {
  let changed = false;
  for (const pane of focusPanes(layout)) {
    for (const tab of pane.tabs) {
      const next = move(tab.path);
      if (next !== tab.path) {
        tab.path = next;
        changed = true;
      }
    }
  }
  return changed;
}

/** Mutates `page` in place, matching Screen relocation (see file-manager.ts). Returns whether any note path changed. */
export function relocateFocusPaths(page: FocusPage, notebookId: string, move: (path: string) => string): boolean {
  let changed = false;
  for (const focus of page.focuses) if (focus.notebookId === notebookId && relocateFocusLayout(focus, move)) changed = true;
  return changed;
}

export function notebookFocuses(page: FocusPage, notebookId: string): Focus[] {
  return page.focuses.filter(focus => focus.notebookId === notebookId);
}

export function nameFocus(page: FocusPage, layout: FocusLayout, notebookId: string, name: string): { page: FocusPage; focus: Focus; } {
  if (page.focuses.length >= FOCUS_MAX_FOCUSES) throw new FocusError('focus-limit', 'Too many Focus entries');
  const trimmed = name.trim();
  if (page.focuses.some(focus => focus.notebookId === notebookId && focus.name === trimmed)) throw new FocusError('duplicate-name', 'Focus name already used in this notebook');
  const focus = { id: globalThis.crypto.randomUUID(), notebookId, name: trimmed, root: layout.root };
  const next = FocusPageSchema.parse({ ...page, focuses: [...page.focuses, focus] });
  return { page: next, focus: next.focuses[next.focuses.length - 1] };
}

export function renameFocus(page: FocusPage, id: string, name: string): FocusPage {
  const focus = page.focuses.find(focus => focus.id === id);
  if (!focus) throw new FocusError('unknown-focus', 'Unknown Focus');
  const trimmed = name.trim();
  if (trimmed !== focus.name && page.focuses.some(other => other.notebookId === focus.notebookId && other.name === trimmed)) {
    throw new FocusError('duplicate-name', 'Focus name already used in this notebook');
  }
  return FocusPageSchema.parse({ ...page, focuses: page.focuses.map(f => f.id === id ? { ...f, name: trimmed } : f) });
}

export function updateFocus(page: FocusPage, id: string, change: (focus: Focus) => Focus): FocusPage {
  if (!page.focuses.some(focus => focus.id === id)) throw new FocusError('unknown-focus', 'Unknown Focus');
  return FocusPageSchema.parse({ ...page, focuses: page.focuses.map(focus => focus.id === id ? change(focus) : focus) });
}

export function removeFocus(page: FocusPage, id: string): FocusPage {
  if (!page.focuses.some(focus => focus.id === id)) return page;
  return { ...page, focuses: page.focuses.filter(focus => focus.id !== id) };
}

const within = (path: string, root: string) => path === root || path.startsWith(root + '/');

/** Tab content must belong to the Focus's notebook: a note or compilation by its notebook root. */
export function foreignFocusTab(tab: FocusTab, notebookId: string, notebooks: readonly { id: string; root: string; }[]): boolean {
  const owner = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(notebook => within(tab.path, notebook.root));
  return owner?.id !== notebookId;
}

/**
 * Drops every tab that belongs to another notebook and reports whether any was dropped. `notebooks` are
 * those this document's repository serves; a Focus of any other notebook is kept unchanged.
 */
export function ownFocusPage(page: FocusPage, notebooks: readonly { id: string; root: string; }[]): { page: FocusPage; foreign: boolean; } {
  let foreign = false;
  const focuses = page.focuses.map(focus =>
    !notebooks.some(notebook => notebook.id === focus.notebookId) ? focus : pruneFocus(focus, tab => {
      const outside = foreignFocusTab(tab, focus.notebookId, notebooks);
      if (outside) foreign = true;
      return !outside;
    })
  );
  return foreign ? { page: { ...page, focuses }, foreign } : { page, foreign };
}

/** The Focus file as stored, in any version it is read from: every Focus names its notebook by local id. */
const FocusFileSchema = z.union([LegacyFocusPageSchema, FocusPageSchema]).refine(page => page.focuses.every(focus => focus.notebookId.length <= NOTEBOOK_ID_MAX_LENGTH && !focus.notebookId.includes(KEY_SEPARATOR)), 'A stored Focus names its notebook by local id, never by key.');

export const FOCUS_DOCUMENT: WorkspaceDocument<FocusPage> = { file: FOCUS_PAGE_FILE, label: 'Focus', maxBytes: FOCUS_MAX_BYTES, scopes: ['focus', 'folders', 'files'], schema: FocusPageSchema, fileSchema: FocusFileSchema, empty: emptyFocusPage, read: readFocusPage, write: writeFocusPage, relocate: (page, notebook, move) => relocateFocusPaths(page, notebook.id, move), own: ownFocusPage, mapNotebookIds: (page, map) => ({ ...page, focuses: page.focuses.map(focus => ({ ...focus, notebookId: map(focus.notebookId) })) }) };
