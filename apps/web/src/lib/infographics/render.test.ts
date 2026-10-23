// @vitest-environment node
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../directives.js';
import { createNoteRenderer } from '../markdown.js';
import { InfographicError, renderInfographic } from './render.js';

// The cases of the blog's scripts/test-infographics.mjs (wayne930242/knowledge-base at a17b573e), adapted: the same
// documents and the same assertions on the figure HTML, here from renderInfographic instead of the remark plugin.
const marked = new Marked();
const render = (source: string) => renderInfographic(source.endsWith('\n') ? source : `${source}\n`, { renderInline: field => marked.parseInline(field, { gfm: true }) as string });
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

const BARS = `::::bars{unit="萬人次" reference="4280" reference-label="現有容量"}
:::scenario{label="現在"}
- 旅客｜4,780
:::
:::scenario{label="2045"}
- **預測**｜8,380｜不含松山
- 擴建後容量｜6,000–7,000
:::
::::`;

describe('renderInfographic (the blog plugin cases)', () => {
  it('key-numbers keeps inline markup and marks bold values', () => {
    const html = render(`:::key-numbers{title="松機" source="交通部"}
- **213 公頃**｜面積｜軍方 59%
- 560 萬｜2025 旅客
:::`);
    expect(html).toMatch(/<figure class="ig-figure ig-key-numbers">/);
    expect(html).toMatch(/class="ig-number-value is-highlight"><strong>213 公頃<\/strong>/);
    expect(html).toMatch(/資料來源：交通部/);
    expect(html).toContain('<p class="ig-title">松機</p>');
    expect(html).toContain('<dt class="ig-number-label">面積</dt>');
    expect(html).toContain('<dd class="ig-number-note">軍方 59%</dd>');
    expect(html).not.toContain('說明：');
  });

  it('bars scale ranges and switch scenarios with radio inputs', () => {
    const html = render(BARS);
    expect(count(html, /type="radio"/g)).toBe(2);
    expect(html).toMatch(/checked/);
    expect(count(html, /checked/g)).toBe(1);
    expect(html).toMatch(/class="ig-bar-range-base"/);
    expect(html).toMatch(/4,780 萬人次/);
    expect(html).toMatch(/虛線：現有容量（4,280 萬人次）/);
    expect(html).toContain('6,000–7,000 萬人次');
    // The scale is the largest value (8,380) times 1.15; the range starts at 6,000.
    expect(html).toContain('left:62.26%;width:10.377%');
    expect(html).toContain('class="ig-bar-fill is-highlight"');
  });

  it('bars without scenarios draw one panel and no tabs', () => {
    const html = render(`:::bars{unit="%" max="100"}\n- 甲｜40\n- 乙｜60｜備註\n:::`);
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('width:40%');
    expect(html).toContain('<span class="ig-bar-note">備註</span>');
    expect(html).toContain('40 %');
  });

  it('parts reports shares', () => {
    const html = render(`:::parts{unit="公頃" palette="diverging"}
- 軍方｜124
- **民航局**｜89
:::`);
    expect(html).toMatch(/data-palette="diverging"/);
    expect(html).toMatch(/flex-grow:89/);
    expect(html).toMatch(/（41.78%）/);
    expect(html).toContain('ig-part ig-part-1 is-highlight');
  });

  it('timeline places spans and events on a shared axis', () => {
    const html = render(`::::timeline{from="2000" to="2040"}
:::lane{title="水湳"}
- 2004｜民航遷走
- 2004–2020｜轉型
:::
:::lane{title="松山" highlight}
- **2033**｜市府目標
:::
::::`);
    expect(html).toMatch(/class="ig-span" data-k="1" style="--ig-i:1;left:10%;width:calc\(50% - 10%\)"/);
    expect(html).toMatch(/class="ig-event is-highlight"[^>]*left:82.5%/);
    expect(html).toMatch(/class="ig-lane is-highlight"/);
    expect(html).toContain('<span class="ig-axis-tick" style="left:25%">2010</span>');
    expect(html).toContain('<li data-k="0" tabindex="0">');
  });

  it('line draws an svg path and a data table', () => {
    const html = render(`::::line{unit="萬人次"}
:::series{title="桃機旅客" highlight}
- 2019｜4,869
- 2025｜4,780｜疫後回升
:::
::::`);
    expect(html).toMatch(/<svg class="ig-line-svg"[^>]*viewBox="0 0 100 100"/);
    expect(html).toMatch(/<path d="M0.00,[\d.]+L100.00,[\d.]+"/);
    expect(html).toMatch(/<details class="ig-data">/);
    expect(html).toMatch(/疫後回升/);
    // Nice ticks: 0 to 6,000 in steps of 2,000, and an end label plus a legend entry per series.
    expect(html).toContain('<span class="ig-y-tick" style="top:0%">6,000</span>');
    expect(html).toContain('<span class="ig-series-label ig-series-0 is-highlight"');
    expect(html).toContain('<th>數值（萬人次）</th>');
    expect(html).toContain('ig-line-legend');
  });

  it('line keeps point labels off each other and off the end labels', () => {
    const html = render(`::::line{unit="萬"}
:::series{title="甲"}
- 2020｜10
- 2022｜30｜高點
- 2024｜20｜甲末
:::
:::series{title="乙"}
- 2020｜12
- 2022｜26｜乙高
- 2024｜19｜乙末
:::
::::`);
    const point = (note: string) => html.match(new RegExp(`<span class="(ig-point[^"]*)"[^>]*><span class="ig-point-label"><span class="ig-point-note">${note}</span>(.*?)</span></span>`));
    // Close points take turns: the topmost above, the other below.
    expect(point('高點')?.[1]).not.toContain('is-below');
    expect(point('乙高')?.[1]).toContain('is-below');
    // The last point shows its note only, because its value is the end label's.
    expect(point('甲末')?.[2]).toBe('');
    expect(point('乙末')?.[1]).toContain('is-below');
  });

  it('line puts a local minimum label out of the line, on one row when the room is short', () => {
    const html = render(`::::line
:::series{title="甲"}
- 2015｜2950
- 2019｜4860
- 2021｜800｜疫情
- 2025｜4780
:::
:::series{title="乙"}
- 2015｜600
- 2019｜700
- 2021｜200
- 2025｜560
:::
::::`);
    expect(html).toMatch(/class="ig-point ig-series-0 is-labeled is-below is-inline"/);
  });

  it('line keeps a long note on an early point on two rows, centred, rather than one row hanging out of the figure', () => {
    const early = `::::line
:::series{title="實際" highlight}
- 2019｜4,869
- 2022｜1,100｜邊境重新開放
- 2025｜4,780
:::
:::series{title="預測" dashed}
- 2025｜4,780
- 2045｜8,380
:::
::::`;
    const point = (html: string) => html.match(/<span class="(ig-point[^"]*)"[^>]*><span class="ig-point-label"><span class="ig-point-note">邊境重新開放/)?.[1];
    expect(point(render(early))).toContain('is-labeled');
    expect(point(render(early))).not.toContain('is-inline');
    // The same note on a later point has the room, and keeps its one row when that avoids the line.
    const late = early.replace('- 2022｜1,100｜邊境重新開放', '- 2022｜1,100').replace('- 2025｜4,780\n:::\n:::series', '- 2025｜4,780｜邊境重新開放\n:::\n:::series');
    expect(point(render(late))).toContain('is-labeled');
  });

  it('timeline anchors the first and last axis labels inward', () => {
    const html = render(`::::timeline{from="2000" to="2040"}\n:::lane{title="L"}\n- 2004｜甲\n:::\n::::`);
    expect(html).toContain('<span class="ig-axis-tick is-start" style="left:0%">2000</span>');
    expect(html).toContain('<span class="ig-axis-tick is-end" style="left:100%">2040</span>');
    expect(html).toContain('<span class="ig-axis-tick" style="left:50%">2020</span>');
  });

  it('status-board groups by status', () => {
    const html = render(`::::status-board
:::group{status="done" title="有書面規劃"}
- 土地｜分區與路網
:::
:::group{status="none" title="沒有做法"}
- 經費
:::
::::`);
    expect(html).toMatch(/ig-status-group is-done/);
    expect(html).toMatch(/ig-status-group is-none/);
    expect(html).toContain('<span class="ig-status-count">1 項</span>');
    expect(html).toContain('<span class="ig-status-item-detail">分區與路網</span>');
  });

  it('map projects points and draws routes between listed points', () => {
    const html = render(`:::map{base="taiwan"}
- **松山**｜25.069, 121.552
- 金門｜24.43, 118.37
- 松山 → 金門｜國內線
:::`);
    expect(html).toMatch(/ig-map ig-map-taiwan/);
    expect(html).toMatch(/class="ig-map-point is-highlight is-left"/);
    expect(html).toMatch(/<path d="M[\d.]+,[\d.]+Q/);
    expect(html).toMatch(/pathLength="1"/);
    expect(html).toContain('style="aspect-ratio:800/984"');
    expect(html).toContain('ig-legend-item is-route');
  });

  it('the taipei base adds the focus layer', () => {
    const html = render(`:::map{base="taipei"}\n- 松山機場｜25.0697, 121.5524\n:::`);
    expect(html).toContain('ig-map-layer ig-map-focus');
    expect(html).toContain('aspect-ratio:800/917');
  });

  it('unknown palettes and map bases fail', () => {
    expect(() => render(`:::bars{palette="neon"}\n- a｜1\n:::`)).toThrow(/unknown palette/);
    expect(() => render(`:::map{base="mars"}\n- a｜1, 2\n:::`)).toThrow(/unknown map base/);
    expect(() => render(`:::map{base="mars"}\n- a｜1, 2\n:::`)).toThrow(InfographicError);
  });
});

