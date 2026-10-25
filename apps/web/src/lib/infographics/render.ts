/**
 * Renders the infographic directives (`key-numbers`, `bars`, `parts`, `line`, `timeline`, `status-board`, `map`) to
 * the figure HTML of the blog's `remark-infographics` plugin (wayne930242/knowledge-base, `blog/src/plugins`,
 * commit a17b573e): the same element tree, `ig-*` classes, numbers and zh-TW formatting. The blog's CSS is not
 * used; the app styles the figures from its theme tokens (`directives/infographics.css`).
 */

import { escapeHtml, fill, type NoteLanguage, stringsFor } from '../directives.js';
import type { TranslationKey } from '../i18n/en.js';
import { INFOGRAPHIC_PALETTES, type InfographicBlock, type InfographicKind, type InfographicRow, isStrongField, mapBase, MAX_SCENARIOS, numbers, parseInfographic, plainField, STATUS_VALUES } from './model.js';

/** A whole-figure error the blog fails its build on; the caller shows it in the figure's place. */
export class InfographicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InfographicError';
  }
}

export interface InfographicContext {
  /** Inline Markdown of the note's own dialect to HTML (emphasis, links, code, math), without a wrapping paragraph. */
  renderInline: (markdown: string) => string;
  /** The note's language, for the figure's own words; without one, the page's. */
  language?: NoteLanguage;
}

/** More ticks than a figure can show come from a range far wider than its data; drawing them would hang the page. */
const MAX_TICKS = 200;

function fail(message: string): never {
  throw new InfographicError(message);
}

// ---------------------------------------------------------------------------
// HTML builders

type AttrValue = string | number | boolean | string[] | undefined;

/** `<name attrs>children</name>`; an empty class list, `false` and `undefined` leave the attribute out, `true` writes it bare. */
function tag(name: string, attrs: Record<string, AttrValue> = {}, children: string | string[] = ''): string {
  const parts = Object.entries(attrs).flatMap(([key, value]) => {
    if (value === undefined || value === false) return [];
    if (value === true) return [key];
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    return Array.isArray(value) && !text ? [] : [`${key}="${escapeHtml(text)}"`];
  });
  const open = `<${name}${parts.length ? ` ${parts.join(' ')}` : ''}>`;
  if (name === 'input') return open;
  return `${open}${Array.isArray(children) ? children.join('') : children}</${name}>`;
}

const text = (value: string): string => escapeHtml(value);

const highlightClass = (highlight: boolean): string[] => highlight ? ['is-highlight'] : [];

// ---------------------------------------------------------------------------
// Parsing helpers

interface Item {
  fields: string[];
  highlight: boolean;
}

function itemsOf(rows: readonly InfographicRow[]): Item[] {
  return rows.map(row => ({ fields: row.fields, highlight: row.fields.some(isStrongField) }));
}

function attrOf(attrs: Record<string, string>, key: string): string | undefined {
  const value = attrs[key];
  return value === undefined ? undefined : value.trim();
}

