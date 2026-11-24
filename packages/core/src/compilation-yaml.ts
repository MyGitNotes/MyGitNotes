import YAML, { type Document, type Pair, type YAMLMap } from 'yaml';

/** Treat extension entries as YAML nodes rather than JS object properties: keep key order, types and scalar style. */
export interface CompilationYamlExtensions {
  entries: readonly Pair[];
  schema: Document['schema'];
  directives: Document['directives'];
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
  return document.toString({ lineWidth: 0 });
}

/** Builds a fresh known section in the source schema so external tagged scalars can still stringify. */
export function writeCompilationYaml(known: object, extensions?: CompilationYamlExtensions): string {
  const document = new YAML.Document(known, { schema: extensions?.schema });
  if (extensions?.directives) document.directives = extensions.directives.clone();
  return stringifyCompilationYaml(document, extensions);
}
