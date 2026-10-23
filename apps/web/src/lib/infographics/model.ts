/**
 * The infographic directives' syntax, shared by the renderer and the block editor: which kinds exist, what their
 * attributes, child containers and list columns are, and a lossless model of a block's source. The syntax is the
 * blog's (`blog/DIRECTIVES_USAGE.md`, 資訊圖 Directive, in wayne930242/knowledge-base at a17b573e): data is a
 * Markdown list whose fields are separated by 「｜」, inside a `:::kind` container, with `::::kind` around child
 * containers.
 */

import { matchDirectiveClose, parseDirectiveOpen } from '../directives.js';

export const INFOGRAPHIC_KINDS = ['key-numbers', 'bars', 'parts', 'line', 'timeline', 'status-board', 'map'] as const;
export type InfographicKind = typeof INFOGRAPHIC_KINDS[number];

export const FIELD_SEPARATOR = '｜';
export const MAX_SCENARIOS = 6;

/** Palettes that describe the data; the app draws them from the active theme. */
export const DATA_PALETTES = ['categorical', 'diverging', 'sequential'] as const;
/** The blog's section palettes: valid syntax, drawn in the theme's default colours here. */
export const SECTION_PALETTES = ['current-affairs', 'technology', 'popular-philosophy', 'trpg', 'academic'] as const;
export const INFOGRAPHIC_PALETTES: readonly string[] = [...SECTION_PALETTES, ...DATA_PALETTES];

export const STATUS_VALUES = ['done', 'partial', 'none'] as const;

export interface MapBase {
  lon: [number, number];
  lat: [number, number];
  width: number;
  height: number;
  focus?: boolean;
}

/** The base maps the blog ships; their layers are bundled with the app's infographic styles. */
export const MAP_BASES: Record<string, MapBase> = { taiwan: { lon: [118.05, 122.15], lat: [21.85, 26.45], width: 800, height: 984 }, taipei: { lon: [121.42, 121.68], lat: [24.95, 25.22], width: 800, height: 917, focus: true } };

/**
 * What a cell holds: free inline Markdown, one number, a number or a `low–high` range, a year or a `from–to` span,
 * `lat, lon`, or a map row's name, which is a point's name or a route `start → end`.
 */
export type ColumnType = 'text' | 'number' | 'number-or-range' | 'year-or-range' | 'lat-lon' | 'point-or-route';

export interface ColumnSpec {
  key: string;
  type: ColumnType;
}

/** How an attribute is edited: free text, a number, a list of numbers, a bare flag, or one of fixed values. */
export type AttrType = 'text' | 'number' | 'numbers' | 'flag' | 'select';

export interface AttrSpec {
  key: string;
  type: AttrType;
  options?: readonly string[];
}

export interface ChildSpec {
  name: string;
  /** The kind does not render without at least one child. */
  required: boolean;
  max?: number;
  attrs: AttrSpec[];
}

export interface KindSpec {
  kind: InfographicKind;
  /** Attributes besides the common ones, in the order an editor shows them. */
  attrs: AttrSpec[];
  child?: ChildSpec;
  columns: ColumnSpec[];
}

export const COMMON_ATTRS: AttrSpec[] = [{ key: 'title', type: 'text' }, { key: 'subtitle', type: 'text' }, { key: 'note', type: 'text' }, { key: 'source', type: 'text' }, { key: 'palette', type: 'select', options: INFOGRAPHIC_PALETTES }];

const text = (key: string): ColumnSpec => ({ key, type: 'text' });

