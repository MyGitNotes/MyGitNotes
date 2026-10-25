/**
 * The image-annotation directive's syntax: `:::annotate` holds one Markdown image line and a list of rows
 * `- {#id pin x=41.2% y=23.3% [resolved] [by=alice]} comment`. Block errors throw {@link AnnotateError} (the caller shows the
 * figure error box); a bad row never throws, it keeps its text and carries `problems`. Every node keeps its source range so
 * `edit.ts` can change one token without touching the bytes around it.
 */

import { matchDirectiveClose, parseDirectiveOpen, parseDirectiveTitle } from '../directives.js';

export const ANNOTATE_DIRECTIVE = 'annotate';

export type AnnotationKind = 'pin' | 'region';

export type RowProblemCode = 'malformed' | 'missing-id' | 'invalid-id' | 'duplicate-id' | 'missing-kind' | 'unknown-kind' | 'missing-key' | 'invalid-value' | 'out-of-range' | 'unknown-token' | 'duplicate-key' | 'page-on-image';

export interface RowProblem {
  code: RowProblemCode;
  /** The key or token the problem is about. */
  detail?: string;
}

export interface SourceRange {
  from: number;
  to: number;
}

/** One word of a row's `{…}` head, with the range it occupies in the block's source. `key` is `#` for the id and `kind` for the kind word. */
export interface HeadToken extends SourceRange {
  key: string;
  /** The text after `=`, quotes removed; undefined for a bare word. */
  value?: string;
}

export interface AnnotationRow {
  /** The number shown on the marker; undefined when missing or invalid. */
  id?: number;
  kind?: AnnotationKind;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  resolved: boolean;
  by?: string;
  /** The row's Markdown, continuation lines without their indent. */
  comment: string;
  /** The row's whole text, from its bullet to the end of its last non-blank line. */
  range: SourceRange;
  /** The `{…}` head, braces included; a collapsed range at the text start when the row has none. */
  headRange: SourceRange;
  tokens: HeadToken[];
  problems: RowProblem[];
  /** Whether the geometry is complete and in range, so the row can draw a marker. */
  hasGeometry: boolean;
}

export interface AnnotateMedia {
  alt: string;
  src: string;
  title?: string;
  range: SourceRange;
}

export interface ParsedAnnotate {
  title?: string;
  media: AnnotateMedia;
  rows: AnnotationRow[];
}

/** A whole-block error; the caller shows it in the figure's place. */
export class AnnotateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnotateError';
  }
}

export function isAnnotateName(name: string): boolean {
  return name === ANNOTATE_DIRECTIVE;
}

function fail(message: string): never {
  throw new AnnotateError(message);
}

const EPSILON = 1e-9;
const IMAGE = /^!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)$/;
const REFERENCE_IMAGE = /^!\[[^\]]*\]\s*(?:\[[^\]]*\])?$/;
const LIST_ITEM = /^( {0,3})([-*+])(?:([ \t]+)|$)/;
const PERCENT = /^(\d+(?:\.\d+)?)%$/;
const GEOMETRY_KEYS = ['x', 'y', 'w', 'h'] as const;

interface Line {
  text: string;
  from: number;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const text of source.split('\n')) {
    lines.push({ text, from });
    from += text.length + 1;
  }
  return lines;
}

const indentOf = (text: string): number => /^ */.exec(text)![0].length;

/** Two decimals is all a coordinate reads. */
const roundCoordinate = (value: number): number => Math.round(value * 100) / 100;

