/**
 * The operations behind the infographic data editor's grid: reading a block's rows as cells, editing cells and
 * rows, moving the selection, and copying and pasting as tab-separated text. Everything here is pure; each edit
 * returns a new block and leaves the one it was given alone, so the editor can keep a history of drafts.
 */

import { type AttrSpec, cellsToFields, type ColumnSpec, type InfographicBlock, type InfographicChild, type InfographicRow, isRouteRow, isStrongField, KIND_SPECS, rowCells, splitFields, toggleHighlight } from './model.js';

export interface CellPos {
  row: number;
  col: number;
}

/** A selected range: `anchor` is the active cell and `focus` the corner a Shift-move or drag stretches. */
export interface GridSelection {
  anchor: CellPos;
  focus: CellPos;
}

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface GridDims {
  rows: number;
  cols: number;
}

// ---------------------------------------------------------------------------
// Rows and columns

/** The rows the grid shows for `tab`: the child container's, or the block's own list when it has no children. */
export function rowsOf(block: InfographicBlock, tab: number): InfographicRow[] {
  return block.children.length ? block.children[tab]?.rows ?? [] : block.rows;
}

function withRows(block: InfographicBlock, tab: number, rows: InfographicRow[]): InfographicBlock {
  if (!block.children.length) return { ...block, rows };
  return { ...block, children: block.children.map((child, index) => index === tab ? { ...child, rows } : child) };
}

function allRows(block: InfographicBlock): InfographicRow[] {
  return block.children.length ? block.children.flatMap(child => child.rows) : block.rows;
}

/**
 * The grid's columns: those of the kind and, when some row carries more fields than the kind has columns, plain
 * text columns for the rest, so a row never hides a field the grid cannot show.
 */
export function gridColumns(block: InfographicBlock): ColumnSpec[] {
  const columns = [...KIND_SPECS[block.kind].columns];
  const widest = Math.max(0, ...allRows(block).map(row => rowCells(block.kind, row.fields).length));
  while (columns.length < widest) columns.push({ key: `extra${columns.length - KIND_SPECS[block.kind].columns.length + 1}`, type: 'text' });
  return columns;
}

export function gridDims(block: InfographicBlock, tab: number): GridDims {
  return { rows: rowsOf(block, tab).length, cols: gridColumns(block).length };
}

/** The cells of every row of `tab` as written, padded to the grid's width. */
function rawCellMatrix(block: InfographicBlock, tab: number): string[][] {
  const cols = gridColumns(block).length;
  return rowsOf(block, tab).map(row => {
    const cells = rowCells(block.kind, row.fields);
    while (cells.length < cols) cells.push('');
    return cells;
  });
}

/**
 * The single strong span (`**x**` or `__x__`) a field is wholly wrapped in, or null. A field of several spans, or
 * with the marker inside, is not one: it is shown and edited as typed.
 */
function unwrapStrong(field: string): { marker: string; inner: string; } | null {
  const text = field.trim();
  const match = isStrongField(text) ? /^(\*\*|__)([\s\S]*)\1$/.exec(text) : null;
  return match && !match[2].includes(match[1]) ? { marker: match[1], inner: match[2] } : null;
}

/** What a cell shows and edits: a highlighted field without its `**`, since the ★ already says it is highlighted. */
const shown = (field: string): string => unwrapStrong(field)?.inner ?? field;

/** What a cell holds after the writer sets it to `value`: a highlighted field keeps its wrap around the new text. */
function writeCell(existing: string, value: string): string {
  const next = cleanCell(value);
  const wrap = unwrapStrong(existing);
  return !wrap || !next || next.includes(wrap.marker) ? next : `${wrap.marker}${next}${wrap.marker}`;
}

/** The cells of every row of `tab` as the grid shows and edits them, padded to the grid's width. */
export function cellMatrix(block: InfographicBlock, tab: number): string[][] {
  return rawCellMatrix(block, tab).map(cells => cells.map(shown));
}