export const KIND_SPECS: Record<InfographicKind, KindSpec> = { 'key-numbers': { kind: 'key-numbers', attrs: [], columns: [text('value'), text('label'), text('note')] }, bars: { kind: 'bars', attrs: [{ key: 'unit', type: 'text' }, { key: 'reference', type: 'number' }, { key: 'reference-label', type: 'text' }, { key: 'max', type: 'number' }], child: { name: 'scenario', required: false, max: MAX_SCENARIOS, attrs: [{ key: 'label', type: 'text' }, { key: 'note', type: 'text' }, { key: 'reference', type: 'number' }, { key: 'reference-label', type: 'text' }] }, columns: [text('label'), { key: 'value', type: 'number-or-range' }, text('note')] }, parts: { kind: 'parts', attrs: [{ key: 'unit', type: 'text' }, { key: 'total', type: 'number' }], columns: [text('label'), { key: 'value', type: 'number' }, text('note')] }, line: { kind: 'line', attrs: [{ key: 'unit', type: 'text' }, { key: 'ticks', type: 'numbers' }, { key: 'from', type: 'number' }, { key: 'to', type: 'number' }, { key: 'min', type: 'number' }, { key: 'max', type: 'number' }], child: { name: 'series', required: true, attrs: [{ key: 'title', type: 'text' }, { key: 'highlight', type: 'flag' }, { key: 'dashed', type: 'flag' }] }, columns: [{ key: 'x', type: 'number' }, { key: 'y', type: 'number' }, text('note')] }, timeline: { kind: 'timeline', attrs: [{ key: 'from', type: 'number' }, { key: 'to', type: 'number' }, { key: 'ticks', type: 'numbers' }], child: { name: 'lane', required: true, attrs: [{ key: 'title', type: 'text' }, { key: 'highlight', type: 'flag' }] }, columns: [{ key: 'when', type: 'year-or-range' }, text('event')] }, 'status-board': { kind: 'status-board', attrs: [], child: { name: 'group', required: true, attrs: [{ key: 'status', type: 'select', options: STATUS_VALUES }, { key: 'title', type: 'text' }] }, columns: [text('item'), text('detail')] }, map: { kind: 'map', attrs: [{ key: 'base', type: 'select', options: Object.keys(MAP_BASES) }], columns: [{ key: 'name', type: 'point-or-route' }, { key: 'position', type: 'lat-lon' }, text('note')] } };

export function isInfographicKind(name: string): name is InfographicKind {
  return (INFOGRAPHIC_KINDS as readonly string[]).includes(name);
}

/** The child container name of `kind`, if it takes one. */
export function childNameOf(kind: InfographicKind): string | undefined {
  return KIND_SPECS[kind].child?.name;
}

// ---------------------------------------------------------------------------
// Fields

/**
 * Splits a list item's inline Markdown on 「｜」 and trims each field. As in the blog, where only plain text nodes
 * are split, a 「｜」 inside inline code, a link's text or a `**strong**` span stays in its field.
 */
export function splitFields(source: string): string[] {
  const fields: string[] = [];
  let current = '';
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const span = /^(`+)[\s\S]*?\1(?!`)/.exec(rest) ?? /^!?\[[^\]]*\]\([^)]*\)/.exec(rest) ?? /^\*\*(?!\s)[\s\S]*?\S\*\*/.exec(rest) ?? /^__(?!\s)[\s\S]*?\S__/.exec(rest);
    if (span) {
      current += span[0];
      i += span[0].length;
    } else if (source[i] === FIELD_SEPARATOR) {
      fields.push(current);
      current = '';
      i += 1;
    } else {
      current += source[i];
      i += 1;
    }
  }
  fields.push(current);
  return fields.map(field => field.trim());
}

/** A field wholly in strong emphasis (`**…**`, possibly several spans) marks its row as highlighted. */
export function isStrongField(field: string): boolean {
  return /^(?:(?:\*\*(?!\s)(?:(?!\*\*)[\s\S])*?\S\*\*|__(?!\s)(?:(?!__)[\s\S])*?\S__)\s*)+$/.test(field.trim());
}

