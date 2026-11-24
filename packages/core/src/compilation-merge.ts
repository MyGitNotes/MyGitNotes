import { type CompilationFile, type CompilationFileItem, parseCompilation, serializeCompilation } from './compilation.js';
import type { BoardArrow, BoardCard, BoardSection, BoardText, CompilationBoard } from './compilation-board.js';
import { compilationExtensions, type CompilationYamlExtensions, extensionEntries, extensionsFromPairs } from './compilation-yaml.js';

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Deep equality of parsed YAML values; an absent key equals one holding `undefined`. Maps compare by typed key, so `1`
 * and `"1"` stay apart; dates by time, binary by bytes. Any other object equals only itself, so an unknown kind of value
 * reads as changed and conflicts rather than merging away.
 */
export function sameCompilationValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameCompilationValue(value, b[index]));
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map && a.size === b.size && [...a].every(([key, value]) => b.has(key) && sameCompilationValue(value, b.get(key)));
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set && a.size === b.size && [...a].every(value => b.has(value));
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && sameCompilationValue([...new Uint8Array(a.buffer, a.byteOffset, a.byteLength)], [...new Uint8Array(b.buffer, b.byteOffset, b.byteLength)]);
  if (plain(a) && plain(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameCompilationValue(a[key], b[key]));
  return false;
}

/** A conflict, or the merged value; `undefined` means absent. */
type Merged<T> = { conflict: true; } | { conflict: false; value: T | undefined; };
const CONFLICT = { conflict: true } as const;

/** Which side's value stands: one side changed it, that side; both changed it alike, local; both differently, neither. */
function winner(base: unknown, local: unknown, remote: unknown): 'local' | 'remote' | undefined {
  if (sameCompilationValue(local, remote) || sameCompilationValue(base, remote)) return 'local';
  if (sameCompilationValue(base, local)) return 'remote';
}