/** A cell holds one line of inline Markdown; a 「｜」 outside code would split it into two fields, so it becomes `|`. */
export function cleanCell(value: string): string {
  const flat = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const fields = splitFields(flat);
  return fields.length > 1 ? fields.join('|') : flat;
}

function padTo(cells: string[], count: number): string[] {
  while (cells.length < count) cells.push('');
  return cells;
}

/** A map route (`A → B`) has no position, so the position cell of such a row cannot be edited. */
export function isCellEditable(block: InfographicBlock, tab: number, pos: CellPos): boolean {
  if (block.kind !== 'map' || pos.col !== 1) return true;
  const row = rowsOf(block, tab)[pos.row];
  return Boolean(row) && !isRouteRow(row.fields);
}

export function setCell(block: InfographicBlock, tab: number, row: number, col: number, value: string): InfographicBlock {
  const rows = rowsOf(block, tab);
  if (!rows[row]) return block;
  const cells = padTo(rowCells(block.kind, rows[row].fields), gridColumns(block).length);
  cells[col] = writeCell(cells[col], value);
  return withRows(block, tab, rows.map((existing, index) => index === row ? { fields: cellsToFields(block.kind, cells) } : existing));
}

/** Empties every cell in `range`. */
export function clearRange(block: InfographicBlock, tab: number, range: CellRange): InfographicBlock {
  const cols = gridColumns(block).length;
  const rows = rowsOf(block, tab).map((existing, index) => {
    if (index < range.top || index > range.bottom) return existing;
    const cells = padTo(rowCells(block.kind, existing.fields), cols);
    for (let col = range.left; col <= range.right; col++) cells[col] = '';
    return { fields: cellsToFields(block.kind, cells) };
  });
  return withRows(block, tab, rows);
}

export function insertRow(block: InfographicBlock, tab: number, at: number, fields: string[] = ['']): InfographicBlock {
  const rows = [...rowsOf(block, tab)];
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, { fields });
  return withRows(block, tab, rows);
}

export function duplicateRow(block: InfographicBlock, tab: number, row: number): InfographicBlock {
  const source = rowsOf(block, tab)[row];
  return source ? insertRow(block, tab, row + 1, [...source.fields]) : block;
}

export function deleteRow(block: InfographicBlock, tab: number, row: number): InfographicBlock {
  return withRows(block, tab, rowsOf(block, tab).filter((_existing, index) => index !== row));
}

/** Moves the row at `from` so that it ends up at index `to`. */
export function moveRow(block: InfographicBlock, tab: number, from: number, to: number): InfographicBlock {
  const rows = [...rowsOf(block, tab)];
  if (from === to || !rows[from] || to < 0 || to >= rows.length) return block;
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  return withRows(block, tab, rows);
}

/** The row a pointer at `y` is over, for dragging a row to a new place; above the first it is the first, below the last the last. */
export function rowIndexAt(rects: readonly { top: number; bottom: number; }[], y: number): number {
  if (!rects.length) return -1;
  if (y < rects[0].top) return 0;
  const index = rects.findIndex(rect => y >= rect.top && y < rect.bottom);
  return index >= 0 ? index : rects.length - 1;
}

/** A row with nothing in it: the placeholder a new row is until it is filled in. */
export function isBlankRow(row: InfographicRow): boolean {
  return row.fields.every(field => !field.trim());
}

/** The block without its blank rows, as it is saved; a row nobody filled in is not data. */
export function withoutBlankRows(block: InfographicBlock): InfographicBlock {
  const keep = (rows: InfographicRow[]) => rows.filter(row => !isBlankRow(row));
  return { ...block, rows: keep(block.rows), children: block.children.map(child => ({ ...child, rows: keep(child.rows) })) };
}

export function isHighlighted(row: InfographicRow): boolean {
  return row.fields.some(isStrongField);
}

export function toggleRowHighlight(block: InfographicBlock, tab: number, row: number): InfographicBlock {
  const rows = rowsOf(block, tab);
  if (!rows[row]) return block;
  return withRows(block, tab, rows.map((existing, index) => index === row ? { fields: toggleHighlight(existing.fields) } : existing));
}