/** The text a reader sees in a field: emphasis markers, code ticks and link targets removed. */
export function plainField(field: string): string {
  return field.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`+/g, '').replace(/\*\*|__/g, '').replace(/(^|[^\w*])[*_]|[*_](?=[^\w*]|$)/g, '$1').trim();
}

/**
 * The numbers in a value. As in the blog, a comma is a thousands separator only before a group of three digits, so
 * `4,780` is one number while `2000,2010` and `25.06,121.55` are two.
 */
export function numbers(value: string): number[] {
  return [...value.matchAll(/-?\d{1,3}(?:,\d{3})+(?!\d)(?:\.\d+)?|-?\d+(?:\.\d+)?/g)].map(match => Number(match[0].replaceAll(',', '')));
}

export const ROUTE_ARROW = '→';

/** A map row naming a route `start → end` rather than a point. */
export function isRouteRow(fields: readonly string[]): boolean {
  return plainField(fields[0] ?? '').includes(ROUTE_ARROW);
}

/**
 * A row's fields laid out under `kind`'s columns. A map route has no position, so its second field is its note;
 * every other row maps field to column one to one.
 */
export function rowCells(kind: InfographicKind, fields: readonly string[]): string[] {
  const count = KIND_SPECS[kind].columns.length;
  const cells = kind === 'map' && isRouteRow(fields) ? [fields[0] ?? '', '', ...fields.slice(1)] : [...fields];
  while (cells.length < count) cells.push('');
  return cells;
}

/** The inverse of `rowCells`: the fields to write, without trailing empty ones. */
export function cellsToFields(kind: InfographicKind, cells: readonly string[]): string[] {
  const fields = kind === 'map' && isRouteRow(cells) ? [cells[0], ...cells.slice(2)] : [...cells];
  while (fields.length > 1 && !fields[fields.length - 1].trim()) fields.pop();
  return fields.map(field => field.trim());
}

/** Toggles a row's highlight: unwraps every strong-only field, or wraps the first field in `**`. */
export function toggleHighlight(fields: readonly string[]): string[] {
  if (fields.some(isStrongField)) return fields.map(field => isStrongField(field) ? field.trim().replace(/^(\*\*|__)([\s\S]*)\1$/, '$2') : field);
  return fields.map((field, index) => index === 0 && field.trim() ? `**${field.trim()}**` : field);
}

// ---------------------------------------------------------------------------
// Block model

export interface InfographicRow {
  fields: string[];
}

export interface InfographicChild {
  name: string;
  /** Attributes in source order; a bare flag (`highlight`) has the value `''`. */
  attrs: Record<string, string>;
  rows: InfographicRow[];
}

/** Why a block's source cannot be edited as a grid without losing something; the line is 0-based in the block. */
export type InfographicProblemCode = 'text-outside-list' | 'multiline-item' | 'nested-list' | 'unknown-container' | 'nested-container' | 'quoted' | 'rows-beside-children' | 'trailing-fence' | 'unclosed';

export interface InfographicProblem {
  code: InfographicProblemCode;
  line: number;
}

export interface InfographicBlock {
  kind: InfographicKind;
  fenceLength: number;
  /** The `[label]` of the opening fence; the blog does not show it, but it is kept. */
  label?: string;
  attrs: Record<string, string>;
  /** List rows directly in the block. With child containers present the blog ignores these. */
  rows: InfographicRow[];
  children: InfographicChild[];
  /** Source the model does not represent; a block with problems is edited as Markdown. */
  problems: InfographicProblem[];
}

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;

/** Reads list rows from `lines`, reporting anything else as problems at `offset + index`. */
function readRows(lines: readonly string[], offset: number, problems: InfographicProblem[]): InfographicRow[] {
  const rows: InfographicRow[] = [];
  let item: string | undefined;
  let previousBlank = true;
  const flush = () => {
    if (item !== undefined) rows.push({ fields: splitFields(item) });
    item = undefined;
  };
  lines.forEach((line, index) => {
    if (!line.trim()) {
      previousBlank = true;
      return;
    }
    const match = LIST_ITEM.exec(line);
    if (match && !/^\s{2,}/.test(line)) {
      flush();
      item = match[1] ?? '';
    } else if (item !== undefined && LIST_ITEM.test(line.trimStart())) {
      problems.push({ code: 'nested-list', line: offset + index });
    } else if (item !== undefined && (!previousBlank || /^\s{2,}/.test(line))) {
      // A continuation of the item's paragraph: the blog reads it as part of the last field.
      problems.push({ code: 'multiline-item', line: offset + index });
      item += ` ${line.trim()}`;
    } else {
      problems.push({ code: 'text-outside-list', line: offset + index });
    }
    previousBlank = false;
  });
  flush();
  return rows;
}

/**
 * Parses the source of one infographic block, from its opening fence through its closing fence. Returns null when
 * the first line is not the opening fence of an infographic kind.
 */
export function parseInfographic(source: string): InfographicBlock | null {
  const lines = source.replace(/\n$/, '').split('\n');
  const open = parseDirectiveOpen(lines[0] ?? '');
  if (!open || !isInfographicKind(open.name)) return null;
  const problems: InfographicProblem[] = [];
  if (/^\s*>/.test(lines[0])) problems.push({ code: 'quoted', line: 0 });

  const body = lines.slice(1);
  const last = lines.length > 1 ? matchDirectiveClose(lines[lines.length - 1], open.fenceLength) : null;
  if (!last) problems.push({ code: 'unclosed', line: lines.length - 1 });
  else if (last.trailing) {
    problems.push({ code: 'trailing-fence', line: lines.length - 1 });
    body[body.length - 1] = last.trailing;
  } else body.pop();

  const childName = childNameOf(open.name);
  const children: InfographicChild[] = [];
  const looseLines: string[] = [];
  const looseIndex: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const childOpen = parseDirectiveOpen(body[i]);
    if (!childOpen) {
      looseLines.push(body[i]);
      looseIndex.push(i + 1);
      continue;
    }
    // The child ends at the first bare fence that closes it; containers nested in it are tracked so their fences
    // do not end it early.
    const fences = [childOpen.fenceLength];
    let close = i + 1;
    for (; close < body.length; close++) {
      const nested = parseDirectiveOpen(body[close]);
      if (nested) {
        fences.push(nested.fenceLength);
        problems.push({ code: 'nested-container', line: close + 1 });
        continue;
      }
      const end = matchDirectiveClose(body[close], fences[fences.length - 1]);
      if (end?.trailing) problems.push({ code: 'trailing-fence', line: close + 1 });
      if (end) {
        fences.pop();
        if (!fences.length) break;
      }
    }
    if (close >= body.length) problems.push({ code: 'unclosed', line: i + 1 });
    if (childOpen.name !== childName || childOpen.label !== undefined) problems.push({ code: 'unknown-container', line: i + 1 });
    if (childOpen.name === childName) children.push({ name: childOpen.name, attrs: childOpen.attrs, rows: readRows(body.slice(i + 1, close), i + 2, problems) });
    i = close;
  }

  const rowProblems: InfographicProblem[] = [];
  const rows = readRows(looseLines, 0, rowProblems);
  for (const problem of rowProblems) problems.push({ code: problem.code, line: looseIndex[problem.line] });
  if (children.length && rows.length) problems.push({ code: 'rows-beside-children', line: looseIndex[0] });

  return { kind: open.name, fenceLength: open.fenceLength, label: open.label, attrs: open.attrs, rows, children, problems: problems.sort((a, b) => a.line - b.line) };
}

function quoteAttr(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  return value.includes("'") ? `"${value.replaceAll('"', '”')}"` : `'${value}'`;
}

