import { describe, expect, it } from 'vitest';
import { cellsToFields, checkCells, isStrongField, numbers, parseInfographic, plainField, rowCells, serializeInfographic, splitFields, toggleHighlight } from './model.js';

// The blog's own examples (DIRECTIVES_USAGE.md and scripts/test-infographics.mjs at a17b573e).
const BARS = `::::bars{title="桃機接得下松山的旅客嗎？" unit="萬人次" reference="4280" reference-label="桃機現有容量"}
:::scenario{label="2025 年"}
- 桃機旅客｜4,780
:::
:::scenario{label="2045 年"}
- **桃機預測旅客**｜8,380｜不含松山
- 擴建後容量｜6,000–7,000
:::
::::
`;
const KEY_NUMBERS = `:::key-numbers{title="松山機場的基本數字" source="交通部"}
- **213 公頃**｜機場面積｜民航局管 41%，其餘屬軍方
- 560 萬｜2025 年旅客
:::
`;
const TIMELINE = `::::timeline{from="2000" to="2040"}
:::lane{title="水湳"}
- 2004｜民航遷走
- 2004–2020｜轉型
:::
:::lane{title="松山" highlight}
- **2033**｜市府目標
:::
::::
`;
const LINE = `::::line{unit="萬人次"}
:::series{title="桃機旅客" highlight dashed}
- 2019｜4,869
- 2025｜4,780｜疫後回升
:::
::::
`;
const MAP = `:::map{base="taiwan"}
- **松山**｜25.069, 121.552
- 金門｜24.43, 118.37
- 松山 → 金門｜國內線
:::
`;

describe('infographic fields', () => {
  it('splits on 「｜」 but not inside code, links or strong spans', () => {
    expect(splitFields(' a ｜ b｜c ')).toEqual(['a', 'b', 'c']);
    expect(splitFields('`x｜y`｜z')).toEqual(['`x｜y`', 'z']);
    expect(splitFields('[a｜b](https://e.x)｜z')).toEqual(['[a｜b](https://e.x)', 'z']);
    expect(splitFields('**桃機｜預測**｜8')).toEqual(['**桃機｜預測**', '8']);
    expect(splitFields('a｜｜c')).toEqual(['a', '', 'c']);
  });

  it('reads numbers as the blog does', () => {
    expect(numbers('4,780')).toEqual([4780]);
    expect(numbers('6,000–7,000')).toEqual([6000, 7000]);
    expect(numbers('2000,2010')).toEqual([2000, 2010]);
    expect(numbers('25.06,121.55')).toEqual([25.06, 121.55]);
    expect(numbers('-3.5')).toEqual([-3.5]);
  });

  it('finds and toggles the highlight', () => {
    expect(isStrongField('**213 公頃**')).toBe(true);
    expect(isStrongField('**a** **b**')).toBe(true);
    expect(isStrongField('**a** b')).toBe(false);
    expect(isStrongField('')).toBe(false);
    expect(toggleHighlight(['松山', '25, 121'])).toEqual(['**松山**', '25, 121']);
    expect(toggleHighlight(['**松山**', '25, 121'])).toEqual(['松山', '25, 121']);
    expect(plainField('**[桃機](https://x)** `8`')).toBe('桃機 8');
  });

  it('lays a map route under the name and note columns', () => {
    expect(rowCells('map', ['松山 → 金門', '國內線'])).toEqual(['松山 → 金門', '', '國內線']);
    expect(cellsToFields('map', ['松山 → 金門', '', '國內線'])).toEqual(['松山 → 金門', '國內線']);
    expect(rowCells('map', ['松山', '25, 121'])).toEqual(['松山', '25, 121', '']);
    expect(cellsToFields('bars', ['a', '1', ''])).toEqual(['a', '1']);
  });
});

describe('infographic blocks', () => {
  it('round-trips the blog examples', () => {
    for (const source of [BARS, KEY_NUMBERS, TIMELINE, LINE, MAP]) {
      const block = parseInfographic(source);
      expect(block?.problems).toEqual([]);
      expect(serializeInfographic(block!)).toBe(source);
    }
  });

  it('reads children, rows, flags and attributes', () => {
    const bars = parseInfographic(BARS)!;
    expect(bars.kind).toBe('bars');
    expect(bars.attrs.reference).toBe('4280');
    expect(bars.children.map(child => child.attrs.label)).toEqual(['2025 年', '2045 年']);
    expect(bars.children[1].rows[1].fields).toEqual(['擴建後容量', '6,000–7,000']);
    const timeline = parseInfographic(TIMELINE)!;
    expect(timeline.children[1].attrs).toEqual({ title: '松山', highlight: '' });
  });

  it('is null for anything but an infographic', () => {
    expect(parseInfographic(':::info\nx\n:::')).toBeNull();
    expect(parseInfographic('- a｜1')).toBeNull();
  });

  it('reports source the grid cannot hold', () => {
    const codes = (source: string) => parseInfographic(source)!.problems.map(problem => problem.code);
    expect(codes(':::parts\nIntro text\n- a｜1\n:::')).toEqual(['text-outside-list']);
    expect(codes(':::parts\n- a｜1\n  - nested\n:::')).toEqual(['nested-list']);
    expect(codes(':::parts\n- a｜1\ncontinued\n:::')).toEqual(['multiline-item']);
    expect(codes('::::bars\n:::info\nx\n:::\n::::')).toEqual(['unknown-container']);
    expect(codes('::::bars\n- loose｜1\n:::scenario\n- a｜1\n:::\n::::')).toEqual(['rows-beside-children']);
    expect(codes(':::parts\n- a｜1')).toEqual(['unclosed']);
    expect(codes(':::parts\n- a｜1 :::')).toEqual(['trailing-fence']);
    expect(parseInfographic(':::parts\n- a｜1 :::')!.rows[0].fields).toEqual(['a', '1']);
  });

  it('keeps blank lines between items as one list and does not report them', () => {
    const block = parseInfographic(':::parts\n- a｜1\n\n- b｜2\n:::')!;
    expect(block.problems).toEqual([]);
    expect(block.rows.map(row => row.fields[0])).toEqual(['a', 'b']);
  });

  it('writes a four-colon fence once children appear, flags bare and empty values out', () => {
    const block = parseInfographic(':::line{unit="%" title=""}\n:::')!;
    block.children.push({ name: 'series', attrs: { title: 'A "quoted"', highlight: '', dashed: 'x' }, rows: [{ fields: ['2020', '1', ''] }] });
    expect(serializeInfographic(block)).toBe(`::::line{unit="%"}\n:::series{title='A "quoted"' highlight dashed="x"}\n- 2020｜1\n:::\n::::\n`);
  });
});

describe('infographic cell checks', () => {
  it('flags numbers, ranges, positions and routes', () => {
    const bars = parseInfographic('::::bars\n:::scenario\n- a｜六千\n- b｜1–2–3\n- c｜5\n:::\n::::')!;
    expect(checkCells(bars)).toEqual([{ child: 0, row: 0, column: 1, code: 'not-a-number' }, { child: 0, row: 1, column: 1, code: 'not-a-range' }]);
    const map = parseInfographic(':::map\n- 松山｜25.069, 121.552\n- 東京｜35.6, 139.7\n- 某處｜25\n- 松山 → 台南｜x\n- 松山 →｜x\n:::')!;
    expect(checkCells(map).map(issue => [issue.row, issue.code])).toEqual([[1, 'outside-map'], [2, 'not-a-position'], [3, 'unknown-point'], [4, 'route-needs-two-points']]);
    expect(checkCells(parseInfographic(MAP)!)).toEqual([]);
  });
});