describe('renderInfographic (beyond the blog test file)', () => {
  it('writes the caption lines in the blog wording', () => {
    const html = render(`:::parts{subtitle="副標" note="僅供參考" source="內政部"}\n- 甲｜1\n:::`);
    expect(html).toContain('<p class="ig-subtitle">副標</p>');
    expect(html).toContain('<figcaption class="ig-caption"><p>說明：僅供參考</p><p>資料來源：內政部</p></figcaption>');
  });

  it('renders each field as inline Markdown and escapes attribute text', () => {
    const html = render(`:::key-numbers{title="<b>x</b>"}\n- *強調*｜[連結](https://example.com)｜\`a｜b\`\n:::`);
    expect(html).toContain('<em>強調</em>');
    expect(html).toContain('<a href="https://example.com">連結</a>');
    expect(html).toContain('<code>a｜b</code>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('reads two numbers in 2000,2010 and one in 4,780', () => {
    const html = render(`::::timeline{from="2000" to="2020"}\n:::lane{title="L"}\n- 2000,2010｜兩年\n:::\n::::`);
    expect(html).toContain('class="ig-span"');
    expect(html).toContain('left:0%;width:calc(50% - 0%)');
  });

  it('a scenario takes the bars reference unless it sets its own', () => {
    const html = render(`::::bars{reference="10" reference-label="基線"}\n:::scenario{label="A" reference="20" reference-label="自訂"}\n- x｜5\n:::\n:::scenario{label="B"}\n- y｜5\n:::\n::::`);
    expect(html).toContain('虛線：自訂（20）');
    expect(html).toContain('虛線：基線（10）');
  });

  it('ignores rows beside child containers and containers of other names', () => {
    const html = render(`::::status-board\n- stray\n:::group{status="done" title="G"}\n- a\n:::\n:::other\n- b\n:::\n::::`);
    expect(html).toContain('ig-status-group is-done');
    expect(html).not.toContain('stray');
    expect(html).not.toContain('>b<');
  });

  it('keeps radio names and ids unique across figures', () => {
    const names = [render(BARS), render(BARS)].map(html => /name="([^"]+)"/.exec(html)?.[1]);
    expect(names[0]).toBeTruthy();
    expect(names[0]).not.toBe(names[1]);
    const first = render(BARS);
    for (const [, id] of first.matchAll(/id="([^"]+)"/g)) expect(first.match(new RegExp(`for="${id}"`))).toBeTruthy();
  });

  it('accepts the blog section palettes without data-palette, and the data palettes with it', () => {
    for (const palette of ['current-affairs', 'technology', 'popular-philosophy', 'trpg', 'academic']) expect(render(`:::parts{palette="${palette}"}\n- a｜1\n:::`)).not.toContain('data-palette');
    for (const palette of ['categorical', 'diverging', 'sequential']) expect(render(`:::parts{palette="${palette}"}\n- a｜1\n:::`)).toContain(`data-palette="${palette}"`);
  });

  it.each([['unknown status', `::::status-board\n:::group{status="maybe" title="G"}\n- a\n:::\n::::`, /unknown status-board status "maybe"/], ['status-board without groups', `:::status-board\n- a\n:::`, /needs :::group children/], ['timeline without lanes', `:::timeline\n- 2000｜a\n:::`, /needs :::lane children/], ['timeline without a range', `::::timeline\n:::lane{title="L"}\n- 2000｜a\n:::\n::::`, /needs to > from/], ['line without series', `:::line\n- 2000｜1\n:::`, /needs :::series children/], ['line without data', `::::line\n:::series{title="S"}\n- x｜y\n:::\n::::`, /no data points/], ['line without a range', `::::line\n:::series{title="S"}\n- 2000｜1\n:::\n::::`, /non-empty range/], ['more than six scenarios', `::::bars\n${[1, 2, 3, 4, 5, 6, 7].map(n => `:::scenario{label="${n}"}\n- a｜1\n:::`).join('\n')}\n::::`, /at most 6 scenarios/], ['a route naming an unlisted point', `:::map\n- 甲｜25, 121\n- 甲 → 乙\n:::`, /names a point that is not listed/]])('fails on %s', (_name, source, message) => {
    expect(() => render(source)).toThrow(message);
  });

  it('accepts six scenarios', () => {
    expect(count(render(`::::bars\n${[1, 2, 3, 4, 5, 6].map(n => `:::scenario{label="${n}"}\n- a｜1\n:::`).join('\n')}\n::::`), /type="radio"/g)).toBe(6);
  });
});

