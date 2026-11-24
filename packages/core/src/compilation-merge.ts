import { type CompilationFile, type CompilationFileItem, parseCompilation, serializeCompilation } from './compilation.js';
import type { BoardArrow, BoardCard, BoardSection, BoardText, CompilationBoard } from './compilation-board.js';
import { compilationExtensions, extensionsFromValues, extensionValues } from './compilation-yaml.js';

/** Deep equality of parsed YAML values; an absent key equals one holding `undefined`. */
export function sameCompilationValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameCompilationValue(value, b[index]));
  if (plain(a) && plain(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameCompilationValue(a[key], b[key]));
  return false;
}
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A conflict, or the merged value; `undefined` means absent. */
type Merged<T> = { conflict: true; } | { conflict: false; value: T | undefined; };
const CONFLICT = { conflict: true } as const;

/** One side changed it: that side; both changed it the same: that; both differently: a conflict. Taken whole. */
function mergeWhole<T>(base: T | undefined, local: T | undefined, remote: T | undefined): Merged<T> {
  if (sameCompilationValue(local, remote) || sameCompilationValue(base, remote)) return { conflict: false, value: local };
  if (sameCompilationValue(base, local)) return { conflict: false, value: remote };
  return CONFLICT;
}

/** As `mergeWhole`, but a mapping changed on both sides merges key by key, so two edits of different keys both stand. */
function mergeFields(base: unknown, local: unknown, remote: unknown): Merged<unknown> {
  const whole = mergeWhole(base, local, remote);
  if (!whole.conflict || !plain(base) || !plain(local) || !plain(remote)) return whole;
  const value: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const merged = mergeFields(base[key], local[key], remote[key]);
    if (merged.conflict) return merged;
    if (merged.value !== undefined) value[key] = merged.value;
  }
  return { conflict: false, value };
}

/** Whether `side` keeps the keys it shares with `base` in base's order. */
function keepsOrder(base: readonly string[], side: readonly string[]): boolean {
  const shared = new Set(side);
  const before = base.filter(key => shared.has(key));
  const kept = new Set(base);
  const after = side.filter(key => kept.has(key));
  return before.every((key, index) => key === after[index]);
}

/**
 * Merges a list of entries keyed by `keyOf`, each entry taken whole by `mergeWhole`: an entry one side moved, added or
 * removed is that side's, and both sides changing one entry differently is a conflict. The order is the side that
 * reordered its shared entries (local when neither or both did alike; both reordering differently is a conflict), with
 * the other side's additions placed after the entry they follow there; one that ended that side's list, or the run
 * before a `boundary` entry, ends it in the result too, as an item added to the end of a chapter stays at its end.
 */
function mergeList<T>(base: readonly T[], local: readonly T[], remote: readonly T[], keyOf: (entry: T) => string, boundary?: (entry: T) => boolean): Merged<T[]> {
  const index = (entries: readonly T[]) => new Map(entries.map(entry => [keyOf(entry), entry]));
  const [b, l, r] = [index(base), index(local), index(remote)];
  const values = new Map<string, T>();
  for (const key of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const merged = mergeWhole(b.get(key), l.get(key), r.get(key));
    if (merged.conflict) return CONFLICT;
    if (merged.value !== undefined) values.set(key, merged.value);
  }
  const [baseKeys, localKeys, remoteKeys] = [[...b.keys()], [...l.keys()], [...r.keys()]];
  const localKept = keepsOrder(baseKeys, localKeys), remoteKept = keepsOrder(baseKeys, remoteKeys);
  if (!localKept && !remoteKept) {
    const everywhere = (keys: readonly string[]) => keys.filter(key => b.has(key) && l.has(key) && r.has(key));
    if (!sameCompilationValue(everywhere(localKeys), everywhere(remoteKeys))) return CONFLICT;
  }
  const [lead, other] = !localKept || remoteKept ? [localKeys, remoteKeys] : [remoteKeys, localKeys];
  const order = lead.filter(key => values.has(key));
  const [leadSide, otherSide] = [new Set(lead), new Set(other)];
  other.forEach((key, at) => {
    if (!values.has(key) || leadSide.has(key)) return;
    // An addition that ended the other side's list, or a run up to a boundary (a chapter's heading), still ends it.
    const next = other.slice(at + 1).find(candidate => leadSide.has(candidate) && values.has(candidate));
    if (next === undefined || boundary?.(values.get(next)!)) {
      order.splice(next === undefined ? order.length : order.indexOf(next), 0, key);
      return;
    }
    let after = -1;
    for (let previous = at - 1; previous >= 0 && after < 0; previous--) after = order.indexOf(other[previous]);
    // Entries the lead side added at the same place come first.
    while (after + 1 < order.length && !b.has(order[after + 1]) && !otherSide.has(order[after + 1])) after++;
    order.splice(after + 1, 0, key);
  });
  return { conflict: false, value: order.map(key => values.get(key)!) };
}

const cardKey = (card: BoardCard) => 'item' in card ? `item:${card.item}` : `path:${card.path}`;
const sectionKey = (section: BoardSection) => 'item' in section ? `item:${section.item}` : `folder:${section.folder}`;
const byId = (entry: BoardText | BoardArrow) => entry.id;

