import YAML from 'yaml';

// MGN reads frontmatter with the YAML 1.2 core schema. A string with no written style of its own (a new key, or a note
// rendered without a source) is still written so a YAML 1.1 reader or js-yaml reads it as text too: one those readers would
// resolve to another type (e.g. a date, a sexagesimal number, or yes/no) is double-quoted. A string that keeps the style
// its source wrote is left as written, only quoted where MGN itself would read the plain form as another value.
const yaml11 = new YAML.Schema({ schema: 'yaml-1.1' }).tags;
// js-yaml's default schema also resolves signed 0o octals and some timestamp forms
// outside yaml's matchers (e.g. a bare fractional dot or a two-digit offset past 29).
const jsTimestamp = /^\d{4}-(?:\d{2}-\d{2}|\d{1,2}-\d{1,2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::\d{2})?))?)$/;
function readerTypes(text: string): string {
  const match = yaml11.find(tag => tag.default && 'test' in tag && tag.test instanceof RegExp && tag.test.test(text));
  const legacy = match?.tag.split(':').pop() ?? 'str';
  const js = jsTimestamp.test(text) ? 'timestamp'
    : /^[-+]?0o[0-7]+$/.test(text) ? 'number'
    : /^(?:true|false)$/i.test(text) ? 'bool'
    : /^(?:int|float)$/.test(legacy) && !/[:_]/.test(text) ? 'number' : 'str';
  return `${legacy === 'int' || legacy === 'float' ? 'number' : legacy}:${js}`;
}

/** Plain `text` that a YAML 1.1 reader or js-yaml resolves to something other than a string. */
function readsAsOtherType(text: string): boolean {
  return readerTypes(text) !== 'str:str';
}

const QUOTED = ['QUOTE_SINGLE', 'QUOTE_DOUBLE'];
const BLOCK = ['BLOCK_LITERAL', 'BLOCK_FOLDED'];

/** Gives `target` the scalar style its source `source` was written in, where the new text can keep it. */
function carryScalarStyle(target: YAML.Scalar, source: YAML.Scalar): void {
  if (typeof target.value !== 'string' || !source.type) return;
  const multiline = target.value.includes('\n');
  // Quoted text reads back as the same string whatever it holds; plain text the serializer still quotes where the YAML 1.2
  // core schema would read it as another value; a block scalar is kept only for text that still spans lines.
  if (QUOTED.includes(source.type) || source.type === 'PLAIN' && !multiline && readerTypes(source.source ?? String(source.value)) === readerTypes(target.value) || BLOCK.includes(source.type) && multiline) target.type = source.type;
}

const sameKey = (a: unknown, b: unknown) => YAML.isScalar(a) && YAML.isScalar(b) && String(a.value) === String(b.value);

/**
 * Copies the styles `source` was written in onto the matching nodes of `target`: a map's keys and values by key, a
 * sequence's collections by value (then position) and its bare scalars by equal text (each source item once). A quoted item of a list,
 * such as a tag, is not carried: a rewritten list drops quotes its items do not need. A node with no match keeps no style,
 * so `quotePortably` decides it.
 */
export function carrySourceStyle(target: unknown, source: unknown): void {
  if (YAML.isScalar(target) && YAML.isScalar(source)) return carryScalarStyle(target, source);
  if (YAML.isMap(target) && YAML.isMap(source)) {
    for (const pair of target.items) {
      const from = source.items.find(item => sameKey(item.key, pair.key));
      if (!from) continue;
      if (YAML.isScalar(pair.key) && YAML.isScalar(from.key)) carryScalarStyle(pair.key, from.key);
      carrySourceStyle(pair.value, from.value);
    }
    return;
  }
  if (YAML.isSeq(target) && YAML.isSeq(source)) {
    const unused = source.items.filter(item => YAML.isScalar(item) && item.type === 'PLAIN') as YAML.Scalar[];
    const collections = source.items.map(item => YAML.isCollection(item) ? JSON.stringify(item.toJSON()) : undefined);
    const matches = target.items.map(item => {
      if (!YAML.isCollection(item)) return -1;
      const at = collections.indexOf(JSON.stringify(item.toJSON()));
      if (at !== -1) collections[at] = undefined;
      return at;
    });
    target.items.forEach((item, index) => {
      if (!YAML.isScalar(item)) return carrySourceStyle(item, source.items[matches[index] !== -1 ? matches[index] : collections[index] !== undefined ? index : -1]);
      const at = unused.findIndex(candidate => candidate.value === item.value);
      if (at === -1) return;
      carryScalarStyle(item, unused[at]);
      unused.splice(at, 1);
    });
  }
}

/** Double-quotes every string under `node` that has no style yet and that a YAML 1.1 reader or js-yaml would read otherwise, keys included. */
export function quotePortably(node: YAML.Document | YAML.Node): void {
  YAML.visit(node, {
    Scalar(_, scalar) {
      if (!scalar.type && typeof scalar.value === 'string' && readsAsOtherType(scalar.value)) scalar.type = 'QUOTE_DOUBLE';
    },
  });
}

/** The parsed top-level node of a frontmatter YAML text, to take styles from; undefined when it does not parse. */
export function frontmatterStyleSource(yaml: string | undefined): YAML.Node | undefined {
  if (yaml === undefined) return undefined;
  const document = YAML.parseDocument(yaml);
  return document.errors.length || !YAML.isNode(document.contents) ? undefined : document.contents;
}

/**
 * A document of `value` for frontmatter: nodes that match `source` (the frontmatter they replace) keep its styles, and
 * the rest are quoted where another YAML reader would read them as other than text.
 */
export function createFrontmatterDocument(value: unknown, source?: unknown): YAML.Document {
  const document = new YAML.Document(value);
  if (source !== undefined) carrySourceStyle(document.contents, source);
  quotePortably(document);
  return document;
}

export function stringifyFrontmatterYaml(value: unknown, options?: YAML.ToStringOptions): string {
  return createFrontmatterDocument(value).toString(options);
}