function readMedia(line: Line): AnnotateMedia {
  const text = line.text.trim();
  const lead = line.text.length - line.text.trimStart().length;
  const match = IMAGE.exec(text);
  if (!match) {
    if (REFERENCE_IMAGE.test(text)) fail('a reference-style image is not supported: write the image inline, ![alt](path)');
    if (/!\[[^\]]*\]\(/.test(text)) fail('the body holds exactly one image and nothing else on its line');
    fail('the first body line must be a Markdown image, ![alt](path)');
  }
  if ((text.match(/!\[/g) ?? []).length > 1) fail('the body holds exactly one image');
  const rawSrc = match[2];
  const src = rawSrc.startsWith('<') ? rawSrc.slice(1, -1) : rawSrc;
  return { alt: match[1], src, title: match[3], range: { from: line.from + lead, to: line.from + lead + text.length } };
}

/** The words of a row head's inner text, with a quoted value kept whole. */
function readWords(inner: string, base: number): HeadToken[] {
  const tokens: HeadToken[] = [];
  let i = 0;
  while (i < inner.length) {
    if (/\s/.test(inner[i])) {
      i++;
      continue;
    }
    const start = i;
    let quoted = false;
    while (i < inner.length && (quoted || !/\s/.test(inner[i]))) {
      if (inner[i] === '"') quoted = !quoted;
      i++;
    }
    const word = inner.slice(start, i);
    const equals = word.indexOf('=');
    const key = equals < 0 ? word : word.slice(0, equals);
    let value = equals < 0 ? undefined : word.slice(equals + 1);
    if (value !== undefined && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    tokens.push({ key, value, from: base + start, to: base + i });
  }
  return tokens;
}

/** The `}` that closes a head opened at `open`, outside quotes; -1 when it never closes. */
function headEnd(text: string, open: number): number {
  let quoted = false;
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === '}' && !quoted) return i;
  }
  return -1;
}

interface RowDraft {
  lines: Line[];
}

function parseRow(draft: RowDraft): AnnotationRow {
  const [first, ...rest] = draft.lines;
  const bullet = LIST_ITEM.exec(first.text)!;
  const textStart = bullet[0].length;
  const lastLine = draft.lines[draft.lines.length - 1];
  const range: SourceRange = { from: first.from + bullet[1].length, to: lastLine.from + lastLine.text.replace(/\s+$/, '').length };
  const row: AnnotationRow = { resolved: false, comment: '', range, headRange: { from: first.from + textStart, to: first.from + textStart }, tokens: [], problems: [], hasGeometry: false };

  const continuation = rest.map(line => line.text.replace(/^ {1,2}/, '')).join('\n');
  const withContinuation = (head: string): string => [head, ...continuation ? [continuation] : []].join('\n').replace(/\s+$/, '');

  const open = first.text[textStart] === '{' ? textStart : -1;
  const close = open < 0 ? -1 : headEnd(first.text, open);
  if (open < 0 || close < 0) {
    row.problems.push({ code: 'malformed' });
    row.comment = withContinuation(first.text.slice(textStart).trim());
    return row;
  }
  row.headRange = { from: first.from + open, to: first.from + close + 1 };
  row.comment = withContinuation(first.text.slice(close + 1).trim());
  row.tokens = readWords(first.text.slice(open + 1, close), first.from + open + 1).map(token => ({ ...token }));

  readHead(row);
  return row;
}