describe('transformDirectives with infographics', () => {
  const body = (md: string) => marked.parse(md) as string;
  const inline = (md: string) => marked.parseInline(md) as string;

  it('renders a figure in place and leaves its children untransformed', () => {
    const output = transformDirectives(`before\n\n${BARS}\n\nafter`, body, inline);
    expect(output).toContain('<figure class="ig-figure ig-bars">');
    expect(output).not.toContain(':::scenario');
    expect(output).not.toContain('custom-directive');
    expect(output.startsWith('before')).toBe(true);
    expect(output.endsWith('after')).toBe(true);
    // One HTML block: no blank line inside the figure.
    const figure = output.slice(output.indexOf('<figure'), output.indexOf('</figure>'));
    expect(figure).not.toMatch(/\n\s*\n/);
  });

  it('renders a figure inside another container', () => {
    const output = transformDirectives(`:::info{title="T"}\n:::parts\n- a｜1\n:::\n:::`, body, inline);
    expect(output).toContain('custom-directive info-directive');
    expect(output).toContain('ig-figure ig-parts');
  });

  it('keeps scenario, series, lane and group outside an infographic as generic directives', () => {
    for (const name of ['scenario', 'series', 'lane', 'group']) {
      const output = transformDirectives(`:::${name}{title="T"}\ntext\n:::`, body, inline);
      expect(output).toContain('generic-directive');
      expect(output).toContain(`data-type="${name}"`);
      expect(output).not.toContain('ig-');
    }
  });

  it('shows the error box with the message and the source', () => {
    const output = transformDirectives(`:::bars{palette="neon"}\n- a｜1\n\n- b｜2\n:::\n\nafter`, body, inline);
    expect(output).toContain('<div class="ig-error" role="alert">');
    expect(output).toContain('unknown palette &quot;neon&quot;');
    expect(output).toContain('This infographic could not be drawn');
    // The source's blank line does not end the HTML block.
    const box = output.slice(output.indexOf('<div class="ig-error"'), output.indexOf('</pre>'));
    expect(box).not.toMatch(/\n\s*\n/);
  });

  it('leaves an unclosed infographic as text, as for other containers', () => {
    const output = transformDirectives(`:::parts\n- a｜1`, body, inline);
    expect(output).not.toContain('ig-figure');
    expect(output).toContain(':::parts');
  });

  it('reads a figure written inside a blockquote', () => {
    const output = transformDirectives(`> :::parts\n> - a｜1\n> :::`, body, inline);
    expect(output).toContain('ig-figure ig-parts');
  });
});

