/**
 * Surgical text edits of an `:::annotate` block. Each function takes the block's source and returns the new source,
 * rewriting only the range of the row it touches (or appending one row), so untouched rows, comments and blank lines stay
 * byte for byte and Git's line diff reads as one change per action. Rows are addressed by their position in
 * `parseAnnotate(source).rows`, because a damaged block can repeat an id.
 */

import { ANNOTATE_DIRECTIVE, type AnnotationKind, type AnnotationRow, type HeadToken, parseAnnotate } from './parse.js';

export interface Geometry {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface NewAnnotation extends Geometry {
  kind: AnnotationKind;
  comment: string;
  by?: string;
}

/** The order the editor writes a row's words in; a word a row lacks is added where it belongs in this order. */
const CANONICAL = ['#', 'kind', 'x', 'y', 'w', 'h', 'page', 'resolved', 'by'];
const rank = (key: string): number => CANONICAL.indexOf(key);

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** A coordinate as the editor writes it: one decimal, `.0` dropped. */
export function formatPercent(value: number): string {
  return `${Number(round1(value).toFixed(1))}%`;
}

/** Rounds to what is written and keeps the shape inside the image, so the rounded text still parses. */
export function normalizeGeometry(kind: AnnotationKind, geometry: Geometry): Geometry {
  const clamp = (value: number) => Math.min(100, Math.max(0, round1(value)));
  const x = clamp(geometry.x);
  const y = clamp(geometry.y);
  if (kind === 'pin') return { x, y };
  const w = Math.max(0.1, Math.min(round1(geometry.w ?? 0.1), round1(100 - x)));
  const h = Math.max(0.1, Math.min(round1(geometry.h ?? 0.1), round1(100 - y)));
  return { x, y, w, h };
}

interface Splice {
  from: number;
  to: number;
  text: string;
}

function apply(source: string, splices: Splice[]): string {
  return [...splices].sort((a, b) => b.from - a.from).reduce((text, { from, to, text: insert }) => text.slice(0, from) + insert + text.slice(to), source);
}

function rowAt(source: string, index: number): AnnotationRow {
  const row = parseAnnotate(source).rows[index];
  if (!row) throw new RangeError(`no annotation row at ${index}`);
  return row;
}

const word = (value: string): string => /^[A-Za-z0-9_.@-]+$/.test(value) ? value : `"${value.replaceAll('"', '')}"`;

function commentText(comment: string): string {
  const [first, ...rest] = comment.trim().split('\n');
  if (!first && !rest.length) return '';
  return ` ${first}${rest.map(line => line.trim() ? `\n  ${line}` : '\n').join('')}`;
}

/** The highest id in the block, problem rows included, plus one. */
export function nextId(source: string): number {
  return parseAnnotate(source).rows.reduce((max, row) => Math.max(max, row.id ?? 0), 0) + 1;
}

/** Appends one row after the last row (or after the image, behind a blank line) with the next id. */
export function addRow(source: string, annotation: NewAnnotation): string {
  const parsed = parseAnnotate(source);
  const geometry = normalizeGeometry(annotation.kind, annotation);
  const words = [`#${nextId(source)}`, annotation.kind, `x=${formatPercent(geometry.x)}`, `y=${formatPercent(geometry.y)}`];
  if (annotation.kind === 'region') words.push(`w=${formatPercent(geometry.w ?? 0)}`, `h=${formatPercent(geometry.h ?? 0)}`);
  if (annotation.by) words.push(`by=${word(annotation.by)}`);
  const row = `- {${words.join(' ')}}${commentText(annotation.comment)}`;
  const last = parsed.rows[parsed.rows.length - 1];
  return last ? apply(source, [{ from: last.range.to, to: last.range.to, text: `\n${row}` }]) : apply(source, [{ from: parsed.media.range.to, to: parsed.media.range.to, text: `\n\n${row}` }]);
}

function tokenOf(row: AnnotationRow, key: string): HeadToken | undefined {
  return row.tokens.find(token => token.key === key);
}

/** Splices that give `key` the text `word`: in place when the row has the key, else at its canonical place. */
function setWord(row: AnnotationRow, key: string, text: string): Splice {
  const existing = tokenOf(row, key);
  if (existing) return { from: existing.from, to: existing.to, text };
  const later = row.tokens.find(token => rank(token.key) > rank(key));
  if (later) return { from: later.from, to: later.from, text: `${text} ` };
  const last = row.tokens[row.tokens.length - 1];
  const at = last ? last.to : row.headRange.from + 1;
  return { from: at, to: at, text: last ? ` ${text}` : text };
}

/** Changes the geometry words of a row; the words keep the order the row had. */
export function setGeometry(source: string, index: number, geometry: Geometry): string {
  const row = rowAt(source, index);
  if (!row.kind || row.headRange.from === row.headRange.to) return source;
  const next = normalizeGeometry(row.kind, geometry);
  const keys = row.kind === 'region' ? (['x', 'y', 'w', 'h'] as const) : (['x', 'y'] as const);
  // Words are added in canonical order, so a later one is placed before a token that follows it.
  const splices = keys.map(key => setWord(row, key, `${key}=${formatPercent(next[key] ?? 0)}`));
  return apply(source, mergeInsertions(splices));
}

/** Two insertions at one offset keep their order (a plain sort by offset would reverse them). */
function mergeInsertions(splices: Splice[]): Splice[] {
  const merged: Splice[] = [];
  for (const splice of splices) {
    const same = merged.find(other => other.from === splice.from && other.to === splice.to && splice.from === splice.to);
    if (same) same.text = same.text.endsWith(' ') ? same.text + splice.text : `${same.text}${splice.text}`;
    else merged.push({ ...splice });
  }
  return merged;
}

export function setResolved(source: string, index: number, resolved: boolean): string {
  const row = rowAt(source, index);
  if (row.headRange.from === row.headRange.to || row.resolved === resolved) return source;
  const flag = tokenOf(row, 'resolved');
  if (resolved) return apply(source, [setWord(row, 'resolved', 'resolved')]);
  if (!flag) return source;
  let from = flag.from;
  while (from > 0 && source[from - 1] === ' ') from--;
  return apply(source, [{ from, to: flag.to, text: '' }]);
}

export function setComment(source: string, index: number, comment: string): string {
  const row = rowAt(source, index);
  if (row.headRange.from === row.headRange.to) return source;
  return apply(source, [{ from: row.headRange.to, to: row.range.to, text: commentText(comment) }]);
}

/** Removes the row's lines; the other rows keep their numbers. */
export function deleteRow(source: string, index: number): string {
  const row = rowAt(source, index);
  const from = source.lastIndexOf('\n', row.range.from - 1) + 1;
  const newline = source.indexOf('\n', row.range.to);
  return apply(source, [{ from, to: newline < 0 ? source.length : newline + 1, text: '' }]);
}

/** Gives rows with a missing, invalid or repeated id a new one (the first of a repeated id keeps it). */
export function fixNumbering(source: string): string {
  const { rows } = parseAnnotate(source);
  let id = nextId(source);
  const splices: Splice[] = [];
  for (const row of rows) {
    if (row.headRange.from === row.headRange.to) continue;
    const codes = row.problems.map(problem => problem.code);
    const lead = row.tokens[0];
    if (codes.includes('duplicate-id') || codes.includes('invalid-id')) {
      if (lead?.key === '#') splices.push({ from: lead.from, to: lead.to, text: `#${id++}` });
    } else if (codes.includes('missing-id')) {
      splices.push({ from: row.headRange.from + 1, to: row.headRange.from + 1, text: `#${id++}${lead ? ' ' : ''}` });
    }
  }
  return apply(source, splices);
}

/** An image line as an annotate block around it. */
export function wrapImage(imageLine: string): string {
  return `:::${ANNOTATE_DIRECTIVE}\n${imageLine.trim()}\n:::`;
}

/** The block's image line alone: what Remove annotations leaves in the note. */
export function removeAnnotations(source: string): string {
  const { media } = parseAnnotate(source);
  return source.slice(media.range.from, media.range.to);
}
