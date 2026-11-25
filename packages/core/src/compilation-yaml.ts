import YAML, { type Document, type Pair, type YAMLMap } from 'yaml';

/** Treat extension entries as YAML nodes rather than JS object properties: keep key order, types and scalar style. */
export interface CompilationYamlExtensions {
  entries: readonly Pair[];
  schema: Document['schema'];
  directives: Document['directives'];
}

/** Where a parsed compilation keeps its extensions: opaque to MGN and not part of any listing/API metadata; enumerable so row and file spreads carry it through edits. */
export const compilationExtensions = Symbol('compilation extensions');

/** An extension entry, with the shape its value is compared by and whether it holds an alias or anchor, which ties it to other entries. */
export interface ExtensionEntry {
  pair: Pair;
  value: unknown;
  linked: boolean;
}

/**
 * What a YAML node holds, as written: every scalar's typed value and explicit tag, maps as their ordered pairs (keys
 * compared the same way, so `1` and `"1"` stay apart), aliases by name. Two values with one shape are the same value.
 */
function nodeShape(node: unknown): unknown {
  if (YAML.isScalar(node)) return { tag: node.tag ?? null, scalar: node.value };
  if (YAML.isMap(node)) return { tag: node.tag ?? null, map: node.items.map(pair => [nodeShape(pair.key), nodeShape(pair.value)]) };
  if (YAML.isSeq(node)) return { tag: node.tag ?? null, seq: node.items.map(nodeShape) };
  if (YAML.isAlias(node)) return { alias: node.source };
  if (YAML.isPair(node)) return { pair: [nodeShape(node.key), nodeShape(node.value)] };
  return node ?? null;
}

/** The shape of all extension entries together, for files whose entries cannot be matched one by one. */
export const extensionsShape = (extensions: CompilationYamlExtensions | undefined): unknown => (extensions?.entries ?? []).map(nodeShape);

/** The extension entries by the shape of their key; undefined when a key is not a scalar or repeats, as such entries cannot be matched across files. */
export function extensionEntries(extensions: CompilationYamlExtensions | undefined): Map<string, ExtensionEntry> | undefined {
  const entries = new Map<string, ExtensionEntry>();
  for (const pair of extensions?.entries ?? []) {
    const key = YAML.isScalar(pair.key) ? JSON.stringify(nodeShape(pair.key)) : undefined;
    if (key === undefined || entries.has(key)) return undefined;
    let linked = Boolean((pair.key as YAML.Scalar).anchor);
    if (YAML.isNode(pair.value)) {
      YAML.visit(pair.value, {
        Node(_key, node) {
          if (YAML.isAlias(node) || node.anchor) linked = true;
        },
      });
    }
    entries.set(key, { pair, value: nodeShape(pair.value), linked });
  }
  return entries;
}

/** Extension entries made of `pairs`, copied as written, in the schema and directives of `like`. */
export function extensionsFromPairs(pairs: readonly Pair[], like: CompilationYamlExtensions | undefined): CompilationYamlExtensions | undefined {
  if (!pairs.length) return;
  const document = new YAML.Document(null, { schema: like?.schema });
  return { schema: document.schema, directives: like?.directives ? like.directives.clone() : document.directives, entries: pairs.map(pair => pair.clone()) };
}

/** Separates the extensions from a valid document so edits to known fields cannot affect them. */
export function takeCompilationExtensions(document: Document, knownKeys: ReadonlySet<string>): CompilationYamlExtensions | undefined {
  const map = document.contents;
  if (!YAML.isMap(map)) return;
  const isKnown = (key: unknown) => typeof key === 'string' && knownKeys.has(key);
  const known: Pair[] = [];
  const extensions: Pair[] = [];
  for (const pair of map.items) {
    (YAML.isScalar(pair.key) && isKnown(pair.key.value) ? known : extensions).push(pair);
  }
  if (!extensions.length) return;
  const context = { schema: document.schema, directives: document.directives };

  // A cross-section alias must keep its old value even if its target changes, disappears or moves after it.
  const extensionPairs = new Set(extensions);
  const extensionAnchors = new Set<unknown>();
  const aliases: { target: unknown; inExtension: boolean; }[] = [];
  YAML.visit(document, {
    Value(_key, node, path) {
      if (node.anchor && YAML.isPair(path[2]) && extensionPairs.has(path[2])) extensionAnchors.add(node);
    },
    Alias(_key, node, path) {
      aliases.push({ target: node.resolve(document), inExtension: YAML.isPair(path[2]) && extensionPairs.has(path[2]) });
    },
  });
  if (aliases.some(({ target, inExtension }) => extensionAnchors.has(target) !== inExtension)) {
    const values = document.toJS({ maxAliasCount: 20, mapAsMap: true }) as Map<unknown, unknown>;
    const knownValues = new Map<unknown, unknown>();
    const extensionValues = new Map<unknown, unknown>();
    for (const [key, value] of values) (isKnown(key) ? knownValues : extensionValues).set(key, value);
    map.items = (document.createNode(knownValues, { anchorPrefix: 'mgn' }) as YAMLMap).items;
    return { ...context, entries: (document.createNode(extensionValues, { anchorPrefix: 'ext' }) as YAMLMap).items };
  }
  map.items = known;
  return { ...context, entries: extensions };
}