// ---------------------------------------------------------------------------
// Attributes and child containers

/** The attribute that names a child container: a scenario's `label`, the `title` of the others. */
export function childNameKey(kind: InfographicBlock['kind']): string {
  return kind === 'bars' ? 'label' : 'title';
}

/** `attrs` with `key` set. An empty value drops the key (a flag keeps it, bare, while on); other keys keep their order. */
export function withAttr(attrs: Record<string, string>, spec: AttrSpec, value: string | boolean): Record<string, string> {
  const next = { ...attrs };
  if (spec.type === 'flag') {
    if (value) next[spec.key] = typeof value === 'string' ? value : next[spec.key] ?? '';
    else delete next[spec.key];
    return next;
  }
  const text = String(value);
  if (text === '') delete next[spec.key];
  else next[spec.key] = text;
  return next;
}

export function setAttr(block: InfographicBlock, spec: AttrSpec, value: string | boolean): InfographicBlock {
  return { ...block, attrs: withAttr(block.attrs, spec, value) };
}

export function setChildAttr(block: InfographicBlock, index: number, spec: AttrSpec, value: string | boolean): InfographicBlock {
  if (!block.children[index]) return block;
  return { ...block, children: block.children.map((child, i) => i === index ? { ...child, attrs: withAttr(child.attrs, spec, value) } : child) };
}

export function canAddChild(block: InfographicBlock): boolean {
  const spec = KIND_SPECS[block.kind].child;
  return Boolean(spec) && (spec?.max === undefined || block.children.length < spec.max);
}

/**
 * Adds a child container after the last. The first one takes over the block's own list rows, so a figure that
 * grows its first scenario keeps its data.
 */
export function addChild(block: InfographicBlock): InfographicBlock {
  const spec = KIND_SPECS[block.kind].child;
  if (!spec || !canAddChild(block)) return block;
  const rows = block.children.length ? [{ fields: [''] }] : block.rows.length ? block.rows : [{ fields: [''] }];
  const child: InfographicChild = { name: spec.name, attrs: {}, rows };
  return { ...block, rows: [], children: [...block.children, child] };
}

/**
 * Removes a child container. Removing the last one of a kind that does not need one hands its rows back to the
 * block; a kind that does need one is left without, which the preview shows as an error.
 */
export function removeChild(block: InfographicBlock, index: number): InfographicBlock {
  const spec = KIND_SPECS[block.kind].child;
  const removed = block.children[index];
  if (!spec || !removed) return block;
  const children = block.children.filter((_child, i) => i !== index);
  return { ...block, children, rows: !children.length && !spec.required ? removed.rows : block.rows };
}

export function moveChild(block: InfographicBlock, from: number, to: number): InfographicBlock {
  const children = [...block.children];
  if (from === to || !children[from] || to < 0 || to >= children.length) return block;
  const [moved] = children.splice(from, 1);
  children.splice(to, 0, moved);
  return { ...block, children };
}

// ---------------------------------------------------------------------------
// Selection

export function rangeOf(selection: GridSelection): CellRange {
  return { top: Math.min(selection.anchor.row, selection.focus.row), bottom: Math.max(selection.anchor.row, selection.focus.row), left: Math.min(selection.anchor.col, selection.focus.col), right: Math.max(selection.anchor.col, selection.focus.col) };
}

export function inRange(range: CellRange, pos: CellPos): boolean {
  return pos.row >= range.top && pos.row <= range.bottom && pos.col >= range.left && pos.col <= range.right;
}

export function single(pos: CellPos): GridSelection {
  return { anchor: pos, focus: pos };
}

export function clampPos(pos: CellPos, dims: GridDims): CellPos {
  return { row: Math.max(0, Math.min(pos.row, dims.rows - 1)), col: Math.max(0, Math.min(pos.col, dims.cols - 1)) };
}

export function clampSelection(selection: GridSelection, dims: GridDims): GridSelection {
  return { anchor: clampPos(selection.anchor, dims), focus: clampPos(selection.focus, dims) };
}

