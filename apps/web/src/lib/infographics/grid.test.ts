import { describe, expect, it } from 'vitest';
import { addChild, canAddChild, cellMatrix, cleanCell, clearRange, deleteRow, duplicateRow, gridColumns, gridDims, insertRow, isCellEditable, moveChild, moveRow, moveSelection, parseTsv, pasteMatrix, rangeToTsv, removeChild, rowsOf, setAttr, setCell, setChildAttr, single, stepCell, toggleRowHighlight, withAttr } from './grid.js';
import { type InfographicBlock, KIND_SPECS, parseInfographic, serializeInfographic } from './model.js';

const parse = (source: string): InfographicBlock => parseInfographic(source)!;
const KEY_NUMBERS = ':::key-numbers{title="T"}\n- **213 公頃**｜機場面積｜民航局管 41%\n- 560 萬｜2025 年旅客\n:::\n';
const BARS = '::::bars{unit="萬"}\n:::scenario{label="2025 年"}\n- 桃機旅客｜4,780\n:::\n:::scenario{label="2045 年"}\n- 桃機預測｜8,380\n:::\n::::\n';
const MAP = ':::map{base="taiwan"}\n- 松山｜25.069, 121.552\n- 金門｜24.43, 118.37\n- 松山 → 金門｜國內線\n:::\n';

describe('grid cells', () => {
  it('lays rows out under the kind columns, padded', () => {
    expect(cellMatrix(parse(KEY_NUMBERS), 0)).toEqual([['213 公頃', '機場面積', '民航局管 41%'], ['560 萬', '2025 年旅客', '']]);
    expect(gridDims(parse(BARS), 1)).toEqual({ rows: 1, cols: 3 });
  });

  it('writes a cell back without disturbing its neighbours, and drops trailing empties', () => {
    const block = setCell(parse(KEY_NUMBERS), 0, 1, 2, '  新的說明  ');
    expect(rowsOf(block, 0)[1].fields).toEqual(['560 萬', '2025 年旅客', '新的說明']);
    const cleared = setCell(block, 0, 1, 2, '');
    expect(rowsOf(cleared, 0)[1].fields).toEqual(['560 萬', '2025 年旅客']);
  });

  it('keeps a cell to one line and one field', () => {
    expect(cleanCell('a\nb')).toBe('a b');
    expect(cleanCell('a ｜ b')).toBe('a|b');
    expect(cleanCell('`x｜y` ｜ z')).toBe('`x｜y`|z');
    expect(cleanCell('`x｜y`')).toBe('`x｜y`');
  });

  it('shows fields beyond the kind columns as extra columns instead of hiding them', () => {
    const block = parse(':::parts\n- a｜1｜note｜surplus\n- b｜2\n:::\n');
    expect(gridColumns(block).map(column => column.key)).toEqual(['label', 'value', 'note', 'extra1']);
    expect(cellMatrix(block, 0)[0]).toEqual(['a', '1', 'note', 'surplus']);
    expect(serializeInfographic(setCell(block, 0, 1, 3, 'x'))).toContain('- b｜2｜｜x');
  });

  it('lays a map route under name and note and leaves its position cell alone', () => {
    const block = parse(MAP);
    expect(cellMatrix(block, 0)[2]).toEqual(['松山 → 金門', '', '國內線']);
    expect(isCellEditable(block, 0, { row: 2, col: 1 })).toBe(false);
    expect(isCellEditable(block, 0, { row: 1, col: 1 })).toBe(true);
    expect(rowsOf(setCell(block, 0, 2, 2, '直飛'), 0)[2].fields).toEqual(['松山 → 金門', '直飛']);
  });

  it('clears a range', () => {
    const block = clearRange(parse(KEY_NUMBERS), 0, { top: 0, bottom: 1, left: 1, right: 2 });
    expect(rowsOf(block, 0).map(row => row.fields)).toEqual([['**213 公頃**'], ['560 萬']]);
  });

  it('does not change the block it was given', () => {
    const block = parse(KEY_NUMBERS);
    const before = JSON.stringify(block);
    setCell(block, 0, 0, 0, 'x');
    insertRow(block, 0, 0);
    deleteRow(block, 0, 0);
    toggleRowHighlight(block, 0, 1);
    expect(JSON.stringify(block)).toBe(before);
  });
});