/** Reads the head's words into the row's fields and problems; positional words first (`#id`, kind), then `key=value` words. */
function readHead(row: AnnotationRow): void {
  const words = row.tokens;
  const geometry: Partial<Record<typeof GEOMETRY_KEYS[number], number>> = {};
  const invalid = new Set<string>();
  const seen = new Set<string>();
  let position = 0;

  const first = words[0];
  if (first && first.key.startsWith('#') && first.value === undefined) {
    const digits = first.key.slice(1);
    if (/^[1-9]\d*$/.test(digits) && Number.isSafeInteger(Number(digits))) row.id = Number(digits);
    else row.problems.push({ code: 'invalid-id' });
    first.key = '#';
    position = 1;
  } else {
    row.problems.push({ code: 'missing-id' });
  }

  const kindWord = words[position];
  if (kindWord && kindWord.value === undefined && kindWord.key !== 'resolved') {
    if (kindWord.key === 'pin' || kindWord.key === 'region') row.kind = kindWord.key;
    else row.problems.push({ code: 'unknown-kind', detail: kindWord.key });
    kindWord.key = 'kind';
    kindWord.value = undefined;
    position++;
  } else {
    row.problems.push({ code: 'missing-kind' });
  }

  const allowed: readonly string[] = row.kind === 'region' ? ['x', 'y', 'w', 'h'] : row.kind === 'pin' ? ['x', 'y'] : ['x', 'y', 'w', 'h'];
  for (const word of words.slice(position)) {
    const { key, value } = word;
    if (key === 'resolved' && value === undefined) {
      if (seen.has('resolved')) row.problems.push({ code: 'duplicate-key', detail: 'resolved' });
      seen.add('resolved');
      row.resolved = true;
    } else if (key === 'by' && value !== undefined) {
      if (seen.has('by')) row.problems.push({ code: 'duplicate-key', detail: 'by' });
      seen.add('by');
      if (value) row.by = value;
      else row.problems.push({ code: 'invalid-value', detail: 'by' });
    } else if (key === 'page' && value !== undefined) {
      row.problems.push({ code: 'page-on-image' });
    } else if ((GEOMETRY_KEYS as readonly string[]).includes(key) && value !== undefined && allowed.includes(key)) {
      if (seen.has(key)) {
        row.problems.push({ code: 'duplicate-key', detail: key });
        continue;
      }
      seen.add(key);
      const match = PERCENT.exec(value);
      if (!match) {
        invalid.add(key);
        row.problems.push({ code: 'invalid-value', detail: key });
      } else {
        geometry[key as typeof GEOMETRY_KEYS[number]] = roundCoordinate(Number(match[1]));
      }
    } else {
      row.problems.push({ code: 'unknown-token', detail: key });
    }
  }

  if (row.kind) {
    const needed = row.kind === 'region' ? GEOMETRY_KEYS : (['x', 'y'] as const);
    for (const key of needed) if (!(key in geometry) && !invalid.has(key)) row.problems.push({ code: 'missing-key', detail: key });
  }
  Object.assign(row, geometry);

  if (row.kind) {
    const needed = row.kind === 'region' ? GEOMETRY_KEYS : (['x', 'y'] as const);
    const complete = needed.every(key => key in geometry);
    if (complete) {
      const { x = 0, y = 0, w = 0, h = 0 } = geometry;
      const inRange = x >= 0 && x <= 100 && y >= 0 && y <= 100 && (row.kind === 'pin' || (w > 0 && h > 0 && x + w <= 100 + EPSILON && y + h <= 100 + EPSILON));
      if (inRange) row.hasGeometry = true;
      else row.problems.push({ code: 'out-of-range' });
    }
  }
}

/**
 * Reads an `:::annotate` block (its opening fence through its closing fence, any blockquote markers already removed).
 * Offsets in the result are into `source`.
 */
export function parseAnnotate(source: string): ParsedAnnotate {
  const lines = splitLines(source.replace(/\n+$/, ''));
  const open = parseDirectiveOpen(lines[0].text);
  if (!open || !isAnnotateName(open.name)) fail('not an annotate block');
  const closing = lines.length > 1 ? matchDirectiveClose(lines[lines.length - 1].text, open.fenceLength) : null;
  if (!closing) fail('the annotate block is not closed');
  if (closing.trailing) fail('unexpected text before the closing fence');
  for (const key of Object.keys(open.attrs)) if (key !== 'title') fail(`unknown attribute "${key}" (an annotate block only takes a title)`);
  const title = parseDirectiveTitle(open.attrs, open.label, '');

  const body = lines.slice(1, -1);
  const mediaIndex = body.findIndex(line => line.text.trim());
  if (mediaIndex < 0) fail('the first body line must be a Markdown image, ![alt](path)');
  const media = readMedia(body[mediaIndex]);

  const drafts: RowDraft[] = [];
  let pendingBlank: Line[] = [];
  for (const line of body.slice(mediaIndex + 1)) {
    if (!line.text.trim()) {
      pendingBlank.push(line);
      continue;
    }
    const current = drafts[drafts.length - 1];
    if (current && indentOf(line.text) >= 2) {
      current.lines.push(...pendingBlank, line);
    } else if (LIST_ITEM.test(line.text)) {
      drafts.push({ lines: [line] });
    } else if (parseDirectiveOpen(line.text)) {
      fail('a nested container is not allowed inside an annotate block');
    } else if (/!\[/.test(line.text)) {
      fail('the body holds exactly one image');
    } else {
      fail(`unexpected content after the image: "${line.text.trim().slice(0, 40)}" (rows are list items, - {#1 pin x=10% y=10%} comment)`);
    }
    pendingBlank = [];
  }

  const rows = drafts.map(parseRow);
  const claimed = new Set<number>();
  for (const row of rows) {
    if (row.id === undefined) continue;
    if (claimed.has(row.id)) row.problems.push({ code: 'duplicate-id' });
    else claimed.add(row.id);
  }
  return { title: title.isDefault ? undefined : title.label, media, rows };
}