/**
 * Whether two parsed YAML values are the same: mappings by their keys in any order, lists, `Map`s and `Set`s in order,
 * dates by their time. A value an alias makes cyclic compares as far as it differs, without running on forever.
 */
export function sameYamlValue(a: unknown, b: unknown, seen = new Map<object, Set<object>>()): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
  // A pair already being compared is taken as equal here; the comparison in progress decides it.
  const pairs = seen.get(a) ?? new Set<object>();
  if (pairs.has(b)) return true;
  seen.set(a, pairs.add(b));
  if (a instanceof Map || a instanceof Set || Array.isArray(a)) {
    const left = [...a as Iterable<unknown>], right = [...b as Iterable<unknown>];
    return left.length === right.length && left.every((entry, index) => sameYamlValue(entry, right[index], seen));
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameYamlValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen));
}

const lineStart = (raw: string, at: number) => raw.lastIndexOf('\n', at - 1) + 1;
/** The end of the line `at` is on, after its line break; `at` itself when it already starts a line. */
const lineEnd = (raw: string, at: number) => {
  if (at > 0 && raw[at - 1] === '\n') return at;
  const next = raw.indexOf('\n', at);
  return next < 0 ? raw.length : next + 1;
};

/** Where a block mapping entry's plain key starts its line and where its `:` ends, or undefined for any other key. */
function plainKey(raw: string, pair: Pair) {
  const key = pair.key;
  if (!YAML.isScalar(key) || key.type !== 'PLAIN' || key.anchor || key.tag || !key.range) return;
  // A byte order mark belongs before the first line, not to it.
  const start = Math.max(lineStart(raw, key.range[0]), raw.startsWith('\uFEFF') ? 1 : 0);
  const colon = /^[ \t]*:/.exec(raw.slice(key.range[1], key.range[1] + 64));
  if (raw.slice(start, key.range[0]).trim() || !colon) return;
  return { start, column: key.range[0] - start, colon: key.range[1] + colon[0].length };
}

/** The source of a node written on its own, in the YAML version of `document`, one line per scalar. */
function nodeSource(document: Document, node: YAML.Node, flowPadding = true): string {
  YAML.visit(node, {
    Scalar(_key, scalar) {
      if (typeof scalar.value === 'string' && /[\n\r]/.test(scalar.value)) scalar.type = 'QUOTE_DOUBLE';
    },
  });
  const out = new YAML.Document(null, { version: document.directives?.yaml.version });
  out.contents = node;
  return out.toString({ lineWidth: 0, doubleQuotedMinMultiLineLength: Number.MAX_SAFE_INTEGER, flowCollectionPadding: flowPadding }).replace(/\n$/, '');
}

/**
 * Sets (or, with `value` undefined, removes) one top-level field of a block mapping by replacing only that field's
 * source: every other byte, comment and line ending stays. A list keeps its flow or block style, a scalar its quotes,
 * while an explicit tag, an anchor and comments inside the old value go with it. A new field is written after the
 * last of the `after` fields the text holds. Undefined when the text is not shaped for that: no block mapping, or a
 * key that is not a plain scalar starting its line.
 */