function mergeBoard(base: CompilationBoard | undefined, local: CompilationBoard | undefined, remote: CompilationBoard | undefined): Merged<CompilationBoard> {
  const board: Record<string, unknown[]> = {};
  const lists = [['sections', sectionKey], ['cards', cardKey], ['texts', byId], ['arrows', byId]] as const;
  for (const [name, keyOf] of lists) {
    const sides = [base, local, remote].map(side => side?.[name] as unknown[] | undefined);
    const merged = mergeList(sides[0] ?? [], sides[1] ?? [], sides[2] ?? [], keyOf as (entry: unknown) => string);
    if (merged.conflict) return merged;
    // An emptied list stays written only while both sides still write it.
    if (merged.value!.length || (sides[1] && sides[2])) board[name] = merged.value!;
  }
  if (!Object.keys(board).length && !(local && remote)) return { conflict: false, value: undefined };
  return { conflict: false, value: board as CompilationBoard };
}

/** The fields merged as values; `items` and `board` merge by entry. */
const FIELDS = ['version', 'id', 'title', 'description', 'arrangement', 'size', 'tags', 'status', 'source', 'sort', 'group', 'manualOrder', 'study', 'progression', 'graph'] as const;

/**
 * Merges two compilations made from `base` by entry: items by id; board cards by item or path, sections by heading or
 * folder, texts and arrows by id; every other field, and each external field, as a value. One side's change wins, equal
 * changes agree, and different changes of one entry or field conflict. Undefined when an external field has a key that
 * is not a scalar, which cannot be matched across files. The result is not validated: a merge of valid files can
 * still name what the other side removed.
 */
export function mergeCompilationFiles(base: CompilationFile, local: CompilationFile, remote: CompilationFile): { conflict: true; } | { conflict: false; file: CompilationFile; } | undefined {
  const file: Record<string | symbol, unknown> = {};
  for (const field of FIELDS) {
    const merged = mergeFields(base[field], local[field], remote[field]);
    if (merged.conflict) return CONFLICT;
    if (merged.value !== undefined) file[field] = merged.value;
  }
  if (base.items || local.items || remote.items) {
    const items = mergeList(base.items ?? [], local.items ?? [], remote.items ?? [], item => item.id, item => item.kind === 'heading');
    if (items.conflict) return CONFLICT;
    // A custom compilation keeps `items`, even empty; one a side turned dynamic (its `source` merged above) drops them.
    if (items.value!.length || !file.source) file.items = items.value;
  }
  const board = mergeBoard(base.board, local.board, remote.board);
  if (board.conflict) return CONFLICT;
  if (board.value) file.board = board.value;

  const sides = [base, local, remote].map(side => side[compilationExtensions]);
  const values = sides.map(extensionValues);
  if (values.some(value => value === undefined)) return undefined;
  const [baseValues, localValues, remoteValues] = values as Map<unknown, unknown>[];
  const external = new Map<unknown, unknown>();
  for (const key of new Set([...localValues.keys(), ...remoteValues.keys(), ...baseValues.keys()])) {
    const merged = mergeWhole(baseValues.get(key), localValues.get(key), remoteValues.get(key));
    if (merged.conflict) return CONFLICT;
    if (merged.value !== undefined) external.set(key, merged.value);
  }
  // A side's own entries keep their YAML style, comments and anchors when the merge leaves that side's external fields as they are.
  const sameAs = (other: Map<unknown, unknown>) => other.size === external.size && [...external].every(([key, value]) => other.has(key) && sameCompilationValue(other.get(key), value));
  const extensions = sameAs(localValues) ? sides[1] : sameAs(remoteValues) ? sides[2] : extensionsFromValues(external, sides[1] ?? sides[2]);
  if (extensions) file[compilationExtensions] = extensions;
  return { conflict: false, file: file as unknown as CompilationFile };
}

/** An item in the key order the app writes it (`compilationFile`), rather than the schema's. */
const writtenItem = (item: CompilationFileItem): CompilationFileItem => item.kind === 'note' || item.kind === 'folder' || item.kind === 'asset' ? { id: item.id, kind: item.kind, path: item.path, ...(item.kind === 'note' && item.anchor ? { anchor: item.anchor } : {}) } as CompilationFileItem : item;

/**
 * Merges two edits of one compilation file made from `base` by entry (`mergeCompilationFiles`), so two people moving
 * cards on neighbouring lines both keep their move. The merged file is written in the normal order, with the board's
 * one-line entries, and must read as a valid compilation, else the edits conflict; a result equal to one side keeps
 * that side's text. Undefined when a side is not a valid compilation or its external fields cannot be matched: the
 * caller merges lines then.
 */
export function mergeCompilationText(base: string, local: string, remote: string): { conflict: true; } | { conflict: false; text: string; } | undefined {
  let files: CompilationFile[];
  try {
    files = [base, local, remote].map(raw => parseCompilation(raw));
  } catch {
    return undefined;
  }
  const merged = mergeCompilationFiles(files[0], files[1], files[2]);
  if (!merged || merged.conflict) return merged;
  const equal = (side: CompilationFile) => sameCompilationValue(merged.file, side) && merged.file[compilationExtensions] === side[compilationExtensions];
  if (equal(files[1])) return { conflict: false, text: local };
  if (equal(files[2])) return { conflict: false, text: remote };
  const { items } = merged.file;
  const text = serializeCompilation({ ...merged.file, ...(items ? { items: items.map(writtenItem) } : {}) });
  try {
    parseCompilation(text);
  } catch {
    return CONFLICT;
  }
  return { conflict: false, text };
}
