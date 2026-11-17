import YAML from 'yaml';
import { NoteMetadata } from './types.js';
import { stampSaveTimestamps } from './note-timestamps.js';
import { FRONTMATTER_REGEX, patchFrontmatterField } from './frontmatter-patch.js';
import { NOTE_H1 } from './note-title.js';

export interface ParsedNote {
  metadata: NoteMetadata;
  content: string;
  title: string;
  hasFrontmatter: boolean;
  /** Number added to body-relative line numbers to reach the same line in the saved file. */
  lineNumberOffset: number;
}

/**
 * Extracts the first H1 heading from Markdown content.
 */
export function extractFirstH1(content: string): string | null {
  return content.match(NOTE_H1)?.[1] ?? null;
}

/**
 * Parses note file content, extracting optional YAML frontmatter and determining the title.
 */
export function parseNoteContent(rawContent: string, fallbackFilename?: string): ParsedNote {
  const match = rawContent.match(FRONTMATTER_REGEX);

  let metadata: NoteMetadata = {};
  let content = rawContent;
  let hasFrontmatter = false;
  let bodyStart = 0;

  if (match) {
    const rawYaml = match[1];
    try {
      const parsed = YAML.parse(rawYaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as NoteMetadata;
        hasFrontmatter = true;
        // The blank line the serializer writes after the closing fence separates, it is not body: left in, every
        // editor would open on an empty first line. `serializeNoteContent` writes it back.
        const rest = rawContent.slice(match[0].length);
        const separator = rest.match(/^[ \t]*\r?\n/)?.[0] ?? '';
        content = rest.slice(separator.length);
        bodyStart = match[0].length + separator.length;
      }
    } catch {
      // If frontmatter YAML is malformed, treat entire file as plain content
      metadata = {};
      hasFrontmatter = false;
      content = rawContent;
    }
  }

  // Derive title fallback
  let title = '';
  if (typeof metadata.title === 'string' && metadata.title.trim()) {
    title = metadata.title.trim();
  } else {
    const firstH1 = extractFirstH1(content);
    if (firstH1) {
      title = firstH1;
    } else if (fallbackFilename) {
      const name = fallbackFilename.split('/').pop() ?? fallbackFilename;
      const dot = name.lastIndexOf('.');
      title = dot > 0 ? name.slice(0, dot) : name;
    } else {
      title = 'Untitled';
    }
  }

  // Normalize tags
  if (metadata.tags && Array.isArray(metadata.tags)) {
    metadata.tags = metadata.tags.map(String);
  }

  return { metadata, content, title, hasFrontmatter, lineNumberOffset: hasFrontmatter ? (rawContent.slice(0, bodyStart).match(/\n/g) || []).length : 0 };
}

/** Forces a document's `created`/`updated` scalars to render double-quoted, matching existing note style. */
function quoteTimestampScalars(document: YAML.Document): void {
  for (const key of ['created', 'updated']) {
    if (typeof document.get(key) !== 'string') continue;
    const node = document.get(key, true);
    if (node instanceof YAML.Scalar) node.type = 'QUOTE_DOUBLE';
  }
}

function stringifyMetadata(metadata: NoteMetadata): string {
  const doc = new YAML.Document(metadata);
  quoteTimestampScalars(doc);
  return doc.toString();
}

/** Deep equality for parsed YAML and JSON values, without Node's util so the browser can serialize notes too. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * Patches an existing frontmatter block onto `metadata`: a key whose value is unchanged keeps
 * its original quoting, flow/block style, position and comments; a changed or new key is
 * written in place or appended; a key no longer present is removed. Returns `null` when `raw`
 * has no parsable frontmatter map, so the caller falls back to a full render.
 */
function patchNoteMetadata(raw: string, metadata: NoteMetadata): string | null {
  const { metadata: oldMetadata, hasFrontmatter } = parseNoteContent(raw);
  if (!hasFrontmatter) return null;
  let next = raw;
  for (const key of Object.keys(oldMetadata)) {
    if (!(key in metadata)) next = patchFrontmatterField(next, key, undefined);
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!sameValue(oldMetadata[key], value)) next = patchFrontmatterField(next, key, value);
  }
  return next;
}