describe('grid rows', () => {
  it('inserts, duplicates, deletes and moves rows', () => {
    let block = parse(KEY_NUMBERS);
    block = insertRow(block, 0, 1);
    expect(rowsOf(block, 0).map(row => row.fields[0])).toEqual(['**213 公頃**', '', '560 萬']);
    block = duplicateRow(block, 0, 2);
    expect(rowsOf(block, 0).map(row => row.fields[0])).toEqual(['**213 公頃**', '', '560 萬', '560 萬']);
    block = moveRow(block, 0, 3, 0);
    expect(rowsOf(block, 0).map(row => row.fields[0])).toEqual(['560 萬', '**213 公頃**', '', '560 萬']);
    expect(moveRow(block, 0, 0, 9)).toBe(block);
    block = deleteRow(block, 0, 2);
    expect(rowsOf(block, 0)).toHaveLength(3);
  });

  it('shows a highlighted field without its ** and keeps the wrap when the cell is set', () => {
    const block = parse(KEY_NUMBERS);
    expect(cellMatrix(block, 0)[0][0]).toBe('213 公頃');
    expect(rowsOf(setCell(block, 0, 0, 0, '214 公頃'), 0)[0].fields[0]).toBe('**214 公頃**');
    // Emptying the cell drops the wrap; typing the markers oneself is taken as written.
    expect(rowsOf(setCell(block, 0, 0, 0, ''), 0)[0].fields[0]).toBe('');
    expect(rowsOf(setCell(block, 0, 0, 0, '**x**'), 0)[0].fields[0]).toBe('**x**');
    expect(rowsOf(setCell(block, 0, 0, 0, 'a**b'), 0)[0].fields[0]).toBe('a**b');
    // The same for `__`, and a pasted cell over a highlighted one.
    const underscores = parse(':::key-numbers\n- __7__｜x\n:::\n');
    expect(cellMatrix(underscores, 0)[0][0]).toBe('7');
    expect(rowsOf(pasteMatrix(underscores, 0, { row: 0, col: 0 }, [['8', 'y']]).block, 0)[0].fields).toEqual(['__8__', 'y']);
  });

  it('shows other inline Markdown in a cell as typed, including several strong spans', () => {
    const block = parse(':::key-numbers\n- **a** and *b*｜**a** **b**｜`**`\n:::\n');
    expect(cellMatrix(block, 0)[0]).toEqual(['**a** and *b*', '**a** **b**', '`**`']);
    expect(rowsOf(setCell(block, 0, 0, 1, 'c'), 0)[0].fields[1]).toBe('c');
  });

  it('toggles the highlight with the bold first field', () => {
    let block = toggleRowHighlight(parse(KEY_NUMBERS), 0, 1);
    expect(rowsOf(block, 0)[1].fields[0]).toBe('**560 萬**');
    block = toggleRowHighlight(block, 0, 0);
    expect(rowsOf(block, 0)[0].fields[0]).toBe('213 公頃');
  });

  it('works on the active child only', () => {
    const block = insertRow(parse(BARS), 1, 1, ['新', '1']);
    expect(block.children[0].rows).toHaveLength(1);
    expect(block.children[1].rows.map(row => row.fields[0])).toEqual(['桃機預測', '新']);
  });
});

describe('child containers', () => {
  it('adds a child, taking over the loose rows of the first one', () => {
    const flat = parse(':::bars\n- a｜1\n:::\n');
    const grown = addChild(flat);
    expect(grown.children).toHaveLength(1);
    expect(grown.children[0].rows[0].fields).toEqual(['a', '1']);
    expect(grown.rows).toEqual([]);
    expect(addChild(grown).children[1].rows).toEqual([{ fields: [''] }]);
    expect(serializeInfographic(grown)).toBe('::::bars\n:::scenario\n- a｜1\n:::\n::::\n');
  });

  it('stops at the most scenarios the blog takes', () => {
    let block = parse(':::bars\n:::');
    for (let i = 0; i < 9; i++) block = addChild(block);
    expect(block.children).toHaveLength(KIND_SPECS.bars.child!.max!);
    expect(canAddChild(block)).toBe(false);
    expect(canAddChild(parse(':::line\n:::'))).toBe(true);
    expect(canAddChild(parse(':::parts\n:::'))).toBe(false);
  });

  it('gives the rows back when the last optional child goes, and leaves a required kind empty', () => {
    const bars = removeChild(removeChild(parse(BARS), 0), 0);
    expect(bars.children).toEqual([]);
    expect(bars.rows.map(row => row.fields[0])).toEqual(['桃機預測']);
    const line = parse('::::line\n:::series{title="A"}\n- 2020｜1\n:::\n::::\n');
    const without = removeChild(line, 0);
    expect(without.children).toEqual([]);
    expect(without.rows).toEqual([]);
  });

  it('reorders and renames', () => {
    let block = moveChild(parse(BARS), 0, 1);
    expect(block.children.map(child => child.attrs.label)).toEqual(['2045 年', '2025 年']);
    block = setChildAttr(block, 0, { key: 'label', type: 'text' }, '2045 年（預測）');
    expect(block.children[0].attrs.label).toBe('2045 年（預測）');
    expect(moveChild(block, 0, -1)).toBe(block);
  });
});