export function spliceTopLevelField(raw: string, key: string, value: string | readonly string[] | undefined, after: readonly string[]): string | undefined {
  const document = YAML.parseDocument(raw);
  const map = document.contents;
  if (document.errors.length || !YAML.isMap(map) || map.flow || !map.items.length) return;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const named = (name: string) => (pair: Pair) => YAML.isScalar(pair.key) && pair.key.value === name;
  const pair = map.items.find(named(key));
  const old = pair && YAML.isNode(pair.value) ? pair.value : undefined;
  const block = (column: number) => nodeSource(document, document.createNode([...value as readonly string[]])).split('\n').map(line => ' '.repeat(column) + line).join(eol);
  if (pair) {
    const at = plainKey(raw, pair);
    if (!at) return;
    if (value === undefined) return raw.slice(0, at.start) + raw.slice(lineEnd(raw, old?.range?.[2] ?? at.colon));
    // An empty value ends where its field line does, before the line break and after any comment on it.
    const empty = !old?.range || old.range[0] === old.range[1];
    const lineEndAt = raw.slice(at.colon, lineEnd(raw, at.colon)).replace(/\r?\n$/, '').length + at.colon;
    const end = empty ? lineEndAt : old.range![1];
    if (end < at.colon) return;
    // A comment on the field's own line stays there, the value then starting the next line.
    const fieldLine = raw.slice(at.colon, empty ? lineEndAt : Math.min(old.range![0], lineEndAt));
    const comment = /(?:^|[ \t])#/.exec(fieldLine);
    const kept = comment ? fieldLine.slice(comment.index) : '';
    const below = (source: string, column: number) => kept + eol + ' '.repeat(column) + source;
    let source: string;
    if (typeof value === 'string') {
      const scalar = document.createNode(value) as YAML.Scalar;
      if (YAML.isScalar(old) && (old.type === 'QUOTE_DOUBLE' || old.type === 'QUOTE_SINGLE')) scalar.type = old.type;
      source = kept ? below(nodeSource(document, scalar), at.column + 2) : ` ${nodeSource(document, scalar)}`;
    } else if (YAML.isSeq(old) && old.flow) {
      const seq = nodeSource(document, document.createNode([...value], { flow: true }), raw[old.range![0] + 1] === ' ');
      source = kept ? below(seq, old.range![0] - lineStart(raw, old.range![0])) : ` ${seq}`;
    } else {
      const column = YAML.isSeq(old) ? old.range![0] - lineStart(raw, old.range![0]) : at.column + 2;
      source = kept + eol + block(column);
    }
    // A block value's source ends with its line break, which the next line needs whatever replaces it.
    if (raw.slice(at.colon, end).endsWith('\n')) source += eol;
    return raw.slice(0, at.colon) + source + raw.slice(end);
  }
  if (value === undefined) return raw;
  const previous = map.items.filter(item => after.some(name => named(name)(item))).at(-1);
  const anchor = plainKey(raw, previous ?? map.items[0]);
  if (!anchor) return;
  const at = previous ? lineEnd(raw, YAML.isNode(previous.value) && previous.value.range ? previous.value.range[2] : anchor.colon) : anchor.start;
  const source = typeof value === 'string' ? ` ${nodeSource(document, document.createNode(value))}` : eol + block(anchor.column + 2);
  return raw.slice(0, at) + (at && raw[at - 1] !== '\n' ? eol : '') + ' '.repeat(anchor.column) + key + ':' + source + eol + raw.slice(at);
}

/** Writes the known fields first, then the external fields in source order. */
export function stringifyCompilationYaml(document: Document, extensions?: CompilationYamlExtensions): string {
  if (extensions && YAML.isMap(document.contents)) document.contents.items.push(...extensions.entries);
  // A double-quoted scalar with line breaks stays on one line, as `\n`, however long: a board entry is one line.
  return document.toString({ lineWidth: 0, doubleQuotedMinMultiLineLength: Number.MAX_SAFE_INTEGER });
}

/** Writes each entry of the board's lists as a one-line flow mapping, so moving a card changes one line and adding an arrow adds one. */
function flowBoardEntries(document: Document) {
  const board = document.get('board', true);
  if (!YAML.isMap(board)) return;
  for (const pair of board.items) {
    if (!YAML.isSeq(pair.value)) continue;
    for (const entry of pair.value.items) {
      if (!YAML.isMap(entry)) continue;
      entry.flow = true;
      // A line break inside a flow mapping would spread it over lines; a double-quoted scalar writes it as `\n`.
      YAML.visit(entry, {
        Scalar(_key, scalar) {
          if (typeof scalar.value === 'string' && /[\n\r]/.test(scalar.value)) scalar.type = 'QUOTE_DOUBLE';
        },
      });
    }
  }
}

/** Builds a fresh known section in the source schema so external tagged scalars can still stringify. */
export function writeCompilationYaml(known: object, extensions?: CompilationYamlExtensions): string {
  const document = new YAML.Document(known, { schema: extensions?.schema });
  if (extensions?.directives) document.directives = extensions.directives.clone();
  flowBoardEntries(document);
  return stringifyCompilationYaml(document, extensions);
}