/** A text's leading frontmatter block, as `parseNoteContent` reads it. */
export type NoteFrontmatterSpan =
  /** `end` is just past the closing fence, `bodyStart` past the blank separator line too. */
  | { yaml: string; end: number; bodyStart: number; metadata: NoteMetadata; }
  /**
   * A block `parseNoteContent` reads as body: its YAML does not parse to a map, or it has no closing fence. Then
   * `unclosed` is the line that starts with `---` yet has more on it (`---x`, `----`), through which the block runs,
   * or `''` when no line does and the block runs to the end of the text.
   */
  | { invalid: true; yaml: string; end: number; bodyStart: number; unclosed?: string; };

/** A text's first line is a lone `---`: it opens a frontmatter block, closed or not. */
const OPENING_FENCE = /^---\r?\n/;

/** The blank line after a block's last line, which separates it from the body. */
const separatorAt = (text: string, end: number) => text.slice(end).match(/^[ \t]*\r?\n/)?.[0] ?? '';

/**
 * A block opened by `---` that no fence closes: it runs through the first line that starts with `---`, or to the end
 * of the text. A lone `---` right after the opening closes an empty block, which does not parse to a map either.
 */
function unclosedSpan(text: string): NoteFrontmatterSpan | null {
  const opening = OPENING_FENCE.exec(text);
  if (!opening) return null;
  const start = opening[0].length;
  for (let at = start; at < text.length;) {
    const lineEnd = text.indexOf('\n', at);
    const next = lineEnd === -1 ? text.length : lineEnd + 1;
    if (text.startsWith('---', at)) {
      const line = text.slice(at, next).replace(/\r?\n$/, '');
      const yaml = text.slice(start, at).replace(/\r?\n$/, '');
      return { invalid: true, yaml, end: next, bodyStart: next + separatorAt(text, next).length, ...(/^---[ \t]*$/.test(line) ? {} : { unclosed: line }) };
    }
    at = next;
  }
  return { invalid: true, yaml: text.slice(start), end: text.length, bodyStart: text.length, unclosed: '' };
}

/**
 * Where a text's frontmatter is and what it holds, with the same fence, map check and separator
 * line as `parseNoteContent`; `null` when the text has no block. A text whose first line opens a
 * block that no fence closes has an invalid one. The collab editor hides `[0, bodyStart)` and
 * its panel reads `metadata` from it.
 */
export function noteFrontmatterSpan(text: string): NoteFrontmatterSpan | null {
  const match = text.match(FRONTMATTER_REGEX);
  if (!match) return unclosedSpan(text);
  const end = match[0].length;
  const bodyStart = end + separatorAt(text, end).length;
  const yaml = match[1];
  try {
    const parsed: unknown = YAML.parse(yaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const metadata = parsed as NoteMetadata;
      if (Array.isArray(metadata.tags)) metadata.tags = metadata.tags.map(String);
      return { yaml, end, bodyStart, metadata };
    }
  } catch {
    // falls through: invalid
  }
  return { invalid: true, yaml, end, bodyStart };
}

/**
 * Applies the keys that differ between `before` (what the caller showed) and `after` onto `raw`,
 * key by key, so every other key, comment, order and the body keep their bytes, and a key
 * someone else changed meanwhile is left as they wrote it. With no block a new one is rendered
 * before the body, in the body's line endings; an unparsable block is left alone. Nothing is stamped.
 */
export function patchNoteFrontmatter(raw: string, before: NoteMetadata, after: NoteMetadata): string {
  const span = noteFrontmatterSpan(raw);
  if (span && 'invalid' in span) return raw;
  if (!span) {
    const keys = Object.keys(after).filter(key => after[key] !== undefined);
    if (keys.length === 0) return raw;
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    const yamlStr = stringifyMetadata(Object.fromEntries(keys.map(key => [key, after[key]]))).trimEnd().replace(/\n/g, newline);
    return `---${newline}${yamlStr}${newline}---${newline}${raw ? newline + raw : ''}`;
  }
  let next = raw;
  for (const key of Object.keys(before)) {
    if (!(key in after) || after[key] === undefined) next = patchFrontmatterField(next, key, undefined);
  }
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && !sameValue(before[key], value)) next = patchFrontmatterField(next, key, value);
  }
  return next;
}