describe('attributes', () => {
  it('keeps the order of the others, drops empties, and writes a flag bare', () => {
    const spec = (key: string, type: 'text' | 'flag' = 'text') => ({ key, type });
    expect(withAttr({ a: '1', b: '2', c: '3' }, spec('b'), 'x')).toEqual({ a: '1', b: 'x', c: '3' });
    expect(Object.keys(withAttr({ a: '1', b: '2', c: '3' }, spec('b'), ''))).toEqual(['a', 'c']);
    expect(Object.keys(withAttr({ a: '1', c: '3' }, spec('b'), 'new'))).toEqual(['a', 'c', 'b']);
    expect(withAttr({}, spec('highlight', 'flag'), true)).toEqual({ highlight: '' });
    expect(withAttr({ highlight: '' }, spec('highlight', 'flag'), false)).toEqual({});
    expect(serializeInfographic(setAttr(parse(KEY_NUMBERS), spec('palette'), 'sequential'))).toContain('{title="T" palette="sequential"}');
  });
});

describe('selection', () => {
  const dims = { rows: 3, cols: 3 };
  it('moves from the active cell, stays inside the grid and extends from the focus corner', () => {
    expect(moveSelection(single({ row: 0, col: 0 }), 'up', dims, false)).toEqual(single({ row: 0, col: 0 }));
    expect(moveSelection(single({ row: 1, col: 1 }), 'down', dims, false)).toEqual(single({ row: 2, col: 1 }));
    const extended = moveSelection(moveSelection(single({ row: 0, col: 0 }), 'down', dims, true), 'right', dims, true);
    expect(extended).toEqual({ anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } });
    expect(moveSelection(extended, 'left', dims, false)).toEqual(single({ row: 0, col: 0 }));
    expect(moveSelection(single({ row: 1, col: 1 }), 'end', dims, false)).toEqual(single({ row: 1, col: 2 }));
    expect(moveSelection(single({ row: 1, col: 1 }), 'bottom', dims, false)).toEqual(single({ row: 2, col: 1 }));
  });

  it('wraps Tab across rows and around the grid', () => {
    expect(stepCell(single({ row: 0, col: 2 }), false, dims)).toEqual({ row: 1, col: 0 });
    expect(stepCell(single({ row: 1, col: 0 }), true, dims)).toEqual({ row: 0, col: 2 });
    // Past the last cell and before the first there is none: Tab leaves the grid there.
    expect(stepCell(single({ row: 2, col: 2 }), false, dims)).toBeNull();
    expect(stepCell(single({ row: 0, col: 0 }), true, dims)).toBeNull();
    expect(stepCell(single({ row: 0, col: 0 }), false, { rows: 0, cols: 3 })).toBeNull();
  });
});

describe('tab-separated text', () => {
  it('copies a range as TSV, quoting what a spreadsheet quotes', () => {
    const block = setCell(parse(KEY_NUMBERS), 0, 0, 2, '5" 寬\t高');
    expect(rangeToTsv(block, 0, { top: 0, bottom: 1, left: 0, right: 2 })).toBe('**213 公頃**\t機場面積\t"5"" 寬\t高"\n560 萬\t2025 年旅客\t');
    expect(rangeToTsv(block, 0, { top: 1, bottom: 1, left: 1, right: 1 })).toBe('2025 年旅客');
  });

  it('parses what spreadsheets write', () => {
    expect(parseTsv('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('a\tb\r\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseTsv('"a\tb"\t"say ""hi"""\n"line\nbreak"\tz')).toEqual([['a\tb', 'say "hi"'], ['line\nbreak', 'z']]);
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
    expect(parseTsv('x"y\tz')).toEqual([['x"y', 'z']]);
    expect(parseTsv('')).toEqual([]);
    expect(parseTsv('\n')).toEqual([['']]);
  });

  it('round-trips a copied range', () => {
    const block = parse(KEY_NUMBERS);
    const tsv = rangeToTsv(block, 0, { top: 0, bottom: 1, left: 0, right: 2 });
    const pasted = pasteMatrix(block, 0, { row: 0, col: 0 }, parseTsv(tsv)).block;
    expect(rowsOf(pasted, 0)).toEqual(rowsOf(block, 0));
    // Pasting the highlighted cell's wrapped text elsewhere stays wrapped text.
    expect(rowsOf(pasteMatrix(block, 0, { row: 1, col: 0 }, parseTsv(tsv)).block, 1)[0].fields[0]).toBe('**213 公頃**');
  });

  it('pastes from the active cell, adds rows, and drops columns past the last', () => {
    const { block, selection } = pasteMatrix(parse(KEY_NUMBERS), 0, { row: 1, col: 1 }, [['甲', '乙', '丙'], ['丁', '戊']]);
    expect(rowsOf(block, 0).map(row => row.fields)).toEqual([['**213 公頃**', '機場面積', '民航局管 41%'], ['560 萬', '甲', '乙'], ['', '丁', '戊']]);
    expect(selection).toEqual({ anchor: { row: 1, col: 1 }, focus: { row: 2, col: 2 } });
  });
});