function numberAttr(attrs: Record<string, string>, key: string): number | undefined {
  const value = attrOf(attrs, key);
  if (value === undefined || value === '') return undefined;
  return numbers(value)[0];
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

/** The words a reader sees in a field, without the strong markers the blog's `plain` leaves out too. */
function plain(field: string | undefined): string {
  return plainField(field ?? '').replaceAll('*', '');
}

function firstNumber(field: string | undefined): number | undefined {
  return numbers(plain(field))[0];
}

interface Renderer {
  /** The figure's own words, in the note's language. */
  strings: Record<TranslationKey, string>;
  inline: (field: string | undefined) => string;
  /** A field that is only a number or range gets the directive's unit. */
  withUnit: (field: string | undefined, unit?: string) => string;
}

function renderer(context: InfographicContext): Renderer {
  const inline = (field: string | undefined): string => field?.trim() ? context.renderInline(field) : '';
  return {
    strings: stringsFor(context.language),
    inline,
    withUnit: (field, unit) => {
      const raw = plain(field).trim();
      if (!unit || !/^-?[\d,.]+(?:\s*[–-]\s*[\d,.]+)?$/.test(raw)) return inline(field);
      return `${inline(field)}${text(` ${unit}`)}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Figure frame

function frame(kind: InfographicKind, attrs: Record<string, string>, body: string, palette: string | undefined, r: Renderer): string {
  const title = attrOf(attrs, 'title');
  const subtitle = attrOf(attrs, 'subtitle');
  const note = attrOf(attrs, 'note');
  const source = attrOf(attrs, 'source');
  const children: string[] = [];
  if (title) children.push(tag('p', { class: 'ig-title' }, text(title)));
  if (subtitle) children.push(tag('p', { class: 'ig-subtitle' }, text(subtitle)));
  children.push(tag('div', { class: 'ig-body' }, body));
  if (note || source) {
    const caption: string[] = [];
    if (note) caption.push(tag('p', {}, text(`${r.strings['infographic.render.caption.note']}${note}`)));
    if (source) caption.push(tag('p', {}, text(`${r.strings['infographic.render.caption.source']}${source}`)));
    children.push(tag('figcaption', { class: 'ig-caption' }, caption));
  }
  return tag('figure', { class: ['ig-figure', `ig-${kind}`], 'data-palette': palette }, children);
}

// ---------------------------------------------------------------------------
// key-numbers: - 值｜標籤｜說明

function keyNumbers(block: InfographicBlock, r: Renderer): string {
  const items = itemsOf(block.rows).map((item, index) => {
    const [value, label, note] = item.fields;
    const children = [tag('dt', { class: 'ig-number-label' }, r.inline(label)), tag('dd', { class: ['ig-number-value', ...highlightClass(isStrongField(value ?? ''))] }, r.inline(value))];
    if (note?.trim()) children.push(tag('dd', { class: 'ig-number-note' }, r.inline(note)));
    return tag('div', { class: 'ig-number', style: `--ig-i:${index}` }, children);
  });
  return tag('dl', { class: 'ig-numbers' }, items);
}

// ---------------------------------------------------------------------------
// bars: - 標籤｜數值或範圍｜說明, optional :::scenario children

interface BarRow {
  item: Item;
  values: number[];
}

const barRows = (rows: readonly InfographicRow[]): BarRow[] => itemsOf(rows).map(item => ({ item, values: numbers(plain(item.fields[1])) }));

interface Reference {
  value: number;
  label: string;
}

function barPanel(rows: BarRow[], scale: number, unit: string | undefined, reference: Reference | undefined, r: Renderer): string {
  const children = rows.map(({ item, values }, index) => {
    const [label, display, note] = item.fields;
    const end = values.length ? Math.max(...values) : 0;
    const start = values.length > 1 ? Math.min(...values) : 0;
    const track: string[] = [];
    if (values.length > 1) track.push(tag('span', { class: 'ig-bar-range-base', style: `width:${percent(start / scale * 100)}` }));
    track.push(tag('span', { class: ['ig-bar-fill', ...highlightClass(item.highlight)], style: `--ig-i:${index};left:${percent(start / scale * 100)};width:${percent((end - start) / scale * 100)}` }), tag('span', { class: 'ig-bar-value', style: `--ig-i:${index};left:${percent(end / scale * 100)}` }, r.withUnit(display, unit)));
    if (reference) track.push(tag('span', { class: 'ig-bar-reference', style: `left:${percent(reference.value / scale * 100)}` }));
    const row = [tag('span', { class: 'ig-bar-label' }, r.inline(label)), tag('span', { class: 'ig-bar-track' }, track)];
    if (note?.trim()) row.push(tag('span', { class: 'ig-bar-note' }, r.inline(note)));
    return tag('li', { class: 'ig-bar-row' }, row);
  });
  const panel = [tag('ul', { class: 'ig-bars' }, children)];
  if (reference) panel.push(tag('p', { class: 'ig-bar-reference-legend' }, text(fill(r.strings['infographic.render.barReference.legend'], { label: reference.label, value: `${formatNumber(reference.value)}${unit ? ` ${unit}` : ''}` }))));
  return panel.join('');
}

function referenceOf(r: Renderer, attrs: Record<string, string>, fallback?: Record<string, string>): Reference | undefined {
  const value = numberAttr(attrs, 'reference') ?? (fallback && numberAttr(fallback, 'reference'));
  if (value === undefined) return undefined;
  return { value, label: attrOf(attrs, 'reference-label') ?? (fallback && attrOf(fallback, 'reference-label')) ?? r.strings['infographic.render.barReference.default'] };
}

function bars(block: InfographicBlock, id: string, r: Renderer): string {
  const unit = attrOf(block.attrs, 'unit');
  const groups = block.children.length ? block.children.map(scenario => ({ label: attrOf(scenario.attrs, 'label') ?? attrOf(scenario.attrs, 'title') ?? '', note: attrOf(scenario.attrs, 'note'), rows: barRows(scenario.rows), reference: referenceOf(r, scenario.attrs, block.attrs) })) : [{ label: '', note: undefined, rows: barRows(block.rows), reference: referenceOf(r, block.attrs) }];

  if (groups.length > MAX_SCENARIOS) fail(`bars takes at most ${MAX_SCENARIOS} scenarios`);
  const largest = Math.max(1, ...groups.flatMap(group => [...group.rows.flatMap(row => row.values), group.reference?.value ?? 0]));
  const scale = numberAttr(block.attrs, 'max') ?? largest * 1.15;

  if (groups.length === 1) return barPanel(groups[0].rows, scale, unit, groups[0].reference, r);

  const controls: string[] = [];
  groups.forEach((group, index) => {
    const inputId = `${id}-s${index}`;
    controls.push(tag('input', { class: 'ig-scenario-input', type: 'radio', name: id, id: inputId, checked: index === 0 }), tag('label', { class: 'ig-tab', for: inputId }, text(group.label)));
  });
  const panels = groups.map(group => {
    const children: string[] = [];
    if (group.label) children.push(tag('p', { class: 'ig-panel-label' }, text(group.label)));
    if (group.note) children.push(tag('p', { class: 'ig-scenario-note' }, text(group.note)));
    children.push(barPanel(group.rows, scale, unit, group.reference, r));
    return tag('div', { class: 'ig-panel' }, children);
  });
  return tag('div', { class: 'ig-scenarios' }, [...controls, tag('div', { class: 'ig-panels' }, panels)]);
}

// ---------------------------------------------------------------------------
// parts: - 標籤｜數值｜說明

/** Categories cycle the theme's six accents. */
const CATEGORIES = 6;

function parts(block: InfographicBlock, r: Renderer): string {
  const unit = attrOf(block.attrs, 'unit');
  const rows = itemsOf(block.rows).map(item => ({ item, value: firstNumber(item.fields[1]) ?? 0 }));
  const total = numberAttr(block.attrs, 'total') ?? rows.reduce((sum, row) => sum + row.value, 0);

  const segments = rows.map(({ item, value }, index) => tag('span', { class: ['ig-part', `ig-part-${index % CATEGORIES}`, ...highlightClass(item.highlight)], style: `--ig-i:${index};flex-grow:${value}` }));
  const legend = rows.map(({ item, value }, index) => {
    const [label, display, note] = item.fields;
    const share = total ? fill(r.strings['infographic.render.parts.share'], { percent: formatNumber(value / total * 100) }) : '';
    const children = [tag('span', { class: ['ig-swatch', `ig-part-${index % CATEGORIES}`, ...highlightClass(item.highlight)] }), tag('span', { class: 'ig-legend-label' }, r.inline(label)), tag('span', { class: 'ig-legend-value' }, `${r.withUnit(display, unit)}${text(share)}`)];
    if (note?.trim()) children.push(tag('span', { class: 'ig-legend-note' }, r.inline(note)));
    return tag('li', { class: 'ig-legend-item' }, children);
  });
  return tag('div', { class: 'ig-parts-bar' }, segments) + tag('ul', { class: 'ig-legend' }, legend);
}

// ---------------------------------------------------------------------------
// status-board: :::group{status="done|partial|none" title=""} - 項目｜說明

function statusBoard(block: InfographicBlock, r: Renderer): string {
  if (!block.children.length) fail('status-board needs :::group children');
  return tag(
    'div',
    { class: 'ig-status' },
    block.children.map((group, groupIndex) => {
      const status = attrOf(group.attrs, 'status') ?? 'partial';
      if (!(STATUS_VALUES as readonly string[]).includes(status)) fail(`unknown status-board status "${status}"`);
      const items = itemsOf(group.rows);
      return tag('section', { class: ['ig-status-group', `is-${status}`] }, [
        tag('p', { class: 'ig-status-heading' }, [text(attrOf(group.attrs, 'title') ?? ''), tag('span', { class: 'ig-status-count' }, text(fill(r.strings['infographic.render.status.count'], { count: String(items.length) })))]),
        tag(
          'ul',
          { class: 'ig-status-list' },
          items.map((item, index) => {
            const [label, detail] = item.fields;
            const children = [tag('span', { class: 'ig-status-item-label' }, r.inline(label))];
            if (detail?.trim()) children.push(tag('span', { class: 'ig-status-item-detail' }, r.inline(detail)));
            return tag('li', { class: ['ig-status-item', ...highlightClass(item.highlight)], style: `--ig-i:${groupIndex * 4 + index}` }, children);
          }),
        ),
      ]);
    }),
  );
}

// ---------------------------------------------------------------------------
// timeline: :::lane{title="" highlight} - 年份或「起–迄」｜事件

function timeline(block: InfographicBlock, r: Renderer): string {
  if (!block.children.length) fail('timeline needs :::lane children');
  const parsed = block.children.map(lane => ({ lane, items: itemsOf(lane.rows).map(item => ({ item, years: numbers(plain(item.fields[0])) })) }));
  const allYears = parsed.flatMap(lane => lane.items.flatMap(item => item.years));
  const from = numberAttr(block.attrs, 'from') ?? Math.min(...allYears);
  const to = numberAttr(block.attrs, 'to') ?? Math.max(...allYears);
  if (!(to > from)) fail('timeline needs to > from');
  const at = (year: number) => percent((year - from) / (to - from) * 100);
  const tickAttr = attrOf(block.attrs, 'ticks');
  const decades = Math.floor(to / 10) - Math.ceil(from / 10) + 1;
  if (!tickAttr && decades > MAX_TICKS) fail(`timeline spans ${decades} decades; set ticks or a shorter from–to`);
  const ticks = tickAttr ? numbers(tickAttr) : Array.from({ length: Math.max(decades, 0) }, (_, index) => (Math.ceil(from / 10) + index) * 10);

  const axis = tag('div', { class: 'ig-axis' }, ticks.map(year => tag('span', { class: ['ig-axis-tick', ...year <= from ? ['is-start'] : [], ...year >= to ? ['is-end'] : []], style: `left:${at(year)}` }, text(String(year)))));

  const laneNodes = parsed.map(({ lane, items }, laneIndex) => {
    const marks: string[] = [];
    const entries: string[] = [];
    items.forEach(({ item, years }, index) => {
      const [when, label] = item.fields;
      const classes = highlightClass(item.highlight);
      const style = `--ig-i:${laneIndex * 3 + index}`;
      if (years.length > 1) {
        const [start, end] = [Math.min(...years), Math.max(...years)];
        marks.push(tag('span', { class: ['ig-span', ...classes], 'data-k': index, style: `${style};left:${at(start)};width:calc(${at(end)} - ${at(start)})` }));
      } else if (years.length === 1) {
        marks.push(tag('span', { class: ['ig-event', ...classes], 'data-k': index, style: `${style};left:${at(years[0])}` }));
      }
      entries.push(tag('li', { class: classes, 'data-k': index, tabindex: 0 }, [tag('span', { class: 'ig-when' }, r.inline(when)), tag('span', { class: 'ig-what' }, r.inline(label))]));
    });
    const highlight = lane.attrs.highlight !== undefined;
    return tag('div', { class: ['ig-lane', ...highlightClass(highlight)] }, [tag('p', { class: 'ig-lane-label' }, text(attrOf(lane.attrs, 'title') ?? '')), tag('div', { class: 'ig-lane-track' }, marks), tag('ul', { class: 'ig-lane-events' }, entries)]);
  });
  return tag('div', { class: 'ig-timeline' }, [axis, ...laneNodes]);
}

// ---------------------------------------------------------------------------
// line: :::series{title="" highlight dashed} - x｜y｜註記

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** About how wide the plot draws once the figure is wide enough to show labels in it: what a label has to fit in. */
const NOMINAL_PLOT_WIDTH = 400;

function line(block: InfographicBlock, r: Renderer): string {
  const unit = attrOf(block.attrs, 'unit');
  if (!block.children.length) fail('line needs :::series children');

  const series = block.children.map(child => ({ title: attrOf(child.attrs, 'title') ?? '', highlight: child.attrs.highlight !== undefined, dashed: child.attrs.dashed !== undefined, points: itemsOf(child.rows).map(item => ({ x: firstNumber(item.fields[0]), y: firstNumber(item.fields[1]), item })).filter((point): point is { x: number; y: number; item: Item; } => Number.isFinite(point.x) && Number.isFinite(point.y)).sort((a, b) => a.x - b.x) }));
  const xs = series.flatMap(s => s.points.map(p => p.x));
  const ys = series.flatMap(s => s.points.map(p => p.y));
  if (!xs.length) fail('line has no data points');

  const xMin = numberAttr(block.attrs, 'from') ?? Math.min(...xs);
  const xMax = numberAttr(block.attrs, 'to') ?? Math.max(...xs);
  const step = niceStep((numberAttr(block.attrs, 'max') ?? Math.max(...ys)) - (numberAttr(block.attrs, 'min') ?? Math.min(0, ...ys)), 4);
  const yMin = numberAttr(block.attrs, 'min') ?? Math.floor(Math.min(0, ...ys) / step) * step;
  const yMax = numberAttr(block.attrs, 'max') ?? Math.ceil(Math.max(...ys) / step) * step;
  if (!(xMax > xMin) || !(yMax > yMin)) fail('line needs a non-empty range');

  const x = (value: number) => (value - xMin) / (xMax - xMin) * 100;
  const y = (value: number) => 100 - (value - yMin) / (yMax - yMin) * 100;
  const valueText = (value: number) => `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;

  const grid: string[] = [];
  const overlay: string[] = [];
  // Ticks by index: adding the step to a value far larger than it (min=1e16) never moves it.
  const yTickCount = Math.floor((yMax - yMin) / step + 1 / 1000) + 1;
  if (!(yTickCount <= MAX_TICKS)) fail('line has too many y ticks for its range; set min and max closer to the data');
  for (let index = 0; index < yTickCount; index++) {
    const tick = yMin + index * step;
    grid.push(tag('line', { x1: 0, x2: 100, y1: y(tick), y2: y(tick), class: 'ig-grid', 'vector-effect': 'non-scaling-stroke' }));
    overlay.push(tag('span', { class: 'ig-y-tick', style: `top:${percent(y(tick))}` }, text(formatNumber(tick))));
  }
  const xTickAttr = attrOf(block.attrs, 'ticks');
  const distinctXs = [...new Set(xs)];
  const xTicks = xTickAttr ? numbers(xTickAttr) : distinctXs.length <= 8 ? distinctXs.sort((a, b) => a - b) : [xMin, xMax];
  // A narrow figure hides the minor ticks: those within 15% of the last kept tick or of the last tick, which always shows.
  let kept = -Infinity;
  const lastAt = xTicks.length ? x(xTicks[xTicks.length - 1]) : Infinity;
  xTicks.forEach((tick, index) => {
    const at = x(tick);
    const minor = index > 0 && index < xTicks.length - 1 && (at - kept < 15 || lastAt - at < 15);
    if (!minor) kept = at;
    overlay.push(tag('span', { class: ['ig-x-tick', ...minor ? ['is-minor'] : []], style: `left:${percent(at)}` }, text(String(tick))));
  });

  const paths = series.map((s, index) => tag('path', { d: s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(''), class: ['ig-line-path', `ig-series-${index % CATEGORIES}`, ...highlightClass(s.highlight), ...s.dashed ? ['is-dashed'] : []], 'vector-effect': 'non-scaling-stroke', 'data-s': index }));

  // End labels sit beside the last point; push apart those closer than the two lines a label takes.
  const labelTops = new Map<number, number>();
  const ends = series.map((s, index) => ({ index, last: s.points[s.points.length - 1] })).filter(end => end.last).sort((a, b) => y(a.last.y) - y(b.last.y));
  let previous = -Infinity;
  for (const end of ends) {
    const top = Math.max(y(end.last.y), previous + 12);
    labelTops.set(end.index, top);
    previous = top;
  }

  // A noted point's label goes on the side of its point where no line runs through the label's box: above by default,
  // below at a local minimum. Noted points that sit close in x take turns instead (topmost above, the rest below), so
  // that labels never land on each other. The last point's value is already in the series end label, so it shows its
  // note only.
  const noted = series.flatMap((s, seriesIndex) => s.points.map((point, pointIndex) => ({ seriesIndex, pointIndex, point })).filter(entry => entry.point.item.fields[2]?.trim()));
  const below = new Set<string>();
  const key = (seriesIndex: number, pointIndex: number) => `${seriesIndex}:${pointIndex}`;
  const yOnSeries = (points: typeof series[number]['points'], at: number): number | undefined => {
    for (let index = 1; index < points.length; index++) {
      const [from, to] = [x(points[index - 1].x), x(points[index].x)];
      if (at >= from && at <= to) return to === from ? y(points[index].y) : y(points[index - 1].y) + (y(points[index].y) - y(points[index - 1].y)) * (at - from) / (to - from);
    }
    return undefined;
  };
  /** How many samples of any line fall in the label's box on one side of the point. */
  const crossings = ({ pointIndex, point, seriesIndex }: typeof noted[number], side: 1 | -1, inline: boolean): number => {
    const lines = series[seriesIndex].points.length;
    const reach = inline ? 18 : 14;
    const [left, right] = pointIndex === lines - 1 ? [-reach, 0] : pointIndex === 0 ? [0, reach] : [-reach / 2, reach / 2];
    const height = pointIndex === lines - 1 ? 10 : inline ? 7 : 17;
    const [top, bottom] = side < 0 ? [y(point.y) - height - 1, y(point.y) - 1] : [y(point.y) + 1, y(point.y) + height + 1];
    let hits = top < 0 || bottom > 100 ? 4 : 0;
    for (const other of series) {
      for (let offset = left; offset <= right; offset += 2) {
        const lineY = yOnSeries(other.points, x(point.x) + offset);
        if (lineY !== undefined && lineY >= top && lineY <= bottom) hits++;
      }
    }
    return hits;
  };
  /** The width in px of a noted point's label on one row (12px text, wide characters twice as wide as the rest) and its offset from the point. */
  const rowWidth = (point: { y: number; item: Item; }) => [plain(point.item.fields[2]), valueText(point.y)].reduce((sum, part) => sum + [...part].reduce((width, char) => width + (/[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 12 : 7), 0), 0) + 6 + 6;
  const inline = new Set<string>();
  for (const entry of noted) {
    const id = key(entry.seriesIndex, entry.pointIndex);
    const points = series[entry.seriesIndex].points;
    const [before, after] = [points[entry.pointIndex - 1], points[entry.pointIndex + 1]];
    const preferBelow = Boolean(before && after && entry.point.y < before.y && entry.point.y < after.y);
    // A one-row label hangs to the left of its point, so it needs that much room before the figure's edge.
    const rowFits = x(entry.point.x) / 100 * NOMINAL_PLOT_WIDTH >= rowWidth(entry.point);
    const options = ([false, true] as const).filter(oneLine => !oneLine || rowFits || entry.pointIndex === points.length - 1).flatMap(oneLine => ([-1, 1] as const).map(side => ({ oneLine, side, cost: crossings(entry, side, oneLine) * 2 + (oneLine ? 1 : 0) + ((side > 0) === preferBelow ? 0 : 1) })));
    const best = options.reduce((chosen, option) => option.cost < chosen.cost ? option : chosen);
    if (best.side > 0) below.add(id);
    if (best.oneLine && entry.pointIndex !== points.length - 1) inline.add(id);
  }
  const unplaced = new Set(noted);
  for (const entry of noted) {
    if (!unplaced.has(entry)) continue;
    const cluster = noted.filter(other => unplaced.has(other) && Math.abs(x(other.point.x) - x(entry.point.x)) < 14);
    cluster.forEach(other => unplaced.delete(other));
    if (cluster.length < 2) continue;
    cluster.sort((a, b) => y(a.point.y) - y(b.point.y));
    cluster.forEach((other, order) => (order ? below.add(key(other.seriesIndex, other.pointIndex)) : below.delete(key(other.seriesIndex, other.pointIndex))));
  }

  series.forEach((s, index) => {
    const seriesClasses = [`ig-series-${index % CATEGORIES}`, ...highlightClass(s.highlight)];
    s.points.forEach((point, pointIndex) => {
      const note = point.item.fields[2];
      const isLast = pointIndex === s.points.length - 1;
      const label: string[] = [];
      if (note?.trim()) label.push(tag('span', { class: 'ig-point-note' }, r.inline(note)));
      if (!(isLast && note?.trim())) label.push(tag('span', { class: 'ig-point-value' }, text(valueText(point.y))));
      overlay.push(tag('span', { class: ['ig-point', ...seriesClasses, ...note?.trim() ? ['is-labeled'] : [], ...below.has(key(index, pointIndex)) ? ['is-below'] : [], ...inline.has(key(index, pointIndex)) ? ['is-inline'] : [], ...pointIndex === 0 ? ['is-first'] : [], ...isLast ? ['is-last'] : []], style: `left:${percent(x(point.x))};top:${percent(y(point.y))}`, tabindex: 0, 'data-s': index }, tag('span', { class: 'ig-point-label' }, label)));
    });
    const last = s.points[s.points.length - 1];
    if (last) overlay.push(tag('span', { class: ['ig-series-label', ...seriesClasses], style: `top:${percent(labelTops.get(index) ?? y(last.y))}`, 'data-s': index, tabindex: 0 }, [tag('span', {}, text(s.title)), tag('span', { class: 'ig-series-last' }, text(valueText(last.y)))]));
  });

  const svg = tag('svg', { class: 'ig-line-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true', preserveAspectRatio: 'none' }, [...grid, ...paths]);
  const plot = tag('div', { class: 'ig-plot' }, [svg, ...overlay]);

  const table = tag('details', { class: 'ig-data' }, [tag('summary', {}, text(r.strings['infographic.render.line.data'])), tag('table', {}, [tag('thead', {}, tag('tr', {}, [tag('th', {}, text(r.strings['infographic.render.line.series'])), tag('th', {}, text(r.strings['infographic.render.line.time'])), tag('th', {}, text(unit ? fill(r.strings['infographic.render.line.valueUnit'], { unit }) : r.strings['infographic.render.line.value']))])), tag('tbody', {}, series.flatMap(s => s.points.map(point => tag('tr', {}, [tag('td', {}, text(s.title)), tag('td', {}, r.inline(point.item.fields[0])), tag('td', {}, text(formatNumber(point.y)))]))))])]);

  // Narrow screens drop the in-plot labels, which collide, for this legend.
  const legend = tag(
    'ul',
    { class: ['ig-legend', 'ig-line-legend'] },
    series.map((s, index) => {
      const last = s.points[s.points.length - 1];
      return tag('li', { class: ['ig-legend-item', `ig-series-${index % CATEGORIES}`, ...highlightClass(s.highlight), ...s.dashed ? ['is-dashed'] : []] }, [tag('span', { class: 'ig-swatch' }), tag('span', { class: 'ig-legend-label' }, text(s.title)), tag('span', { class: 'ig-legend-value' }, text(last ? valueText(last.y) : ''))]);
    }),
  );

  return tag('div', { class: 'ig-line-chart' }, plot) + legend + table;
}

// ---------------------------------------------------------------------------
// map{base}: - 地點｜緯度, 經度｜說明 ; - 起點 → 終點｜說明

function map(block: InfographicBlock, r: Renderer): string {
  const baseName = attrOf(block.attrs, 'base') ?? 'taiwan';
  const base = mapBase(baseName);
  if (!base) fail(`unknown map base "${baseName}"`);

  const latMid = (base.lat[0] + base.lat[1]) / 2 * Math.PI / 180;
  const width = (base.lon[1] - base.lon[0]) * Math.cos(latMid);
  const project = (lat: number, lon: number) => ({ x: (lon - base.lon[0]) * Math.cos(latMid) / width * 100, y: (base.lat[1] - lat) / (base.lat[1] - base.lat[0]) * 100 });

  const points = new Map<string, { x: number; y: number; }>();
  const pointNodes: string[] = [];
  const routes: string[] = [];
  const legend: string[] = [];
  const items = itemsOf(block.rows);

  items.forEach((item, index) => {
    const [name, second, note] = item.fields;
    const coordinates = numbers(plain(second));
    if (plain(name).includes('→') || coordinates.length < 2) return;
    const [lat, lon] = coordinates;
    const position = project(lat, lon);
    points.set(plain(name).trim(), position);
    const classes = highlightClass(item.highlight);
    pointNodes.push(tag('span', { class: ['ig-map-point', ...classes, ...position.x > 68 ? ['is-left'] : []], style: `--ig-i:${index};left:${percent(position.x)};top:${percent(position.y)}`, 'data-k': index }, tag('span', { class: 'ig-map-point-label' }, r.inline(name))));
    const legendChildren = [tag('span', { class: 'ig-legend-label' }, r.inline(name))];
    if (note?.trim()) legendChildren.push(tag('span', { class: 'ig-legend-note' }, r.inline(note)));
    legend.push(tag('li', { class: ['ig-legend-item', ...classes], 'data-k': index, tabindex: 0 }, legendChildren));
  });

  items.forEach((item, index) => {
    const [name, note] = item.fields;
    const label = plain(name);
    if (!label.includes('→')) return;
    const [startName, endName] = label.split('→').map(part => part.trim());
    const start = points.get(startName);
    const end = points.get(endName);
    if (!start || !end) fail(`map route "${label}" names a point that is not listed`);
    const sx = start.x / 100 * base.width;
    const sy = start.y / 100 * base.height;
    const ex = end.x / 100 * base.width;
    const ey = end.y / 100 * base.height;
    const bend = 0.18;
    const cx = (sx + ex) / 2 - (ey - sy) * bend;
    const cy = (sy + ey) / 2 + (ex - sx) * bend;
    routes.push(tag('path', { d: `M${sx.toFixed(1)},${sy.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`, class: ['ig-route', ...highlightClass(item.highlight)], pathLength: 1, style: `--ig-i:${index}` }));
    const legendChildren = [tag('span', { class: 'ig-legend-label' }, r.inline(name))];
    if (note?.trim()) legendChildren.push(tag('span', { class: 'ig-legend-note' }, r.inline(note)));
    legend.push(tag('li', { class: ['ig-legend-item', 'is-route', ...highlightClass(item.highlight)] }, legendChildren));
  });

  const layers = [tag('span', { class: ['ig-map-layer', 'ig-map-land'] }), tag('span', { class: ['ig-map-layer', 'ig-map-borders'] })];
  if (base.focus) layers.push(tag('span', { class: ['ig-map-layer', 'ig-map-focus'] }));
  if (routes.length) layers.push(tag('svg', { class: 'ig-map-routes', viewBox: `0 0 ${base.width} ${base.height}`, 'aria-hidden': 'true' }, routes));

  return tag('div', { class: 'ig-map-frame' }, [tag('div', { class: ['ig-map', `ig-map-${baseName}`], style: `aspect-ratio:${base.width}/${base.height}` }, [...layers, ...pointNodes]), tag('ul', { class: 'ig-legend' }, legend)]);
}

// ---------------------------------------------------------------------------

/** Every figure's radio group and ids carry this number, so they stay unique in a page however often a note renders. */
let figureCount = 0;

/**
 * The figure for `source`, one infographic block from its opening fence through its closing fence, as a single line of
 * HTML. Throws {@link InfographicError} for what the blog fails its build on.
 */
export function renderInfographic(source: string, context: InfographicContext): string {
  const block = parseInfographic(source);
  if (!block) fail('not an infographic block');
  const id = `ig-${++figureCount}`;
  const palette = attrOf(block.attrs, 'palette');
  if (palette && !INFOGRAPHIC_PALETTES.includes(palette)) fail(`unknown palette "${palette}"`);

  const r = renderer(context);
  const body = block.kind === 'key-numbers' ? keyNumbers(block, r) : block.kind === 'bars' ? bars(block, id, r) : block.kind === 'parts' ? parts(block, r) : block.kind === 'line' ? line(block, r) : block.kind === 'timeline' ? timeline(block, r) : block.kind === 'status-board' ? statusBoard(block, r) : map(block, r);
  // Only the data palettes draw differently; the blog's section palettes give the theme default.
  const dataPalette = palette && (['categorical', 'diverging', 'sequential'] as readonly string[]).includes(palette) ? palette : undefined;
  return frame(block.kind, block.attrs, body, dataPalette, r);
}

/**
 * The inline box that stands in for a figure that cannot render. The source goes in a `<pre>` with its line breaks as
 * character references, so the box stays one HTML block when the note's Markdown runs over it.
 */
export function renderInfographicError(error: InfographicError, source: string, heading: string): string {
  const escaped = escapeHtml(source.replace(/\n+$/, '')).replaceAll('\n', '&#10;');
  return tag('div', { class: 'ig-error', role: 'alert' }, [tag('p', { class: 'ig-error-title' }, text(heading)), tag('p', { class: 'ig-error-message' }, text(error.message)), `<pre class="ig-error-source">${escaped}</pre>`]);
}