/**
 * Serializes metadata and Markdown body back into file format.
 * Preserves all unknown frontmatter keys. Stamps `created`/`updated`
 * (see `stampSaveTimestamps`) on every save; `isNew` must reflect whether
 * this note existed before this save, so an edit to a pre-existing note
 * that predates this feature never invents a `created` date.
 *
 * When `existingRaw` is the note's current file content and its Markdown body is unchanged,
 * the frontmatter is patched key by key onto that existing block instead of being rendered
 * from scratch, so a metadata-only edit (e.g. a status change) changes only the lines of the
 * keys it actually edits.
 */
export function serializeNoteContent(metadata: NoteMetadata, content: string, isNew: boolean, now: Date = new Date(), existingRaw?: string, preserveBodyWhitespace = false): string {
  const stamped = stampSaveTimestamps(metadata, isNew, now);
  const keys = Object.keys(stamped);
  const trimmedContent = content.trim();

  if (existingRaw !== undefined) {
    const existing = parseNoteContent(existingRaw);
    if (existing.hasFrontmatter && existing.content === content) {
      const patched = patchNoteMetadata(existingRaw, stamped);
      if (patched !== null) return patched;
    }
  }

  if (keys.length === 0) {
    return trimmedContent ? `${trimmedContent}\n` : '';
  }

  const yamlStr = stringifyMetadata(stamped).trim();
  // Outline markers and annotations are editable source: trimming an empty `- `
  // removes its content column, and trimming indentation can change its hierarchy.
  if (preserveBodyWhitespace && content) {
    const separator = /^[\r\n]/.test(content) ? '' : '\n';
    return `---\n${yamlStr}\n---\n${separator}${content}${content.endsWith('\n') ? '' : '\n'}`;
  }
  if (!trimmedContent) {
    return `---\n${yamlStr}\n---\n`;
  }

  return `---\n${yamlStr}\n---\n\n${trimmedContent}\n`;
}

/** Patch only status; keep the Markdown body and other YAML fields intact. */
export function replaceNoteStatus(raw: string, status: string | null): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (match && parseNoteContent(raw).hasFrontmatter) {
    const yaml = match[1];
    const document = YAML.parseDocument(yaml);
    if (!YAML.isMap(document.contents)) return raw;
    const map = document.contents;
    const index = map.items.findIndex(pair => YAML.isScalar(pair.key) && pair.key.value === 'status');
    const pair = map.items[index];
    if (!pair && status === null || pair && document.get('status') === status) return raw;
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    const offset = raw.indexOf('\n') + 1;
    const patch = (start: number, end: number, text: string) => raw.slice(0, offset + start) + text + raw.slice(offset + end);
    const node = new YAML.Scalar(status);
    if (YAML.isScalar(pair?.value) && ['QUOTE_SINGLE', 'QUOTE_DOUBLE'].includes(pair.value.type || '')) node.type = pair.value.type;
    const rendered = new YAML.Document(node).toString({ lineWidth: 0 }).trimEnd();
    if (!pair) {
      if (map.flow) {
        const end = yaml.lastIndexOf('}');
        return patch(end, end, `${map.items.length ? ', ' : ''}status: ${rendered}`);
      }
      return patch(yaml.length, yaml.length, `${newline}status: ${rendered}`);
    }
    const key = pair.key as YAML.Scalar;
    const value = pair.value as YAML.Node;
    if (status !== null) {
      const [start, end] = value.range!;
      const trailingNewline = yaml.slice(start, end).endsWith('\n') ? newline : '';
      const spacing = start === end && !/\s/.test(yaml[start - 1]) ? ' ' : '';
      return patch(start, end, spacing + rendered + trailingNewline);
    }
    let start = key.range![0], end = value.range![2];
    if (map.flow) {
      end = value.range![1];
      if (index < map.items.length - 1) end = (map.items[index + 1].key as YAML.Node).range![0];
      else if (index > 0) start = yaml.lastIndexOf(',', start);
    } else {
      start = yaml.lastIndexOf('\n', start - 1) + 1;
      // The extracted YAML omits the newline before the closing delimiter.
      if (end === yaml.length) end += newline.length;
    }
    return patch(start, end, !map.flow && map.items.length === 1 ? `{}${newline}` : '');
  }
  // A block that cannot be read keeps the text as it is, rather than a second block going in front of it (CFR2-F001):
  // the caller compares the result to tell.
  return status === null || OPENING_FENCE.test(raw) ? raw : `---\n${YAML.stringify({ status })}---\n${raw}`;
}