/** The value of the side that stands, taken whole. */
function mergeWhole<T>(base: T | undefined, local: T | undefined, remote: T | undefined): Merged<T> {
  const side = winner(base, local, remote);
  return side ? { conflict: false, value: side === 'local' ? local : remote } : CONFLICT;
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
 * Merges a list of entries keyed by `keyOf`, each entry taken whole by `mergeWhole`: an entry one side changed, added
 * or removed is that side's, and both sides changing one entry differently is a conflict. The order is the side that
 * reordered its shared entries (local when neither or both did alike; both reordering differently is a conflict).
 *
 * `heading` marks the entries that start a chapter (a compilation's heading items). The other side's additions land in
 * the chapter they were added to: after the entry they follow there when it is still in that chapter, else at the
 * chapter's end, as an item added to the end of a chapter stays at its end; a chapter the lead side removed is a conflict.
 * An entry one side moved to another chapter while the other removed it is a conflict too. Without chapters, an addition
 * follows its entry, and one that ended the other side's list ends the merged list.
 */
function mergeList<T>(base: readonly T[], local: readonly T[], remote: readonly T[], keyOf: (entry: T) => string, isHeading?: (entry: T) => boolean): Merged<T[]> {
  const index = (entries: readonly T[]) => new Map(entries.map(entry => [keyOf(entry), entry]));
  const [b, l, r] = [index(base), index(local), index(remote)];
  const values = new Map<string, T>();
  for (const key of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const merged = mergeWhole(b.get(key), l.get(key), r.get(key));
    if (merged.conflict) return CONFLICT;
    if (merged.value !== undefined) values.set(key, merged.value);
  }
  const heading = (key: string) => {
    const entry = values.get(key) ?? b.get(key) ?? l.get(key) ?? r.get(key);
    return entry !== undefined && isHeading?.(entry) === true;
  };
  /** The heading whose chapter holds the entry at `at` (a heading holds itself); null before the first heading. */
  const chapterAt = (keys: readonly string[], at: number) => {
    for (let position = at; position >= 0; position--) if (heading(keys[position])) return keys[position];
    return null;
  };
  const chapterOf = (keys: readonly string[], key: string) => chapterAt(keys, keys.indexOf(key));
  const [baseKeys, localKeys, remoteKeys] = [[...b.keys()], [...l.keys()], [...r.keys()]];
  for (const key of baseKeys) {
    if (heading(key)) continue;
    for (const [kept, keys, removed] of [[l, localKeys, r], [r, remoteKeys, l]] as const) {
      if (kept.has(key) && !removed.has(key) && chapterOf(keys, key) !== chapterOf(baseKeys, key)) return CONFLICT;
    }
  }
  const localKept = keepsOrder(baseKeys, localKeys), remoteKept = keepsOrder(baseKeys, remoteKeys);
  if (!localKept && !remoteKept) {
    const everywhere = (keys: readonly string[]) => keys.filter(key => b.has(key) && l.has(key) && r.has(key));
    if (!sameCompilationValue(everywhere(localKeys), everywhere(remoteKeys))) return CONFLICT;
  }
  const [lead, other] = !localKept || remoteKept ? [localKeys, remoteKeys] : [remoteKeys, localKeys];
  const order = lead.filter(key => values.has(key));
  const [leadSide, otherSide] = [new Set(lead), new Set(other)];
  /** Where the chapter `chapter` starts ends in the merged order: before the next heading, or at the end. */
  const chapterEnd = (chapter: string | null) => {
    let at = chapter === null ? 0 : order.indexOf(chapter) + 1;
    while (at < order.length && !heading(order[at])) at++;
    return at;
  };
  for (const [at, key] of other.entries()) {
    if (!values.has(key) || leadSide.has(key)) continue;
    const chapter = chapterAt(other, at - 1);
    if (chapter !== null && !order.includes(chapter)) return CONFLICT;
    const next = other.slice(at + 1).find(candidate => values.has(candidate));
    const anchor = other.slice(0, at).reverse().find(candidate => order.includes(candidate));
    if (next === undefined || heading(next) || (anchor !== undefined && chapterOf(order, anchor) !== chapter)) {
      order.splice(chapterEnd(chapter), 0, key);
      continue;
    }
    let after = anchor === undefined ? -1 : order.indexOf(anchor);
    // Entries the lead side added at the same place come first.
    while (after + 1 < order.length && !b.has(order[after + 1]) && !otherSide.has(order[after + 1]) && !heading(order[after + 1])) after++;
    order.splice(after + 1, 0, key);
  }
  return { conflict: false, value: order.map(key => values.get(key)!) };
}

const cardKey = (card: BoardCard) => 'item' in card ? `item:${card.item}` : `path:${card.path}`;
const sectionKey = (section: BoardSection) => 'item' in section ? `item:${section.item}` : `folder:${section.folder}`;
const byId = (entry: BoardText | BoardArrow) => entry.id;

/** Whether a board list or the board stays written: when it holds entries, or when the side whose presence stands has it, as an empty `board: {}` one side added. */
function present(entries: boolean, base: unknown, local: unknown, remote: unknown): boolean {
  if (entries) return true;
  return winner(base !== undefined, local !== undefined, remote !== undefined) === 'local' ? local !== undefined : remote !== undefined;
}

function mergeBoard(base: CompilationBoard | undefined, local: CompilationBoard | undefined, remote: CompilationBoard | undefined): Merged<CompilationBoard> {
  const board: Record<string, unknown[]> = {};
  const lists = [['sections', sectionKey], ['cards', cardKey], ['texts', byId], ['arrows', byId]] as const;
  for (const [name, keyOf] of lists) {
    const sides = [base, local, remote].map(side => side?.[name] as unknown[] | undefined);
    const merged = mergeList(sides[0] ?? [], sides[1] ?? [], sides[2] ?? [], keyOf as (entry: unknown) => string);
    if (merged.conflict) return merged;
    if (present(merged.value!.length > 0, sides[0], sides[1], sides[2])) board[name] = merged.value!;
  }
  return { conflict: false, value: present(Object.keys(board).length > 0, base, local, remote) ? board as CompilationBoard : undefined };
}

/**
 * The external fields of the merge, each merged whole by `winner`. A side's own entries are kept as written (style,
 * comments, anchors) when the merge leaves that side's external fields as they are; otherwise the standing entries of
 * both sides are combined, local's order first. Undefined when that cannot be done without loss: a key that is not a
 * scalar, or an alias or anchor in an entry that would be combined with the other side's.
 */
function mergeExtensions(sides: (CompilationYamlExtensions | undefined)[]): Merged<CompilationYamlExtensions> | undefined {
  const entries = sides.map(extensionEntries);
  if (entries.some(side => side === undefined)) return undefined;
  const [base, local, remote] = entries as NonNullable<(typeof entries)[number]>[];
  const kept: { key: unknown; from: 'local' | 'remote'; }[] = [];
  for (const key of new Set([...local.keys(), ...remote.keys(), ...base.keys()])) {
    const side = winner(base.get(key)?.value, local.get(key)?.value, remote.get(key)?.value);
    if (!side) return CONFLICT;
    if ((side === 'local' ? local : remote).has(key)) kept.push({ key, from: side });
  }
  const valueOf = ({ key, from }: (typeof kept)[number]) => (from === 'local' ? local : remote).get(key)!.value;
  const whole = (own: typeof local) => kept.length === own.size && kept.every(entry => own.has(entry.key) && sameCompilationValue(own.get(entry.key)!.value, valueOf(entry)));
  if (whole(local)) return { conflict: false, value: sides[1] };
  if (whole(remote)) return { conflict: false, value: sides[2] };
  const pairs = kept.map(({ key, from }) => (from === 'local' ? local : remote).get(key)!);
  if (pairs.some(pair => pair.linked)) return undefined;
  return { conflict: false, value: extensionsFromPairs(pairs.map(pair => pair.pair), sides[1] ?? sides[2]) };
}

/** The fields merged as values; `items` and `board` merge by entry. */
const FIELDS = ['version', 'id', 'title', 'description', 'arrangement', 'size', 'tags', 'status', 'source', 'sort', 'group', 'manualOrder', 'study', 'progression', 'graph'] as const;

/**
 * Merges two compilations made from `base` by entry: items by id; board cards by item or path, sections by heading or
 * folder, texts and arrows by id; every other field, and each external field, as a value. One side's change wins, equal
 * changes agree, and different changes of one entry or field conflict. Undefined when the external fields cannot be
 * merged without loss (`mergeExtensions`). The result is not validated: a merge of valid files can still name what the
 * other side removed.
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
  const extensions = mergeExtensions([base, local, remote].map(side => side[compilationExtensions]));
  if (!extensions || extensions.conflict) return extensions;
  if (extensions.value) file[compilationExtensions] = extensions.value;
  return { conflict: false, file: file as unknown as CompilationFile };
}

/** An item in the key order the app writes it (`compilationFile`), rather than the schema's. */
const writtenItem = (item: CompilationFileItem): CompilationFileItem => item.kind === 'note' || item.kind === 'folder' || item.kind === 'asset' ? { id: item.id, kind: item.kind, path: item.path, ...(item.kind === 'note' && item.anchor ? { anchor: item.anchor } : {}) } as CompilationFileItem : item;

/**
 * Merges two edits of one compilation file made from `base` by entry (`mergeCompilationFiles`), so two people moving
 * cards on neighbouring lines both keep their move. The merged file is written in the normal order, with the board's
 * one-line entries, and must read as a valid compilation, else the edits conflict; a result equal to one side keeps
 * that side's text. Undefined when a side is not a valid compilation or its external fields cannot be merged: the
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
