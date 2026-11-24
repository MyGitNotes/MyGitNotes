import YAML, { type Document, type Pair, type YAMLMap } from 'yaml';

/** Treat extension entries as YAML nodes rather than JS object properties: keep key order, types and scalar style. */
export interface CompilationYamlExtensions {
  entries: readonly Pair[];
  schema: Document['schema'];
  directives: Document['directives'];
}

/** Where a parsed compilation keeps its extensions: opaque to MGN and not part of any listing/API metadata; enumerable so row and file spreads carry it through edits. */
export const compilationExtensions = Symbol('compilation extensions');

/** The JS values of extension entries, by key; undefined when a key is not a scalar, which cannot be matched across files. */
export function extensionValues(extensions: CompilationYamlExtensions | undefined): Map<unknown, unknown> | undefined {
  const values = new Map<unknown, unknown>();
  if (!extensions) return values;
  const document = new YAML.Document(new YAML.YAMLMap(), { schema: extensions.schema });
  (document.contents as YAMLMap).items = [...extensions.entries];
  for (const pair of extensions.entries) {
    if (!YAML.isScalar(pair.key) || values.has(pair.key.value)) return undefined;
    values.set(pair.key.value, YAML.isNode(pair.value) ? pair.value.toJS(document, { maxAliasCount: 20 }) : pair.value);
  }
  return values;
}

/** Extension entries built from values, in the schema and directives of `like`; aliases inside them become plain copies. */
export function extensionsFromValues(values: ReadonlyMap<unknown, unknown>, like: CompilationYamlExtensions | undefined): CompilationYamlExtensions | undefined {
  if (!values.size) return;
  const document = new YAML.Document(null, { schema: like?.schema });
  if (like?.directives) document.directives = like.directives.clone();
  return { schema: document.schema, directives: document.directives, entries: (document.createNode(new Map(values), { aliasDuplicateObjects: false }) as YAMLMap).items as Pair[] };
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