describe('sanitised output (renderNote under DOMPurify)', () => {
  const { window } = new JSDOM('');
  const renderer = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example' });
  const dom = (markdown: string) => new JSDOM(`<body>${renderer.renderNote(markdown, 'n.md')}</body>`).window.document;

  it('keeps scenario radios, labels and their pairing', () => {
    const document = dom(BARS);
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    expect(radios[0].checked).toBe(true);
    for (const radio of radios) expect(document.querySelector(`label[for="${radio.id}"]`)).not.toBeNull();
  });

  it('keeps the bar geometry, data attributes and style', () => {
    const document = dom(`:::parts{palette="sequential"}\n- a｜1\n- **b**｜3\n:::`);
    expect(document.querySelector('figure.ig-parts')?.getAttribute('data-palette')).toBe('sequential');
    expect(document.querySelector('.ig-part-1')?.getAttribute('style')).toBe('--ig-i:1;flex-grow:3');
  });

  it('keeps the timeline marks, tab stops and data-k', () => {
    const document = dom(`::::timeline{from="2000" to="2040"}\n:::lane{title="L"}\n- 2004–2020｜轉型\n:::\n::::`);
    expect(document.querySelector('.ig-span')?.getAttribute('style')).toContain('width:calc(');
    expect(document.querySelector('.ig-span')?.getAttribute('data-k')).toBe('0');
    expect(document.querySelector('.ig-lane-events li')?.getAttribute('tabindex')).toBe('0');
  });

  it('keeps the line chart svg, paths, grid lines, points and the data table unwrapped', () => {
    const document = dom(`::::line\n:::series{title="S"}\n- 2019｜10\n- 2025｜20｜註\n:::\n::::`);
    const svg = document.querySelector('svg.ig-line-svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelectorAll('line.ig-grid').length).toBeGreaterThan(1);
    expect(svg?.querySelector('line.ig-grid')?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(svg?.querySelector('path.ig-line-path')?.getAttribute('d')).toMatch(/^M0\.00,/);
    expect(svg?.querySelector('path.ig-line-path')?.getAttribute('data-s')).toBe('0');
    expect(document.querySelector('.ig-point')?.getAttribute('tabindex')).toBe('0');
    expect(document.querySelector('details.ig-data table')).not.toBeNull();
    expect(document.querySelector('.markdown-table-scroll')).toBeNull();
  });

  it('keeps the map layers, routes with pathLength and the aspect ratio', () => {
    const document = dom(`:::map\n- 甲｜25, 121\n- 乙｜24, 120\n- 甲 → 乙\n:::`);
    expect(document.querySelector('.ig-map-frame > .ig-map')?.getAttribute('style')).toBe('aspect-ratio:800/984');
    expect(document.querySelectorAll('.ig-map-layer')).toHaveLength(2);
    const route = document.querySelector('svg.ig-map-routes path.ig-route');
    expect(route?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+Q/);
    expect(route?.getAttribute('pathlength') ?? route?.getAttribute('pathLength')).toBe('1');
    expect(document.querySelector('.ig-map-routes')?.getAttribute('viewBox')).toBe('0 0 800 984');
  });

  it('keeps the key-numbers, status-board and error markup', () => {
    expect(dom(`:::key-numbers\n- 1｜a\n:::`).querySelector('dl.ig-numbers > div.ig-number > dt.ig-number-label')).not.toBeNull();
    expect(dom(`::::status-board\n:::group{status="done" title="G"}\n- a｜b\n:::\n::::`).querySelector('section.ig-status-group.is-done .ig-status-count')?.textContent).toBe('1 項');
    const error = dom(`:::bars{palette="neon"}\n- a｜1\n\n- b｜2\n:::`).querySelector('.ig-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.querySelector('pre')?.textContent).toBe(':::bars{palette="neon"}\n- a｜1\n\n- b｜2\n:::');
  });

  it('strips script and handlers smuggled through a field, an attribute or the error source', () => {
    const document = dom(`:::key-numbers{title="<img src=x onerror=alert(1)>"}\n- <img src=x onerror=alert(1)>｜<script>alert(1)</script>\n:::\n\n:::bars{palette="<script>x</script>"}\n- a｜1\n:::`);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.querySelector('.ig-error pre')?.textContent).toContain('<script>');
  });

  it('draws two figures of one note with distinct radio groups', () => {
    const document = dom(`${BARS}\n\n${BARS}`);
    const names = new Set([...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(radio => radio.name));
    expect(names.size).toBe(2);
  });
});