/**
 * Patch only the `tags` array; keep every other frontmatter field, the field's own flow/block
 * style, and the Markdown body byte-identical. The note is expected to already have a `tags`
 * key (callers only invoke this on notes already known to carry the tag being changed).
 */
export function replaceNoteTags(raw: string, tags: string[]): string {
  const match = raw.match(FRONTMATTER_REGEX);
  if (!match || !parseNoteContent(raw).hasFrontmatter) return raw;
  const yamlText = match[1];
  const document = YAML.parseDocument(yamlText);
  if (!YAML.isMap(document.contents)) return raw;
  const map = document.contents;
  const pair = map.items.find(item => YAML.isScalar(item.key) && item.key.value === 'tags');
  if (!pair || !YAML.isNode(pair.value) || !pair.value.range || !pair.key.range) return raw;

  const flow = YAML.isSeq(pair.value) ? pair.value.flow === true : false;
  const newDocument = new YAML.Document({ tags });
  if (flow && tags.length > 0) {
    const seqNode = newDocument.get('tags', true);
    if (YAML.isSeq(seqNode)) seqNode.flow = true;
  }
  const rendered = newDocument.toString({ lineWidth: 0, flowCollectionPadding: false });
  const withoutKey = rendered.slice('tags'.length);
  const hadTrailingNewline = yamlText.slice(pair.value.range[0], pair.value.range[1]).endsWith('\n');
  let replacement = !hadTrailingNewline && withoutKey.endsWith('\n') ? withoutKey.slice(0, -1) : withoutKey;
  if (match[0].includes('\r\n')) replacement = replacement.replace(/\n/g, '\r\n');

  const offset = raw.indexOf('\n') + 1;
  const start = offset + pair.key.range[1];
  const end = offset + pair.value.range[1];
  return raw.slice(0, start) + replacement + raw.slice(end);
}

function setQuoted(document: YAML.Document, key: string, value: string): void {
  const node = document.createNode(value) as YAML.Scalar;
  node.type = 'QUOTE_DOUBLE';
  document.set(key, node);
}

/**
 * Fills `created`/`updated` only where missing, from the given fallbacks.
 * Never overwrites an existing value or touches any other frontmatter key
 * or the Markdown body. Used by the one-time backfill command. A block it
 * cannot read (a fence that never closes, YAML that does not parse) is left
 * as it is and answered `unreadable`.
 */
export function fillMissingNoteTimestamps(raw: string, created: string | undefined, updated: string | undefined): { raw: string; changed: boolean; unreadable?: true; } {
  const match = raw.match(FRONTMATTER_REGEX);
  if (match && parseNoteContent(raw).hasFrontmatter) {
    const document = YAML.parseDocument(match[1]);
    const lines: string[] = [];
    if (!document.get('created') && created) lines.push(`created: ${JSON.stringify(created)}`);
    if (!document.get('updated') && updated) lines.push(`updated: ${JSON.stringify(updated)}`);
    if (lines.length === 0) return { raw, changed: false };
    // Append raw lines instead of re-serializing, so existing YAML keeps its original formatting.
    const newline = match[0].includes('\r\n') ? '\r\n' : '\n';
    const insertAt = `---${newline}`.length + match[1].length;
    return { raw: `${raw.slice(0, insertAt)}${lines.map(line => `${newline}${line}`).join('')}${raw.slice(insertAt)}`, changed: true };
  }
  // A block that cannot be read is not filled, nor given a second block in front of it (CFR2-F001), and says so.
  if (OPENING_FENCE.test(raw)) return { raw, changed: false, unreadable: true };

  const fields: [string, string][] = [];
  if (created) fields.push(['created', created]);
  if (updated) fields.push(['updated', updated]);
  if (fields.length === 0) return { raw, changed: false };
  const document = new YAML.Document({});
  for (const [key, value] of fields) setQuoted(document, key, value);
  return { raw: `---\n${document.toString()}---\n${raw}`, changed: true };
}