/** `{key="value" flag}`: empty values of flag attributes are written bare, other empty values are left out. */
export function serializeAttrs(attrs: Record<string, string>, flags: readonly string[]): string {
  const parts = Object.entries(attrs).flatMap(([key, value]) => {
    if (flags.includes(key)) return value === '' ? [key] : [`${key}=${quoteAttr(value)}`];
    return value.trim() ? [`${key}=${quoteAttr(value.trim())}`] : [];
  });
  return parts.length ? `{${parts.join(' ')}}` : '';
}

function serializeRows(rows: readonly InfographicRow[]): string[] {
  return rows.map(row => {
    const fields = row.fields.map(field => field.trim());
    while (fields.length > 1 && !fields[fields.length - 1]) fields.pop();
    return `- ${fields.join(FIELD_SEPARATOR)}`.trimEnd();
  });
}

/**
 * Writes a block back in the blog's syntax, ending with a newline: `::::` around child containers and `:::`
 * otherwise (a longer fence the writer chose is kept), child containers with `:::`, attributes in their order.
 */
export function serializeInfographic(block: InfographicBlock): string {
  const spec = KIND_SPECS[block.kind];
  const flags = (attrs: readonly AttrSpec[]) => attrs.filter(attr => attr.type === 'flag').map(attr => attr.key);
  const fence = ':'.repeat(Math.max(block.children.length ? 4 : 3, block.fenceLength));
  const label = block.label !== undefined ? `[${block.label}]` : '';
  const lines = [`${fence}${block.kind}${label}${serializeAttrs(block.attrs, flags(spec.attrs))}`];
  if (block.children.length) {
    for (const child of block.children) {
      lines.push(`:::${child.name}${serializeAttrs(child.attrs, flags(spec.child?.attrs ?? []))}`, ...serializeRows(child.rows), ':::');
    }
  } else {
    lines.push(...serializeRows(block.rows));
  }
  lines.push(fence);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Cell checks

export type CellIssueCode = 'not-a-number' | 'not-a-range' | 'not-a-position' | 'outside-map' | 'unknown-point' | 'route-needs-two-points';

export interface CellIssue {
  /** Index into `children`, or undefined for the block's own rows. */
  child?: number;
  row: number;
  column: number;
  code: CellIssueCode;
}

/** Problems in individual cells, which the blog would draw wrongly or skip; whole-figure errors are the renderer's. */
export function checkCells(block: InfographicBlock): CellIssue[] {
  const spec = KIND_SPECS[block.kind];
  const issues: CellIssue[] = [];
  const base = MAP_BASES[block.attrs.base ?? 'taiwan'];
  const groups: { child?: number; rows: InfographicRow[]; }[] = block.children.length ? block.children.map((child, index) => ({ child: index, rows: child.rows })) : [{ rows: block.rows }];
  const pointNames = new Set(block.kind === 'map' ? block.rows.filter(row => !isRouteRow(row.fields)).map(row => plainField(row.fields[0] ?? '')) : []);

  for (const group of groups) {
    group.rows.forEach((row, rowIndex) => {
      const cells = rowCells(block.kind, row.fields);
      spec.columns.forEach((column, columnIndex) => {
        const cell = plainField(cells[columnIndex] ?? '');
        const found = numbers(cell);
        const issue = (code: CellIssueCode) => issues.push({ child: group.child, row: rowIndex, column: columnIndex, code });
        if (column.type === 'number' && found.length !== 1) issue('not-a-number');
        else if ((column.type === 'number-or-range' || column.type === 'year-or-range') && (found.length < 1 || found.length > 2)) issue(found.length ? 'not-a-range' : 'not-a-number');
        else if (column.type === 'lat-lon' && !isRouteRow(cells)) {
          if (found.length !== 2) issue('not-a-position');
          else if (base && (found[0] < base.lat[0] || found[0] > base.lat[1] || found[1] < base.lon[0] || found[1] > base.lon[1])) issue('outside-map');
        } else if (column.type === 'point-or-route' && isRouteRow(cells)) {
          const ends = cell.split(ROUTE_ARROW).map(part => part.trim());
          if (ends.length !== 2 || !ends[0] || !ends[1]) issue('route-needs-two-points');
          else if (!ends.every(end => pointNames.has(end))) issue('unknown-point');
        }
      });
    });
  }
  return issues;
}