export function rowSelection(row: number, dims: GridDims): GridSelection {
  return { anchor: { row, col: 0 }, focus: { row, col: Math.max(0, dims.cols - 1) } };
}

export type Direction = 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'top' | 'bottom';

/**
 * Moves the selection. A plain move starts from the active cell and collapses the range; with `extend` the focus
 * corner moves and the active cell stays.
 */
export function moveSelection(selection: GridSelection, direction: Direction, dims: GridDims, extend: boolean): GridSelection {
  if (!dims.rows || !dims.cols) return selection;
  const base = extend ? selection.focus : selection.anchor;
  const target: CellPos = { up: { row: base.row - 1, col: base.col }, down: { row: base.row + 1, col: base.col }, left: { row: base.row, col: base.col - 1 }, right: { row: base.row, col: base.col + 1 }, home: { row: base.row, col: 0 }, end: { row: base.row, col: dims.cols - 1 }, top: { row: 0, col: base.col }, bottom: { row: dims.rows - 1, col: base.col } }[direction];
  const next = clampPos(target, dims);
  return extend ? { anchor: selection.anchor, focus: next } : single(next);
}

/**
 * The cell after (or before) the active one in reading order: the end of a row continues on the next row. Past the
 * last cell going forward, or the first going back, there is none, and Tab leaves the grid.
 */
export function stepCell(selection: GridSelection, back: boolean, dims: GridDims): CellPos | null {
  if (!dims.rows || !dims.cols) return null;
  const index = selection.anchor.row * dims.cols + selection.anchor.col + (back ? -1 : 1);
  if (index < 0 || index >= dims.rows * dims.cols) return null;
  return { row: Math.floor(index / dims.cols), col: index % dims.cols };
}

// ---------------------------------------------------------------------------
// Tab-separated text

function quoteTsv(cell: string): string {
  return /["\t\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** The cells of `range` as a spreadsheet copies them, highlight wraps included so a pasted row stays highlighted: tabs between columns, newlines between rows, quotes where needed. */
export function rangeToTsv(block: InfographicBlock, tab: number, range: CellRange): string {
  return rawCellMatrix(block, tab).slice(range.top, range.bottom + 1).map(cells => cells.slice(range.left, range.right + 1).map(quoteTsv).join('\t')).join('\n');
}

/** Parses tab-separated text as a spreadsheet writes it: a field opening with a quote runs to the closing quote, `""` is a quote. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"' && field === '') {
      i++;
      for (; i < text.length; i++) {
        if (text[i] === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (text[i] === '"') {
          i++;
          break;
        } else field += text[i];
      }
      // Anything between the closing quote and the next separator belongs to the field, as it does in a spreadsheet.
      while (i < text.length && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') field += text[i++];
      continue;
    }
    if (char === '\t') {
      endField();
      i++;
    } else if (char === '\n' || char === '\r') {
      endRow();
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  // A final newline ends the last row; text without one still has a last row.
  if (field !== '' || row.length) endRow();
  return rows;
}

/**
 * Writes `matrix` into the grid from `at`, adding rows below as needed and dropping columns past the last. Returns
 * the new block and the range the pasted cells cover.
 */
export function pasteMatrix(block: InfographicBlock, tab: number, at: CellPos, matrix: string[][]): { block: InfographicBlock; selection: GridSelection; } {
  const cols = gridColumns(block).length;
  const rows = [...rowsOf(block, tab)];
  let lastRow = at.row, lastCol = at.col;
  matrix.forEach((line, i) => {
    const row = at.row + i;
    while (rows.length <= row) rows.push({ fields: [''] });
    const cells = padTo(rowCells(block.kind, rows[row].fields), cols);
    line.forEach((value, j) => {
      const col = at.col + j;
      if (col >= cols) return;
      cells[col] = writeCell(cells[col], value);
      lastCol = Math.max(lastCol, col);
    });
    rows[row] = { fields: cellsToFields(block.kind, cells) };
    lastRow = row;
  });
  return { block: withRows(block, tab, rows), selection: { anchor: at, focus: { row: lastRow, col: lastCol } } };
}
