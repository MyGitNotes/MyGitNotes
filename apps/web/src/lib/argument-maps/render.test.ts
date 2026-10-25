// @vitest-environment node
import { readFileSync } from 'node:fs';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../directives.js';
import { createNoteRenderer } from '../markdown.js';
import { ArgumentMapError, renderArgumentMap } from './render.js';

// The cases of the blog's scripts/test-argument-maps.mjs (wayne930242/knowledge-base at e9cbe4b7), adapted: the same
// fixtures, documents and assertions on the figure HTML, here from renderArgumentMap instead of the remark plugin.
// Error messages lose the blog's "Argument map: " prefix, which the app's error box says in its heading.
const marked = new Marked();
const inline = (field: string) => marked.parseInline(field, { gfm: true }) as string;
const render = (source: string) => renderArgumentMap(source.endsWith('\n') ? source : `${source}\n`, { renderInline: inline, language: 'zh-TW' });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8');
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

/** A small valid map; each error case below breaks one thing in it. */
const MAP = `::::argument-map{title="T"}
- [C] 結論｜1

:::reason{to="C" id="R1"}
- [P] 前提｜2
:::

:::objection{to="P" id="O1"}
- 反駁｜3
:::
::::`;

describe('renderArgumentMap (the blog plugin cases)', () => {
  it('hills renders the map view: tree, relations, collapse markup', () => {
    const html = render(fixture('hills2009'));
    expect(html).toMatch(/<figure class="am-figure" id="am-\d+">/);
    expect(html).toContain('<p class="am-title">Hills：道德證言與道德理解</p>');
    expect(html).toMatch(/出處：Hills 2009, <em>Ethics<\/em> 120\(1\): 94–127/);
    // The main conclusion card, then one <details open> per argument.
    expect(html).toMatch(/<div class="am-st am-root"><span class="am-id">C<\/span>/);
    expect(count(html, /<details class="am-details" open>/g)).toBe(11);
    expect(count(html, /<li class="am-arg am-support">/g)).toBe(6);
    expect(count(html, /<li class="am-arg am-rebut">/g)).toBe(3);
    expect(count(html, /<li class="am-arg am-undercut">/g)).toBe(2);
    // The relation is text: badge, target, label, argument id.
    expect(html).toContain('<summary class="am-rel"><span class="am-badge">支持</span><span class="am-target">C</span><span class="am-argid">R1</span><span class="am-count">已收合 16 條命題</span></summary>');
    expect(html).toContain('<span class="am-badge">支持</span><span class="am-target">V</span><span class="am-label">無能法官 Claire</span>');
    // An objection to an argument id undercuts the step, not a statement.
    expect(html).toContain('<span class="am-badge">削弱</span><span class="am-target">R1 的推論</span><span class="am-argid">O2</span>');
    // Rows that target a statement hang under the argument holding that row.
    expect(html).toContain('<span class="am-badge">反駁</span><span class="am-target">O1a</span>');
    // map is the default view.
    expect(html).toMatch(/class="am-input am-input-map"[^>]*checked/);
    expect(html).not.toMatch(/am-input-standard"[^>]*checked/);
  });

  it('a citation inside a source field reads as it does anywhere in a note', () => {
    const html = render(fixture('hills2009'));
    expect(html).toContain('<span class="am-src">[@zagzebski2012epistemic], 176–178</span>');
  });

  it('hills standard view numbers statements once and heads undercuts', () => {
    const html = render(fixture('hills2009'));
    const standard = html.slice(html.indexOf('class="am-panel am-panel-standard"'));
    // The main conclusion is (1) and heads its own block.
    expect(standard).toMatch(/主結論<\/p><p class="am-sf-conclusion"><span class="am-sf-n">\(1\)<\/span>/);
    // R1's rows are (2)(3)(4); its conclusion points back to (1).
    expect(standard).toMatch(/<p class="am-sf-head">R1<\/p><ol class="am-sf-rows"><li class="am-sf-row"><span class="am-sf-n">\(2\)<\/span>.*?<span class="am-sf-n">\(3\)<\/span>.*?<span class="am-sf-n">\(4\)<\/span>/);
    expect(standard).toMatch(/<div class="am-sf-rule"><span class="am-sr">因此<\/span><\/div><p class="am-sf-conclusion"><span class="am-sf-n">\(1\)<\/span>/);
    // Rebut head names the number it attacks; undercut head names the step.
    expect(standard).toMatch(/<p class="am-sf-head">反駁 \(\d+\)<\/p>/);
    expect(standard).toMatch(/削弱 R1 的推論：\(2\)\(3\)\(4\) ⟹ \(1\)/);
    // O2's own undercut targets O2, an argument whose target is (1)'s step R1.
    expect(standard).toMatch(/削弱 O2 的推論：\(\d+\) ⟹ 削弱 R1/);
    // No statement is numbered twice.
    const numbers = [...standard.matchAll(/<li class="am-sf-row"><span class="am-sf-n">\((\d+)\)/g)].map(m => m[1]);
    expect(new Set(numbers).size).toBe(numbers.length);
    // Headings stay out of the page outline.
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it('bradford shows the implicit premise as a dashed, tagged row', () => {
    const html = render(fixture('bradford2013'));
    expect(html).toContain('<div class="am-st am-implicit"><span class="am-tag">隱含前提</span><span class="am-text">在不必要時仍被選擇的活動，本身值得選擇</span><span class="am-src">212</span></div>');
    // The implicit row is also tagged in the standard form.
    expect(html).toMatch(/<li class="am-sf-row"><span class="am-sf-n">\(4\)<\/span><span class="am-tag">隱含前提<\/span>/);
    // Undercut of an undercut reads 「削弱 R4」 on the right of the arrow.
    expect(html).toMatch(/削弱 O1 的推論：\(10\) ⟹ 削弱 R4/);
    expect(html).toMatch(/削弱 R3 的推論：\(5\)\(6\) ⟹ \(2\)/);
    expect(count(html, /<li class="am-sf-row">/g)).toBe(17);
  });

  it('zagzebski opens on the standard view', () => {
    const html = render(fixture('zagzebski2012'));
    expect(html).toMatch(/class="am-input am-input-standard"[^>]*checked/);
    expect(html).not.toMatch(/am-input-map"[^>]*checked/);
    expect(html).toMatch(/<label class="am-tab am-tab-standard" for="am-\d+-standard">標準形式<\/label>/);
    expect(html).toMatch(/<label class="am-tab am-tab-map" for="am-\d+-map">論證圖<\/label>/);
    expect(html).toMatch(/削弱 R1 的推論：\(2\)\(3\)\(4\) ⟹ \(1\)/);
    expect(html).toContain('<span class="am-badge">反駁</span><span class="am-target">C</span>');
  });

  it('two maps on one page get unique figure, input and label ids', () => {
    const html = `${render(fixture('hills2009'))}\n${render(fixture('zagzebski2012'))}`;
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    const [first, second] = [ids[0], ids[3]];
    expect(ids).toEqual([first, `${first}-map`, `${first}-standard`, second, `${second}-map`, `${second}-standard`]);
    // Each label points at an input of its own figure.
    expect(count(html, new RegExp(`for="${second}-map"`, 'g'))).toBe(1);
    expect(count(html, new RegExp(`name="${first}-view"`, 'g'))).toBe(2);
    expect(count(html, new RegExp(`name="${second}-view"`, 'g'))).toBe(2);
  });

  it('rendering the same map again gives it new ids, as two live-editor blocks of one note need', () => {
    const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
    const first = ids(render(MAP));
    const second = ids(render(MAP));
    expect(first.filter(id => second.includes(id))).toEqual([]);
  });

  it('status shows a tag on the summary and the standard head', () => {
    const html = render(MAP.replace('id="R1"', 'id="R1" status="accepted"').replace('id="O1"', 'id="O1" status="rejected" label="*質疑*"'));
    expect(html).toContain('<span class="am-status am-status-accepted">✓ 接受</span>');
    expect(html).toContain('<span class="am-status am-status-rejected">✗ 不接受</span>');
    expect(html).toContain('<span class="am-label"><em>質疑</em></span>');
    expect(count(html, /am-status-accepted/g)).toBe(2);
    expect(render(MAP)).not.toContain('am-status');
  });

  it('a row wholly in ** is a key statement', () => {
    const html = render(`::::argument-map\n- [C] **結論**｜1\n::::`);
    expect(html).toContain('<div class="am-st am-key am-root">');
    expect(html).toContain('<span class="am-text">結論</span>');
  });

  it('a row with two bold spans is not a key statement, and one with two emphases is not implicit', () => {
    const html = render(`::::argument-map\n- [C] **甲** 與 **乙**\n\n:::reason{to="C"}\n- _甲_ 與 _乙_\n:::\n::::`);
    expect(html).not.toContain('am-key');
    expect(html).not.toContain('am-implicit');
  });

  it('a main conclusion with no arguments renders on its own', () => {
    const html = render(`::::argument-map{title="孤立"}\n- 只有結論\n::::`);
    expect(html).toContain('<div class="am-st am-root">');
    expect(html).not.toContain('<ul class="am-kids">');
  });

  it('the sample map renders', () => {
    expect(render(MAP)).toContain('<span class="am-badge">反駁</span><span class="am-target">P</span>');
  });

  it('the example in the blog DIRECTIVES_USAGE.md renders', () => {
    const html = render(`::::argument-map{title="要不要帶傘" source="自擬"}
- [C] 今天應該帶傘

:::reason{to="C" id="R1"}
- [W] 預報說下午有雨
- _帶傘的成本很低_
:::

:::objection{to="W" id="O1"}
- 預報常常不準
:::

:::objection{to="O1"}
- 這個預報來自氣象署，近三天都命中
:::
::::`);
    expect(html).toContain('<span class="am-badge">削弱</span><span class="am-target">O1 的推論</span>');
  });

  it('keeps inline markup, a ｜ inside code and a continued row line in their field', () => {
    const html = render(`::::argument-map\n- [C] 帶 \`a｜b\` 的 **粗** 結論｜p. 1\n\n:::reason{to="C"}\n- 第一行\n  接續行｜[連結](https://example.com)\n:::\n::::`);
    expect(html).toContain('<code>a｜b</code>');
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('第一行 接續行');
    expect(html).toContain('<a href="https://example.com">連結</a>');
  });

  it('does not take a link at the start of a row for an id', () => {
    const html = render(`::::argument-map\n- [連結](https://example.com) 開頭\n::::`);
    expect(html).toContain('<a href="https://example.com">連結</a>');
    expect(html).not.toContain('am-id');
  });

  it('reads a title, label and note as text with emphasis and links, never as HTML', () => {
    const html = render(`::::argument-map{title="a <b> & **c**" note="<i>n</i>"}\n- [C] 結論\n\n:::reason{to="C" label="<u>x</u>"}\n- y\n:::\n::::`);
    expect(html).toContain('<p class="am-title">a &lt;b&gt; &amp; <strong>c</strong></p>');
    expect(html).not.toMatch(/<(?:b|i|u)>/);
  });
});

const ERRORS: [string, string, RegExp][] = [
  ['no main conclusion', `::::argument-map\n:::reason{to="C"}\n- a\n:::\n::::`, /no main conclusion/],
  ['more than one main conclusion', `::::argument-map\n- [C] a\n- [D] b\n::::`, /exactly one main conclusion, found 2/],
  ['two lists outside containers', `::::argument-map\n- [C] a\n\ntext\n\n- [D] b\n::::`, /only one list/],
  ['unknown to', MAP.replace('to="P"', 'to="Z"'), /unknown id "Z"/],
  ['missing to', MAP.replace('{to="P" id="O1"}', '{id="O1"}'), /needs a to attribute/],
  ['duplicate id between statements', MAP.replace('- [P] 前提', '- [C] 前提'), /duplicate id "C"/],
  ['duplicate id between a statement and an argument', MAP.replace('id="R1"', 'id="P"'), /duplicate id "P"/],
  ['duplicate argument id', MAP.replace('id="O1"', 'id="R1"'), /duplicate id "R1"/],
  ['reason targeting an argument', MAP.replace(':::objection{to="P" id="O1"}', ':::reason{to="R1" id="O1"}'), /:::reason cannot target the argument "R1"/],
  ['container without rows', `::::argument-map\n- [C] a\n\n:::reason{to="C"}\n:::\n::::`, /has no statement rows/],
  ['container holding a paragraph', `::::argument-map\n- [C] a\n\n:::reason{to="C"}\n- b\n\n多餘的段落\n:::\n::::`, /only one list/],
  ['extra paragraph in the root', `::::argument-map\n- [C] a\n\n多餘的段落\n\n:::reason{to="C"}\n- b\n:::\n::::`, /only one list/],
  ['cycle: a reason supporting its own row', MAP.replace('to="C" id="R1"', 'to="P" id="R1"'), /not connected to the main conclusion.*cycle \(R1 → R1\)/],
  ['cycle between two arguments', `::::argument-map\n- [C] a\n\n:::objection{to="B" id="A"}\n- x\n:::\n\n:::objection{to="A" id="B"}\n- y\n:::\n::::`, /cycle/],
  ['unknown status', MAP.replace('id="R1"', 'id="R1" status="maybe"'), /unknown status "maybe"/],
  ['unknown view', MAP.replace('title="T"', 'title="T" view="graph"'), /unknown view "graph"/],
  ['unknown child container', MAP.replace(/\n::::$/, '\n\n:::note{to="C"}\n- n\n:::\n::::'), /unknown container ":::note"/],
  ['more than two fields', MAP.replace('前提｜2', '前提｜2｜3'), /at most two fields.*found 3/],
  ['a lone x id', MAP.replace('- [P] 前提｜2', '- [x] 前提｜2'), /lone "x" or "X"/],
  ['an invalid argument id', MAP.replace('id="R1"', 'id="1R"'), /id "1R" must match/],
  // Cases the blog's syntax tree decides and the app reads from lines.
  ['a nested list in a row', `::::argument-map\n- [C] a\n  - 巢狀\n::::`, /single line of text/],
  ['a second paragraph in a row', `::::argument-map\n- [C] a\n\n  第二段\n::::`, /single line of text/],
  ['an empty row', `::::argument-map\n- [C] \n::::`, /a row needs text/],
  ['a container inside a container', MAP.replace('- [P] 前提｜2', '- [P] 前提｜2\n\n:::objection{to="P"}\n- x\n:::'), /only one list/],
  ['an unclosed child container', `::::argument-map\n- [C] a\n\n:::reason{to="C"}\n- b\n::::`, /:::reason is not closed/],
];

describe('renderArgumentMap errors (the blog build failures)', () => {
  for (const [name, markdown, message] of ERRORS) {
    it(`error: ${name}`, () => {
      expect(() => render(markdown)).toThrow(ArgumentMapError);
      expect(() => render(markdown)).toThrow(message);
    });
  }
});

describe('transformDirectives', () => {
  const body = (source: string) => marked.parse(source, { gfm: true }) as string;

  it('draws the figure in place and leaves the rest of the note to Markdown', () => {
    const output = transformDirectives(`前文\n\n${MAP}\n\n後文`, body, inline);
    expect(output).toContain('<figure class="am-figure"');
    expect(output).toContain('前文');
    expect(output).toContain('後文');
    expect(output).not.toContain('::::argument-map');
  });

  it('shows an error box in the figure place and still renders the rest of the note', () => {
    const output = transformDirectives(`${MAP.replace('to="P"', 'to="Z"')}\n\n後文 :::reason`, body, inline);
    expect(output).toContain('<div class="am-error" role="alert">');
    expect(output).toContain('unknown id &quot;Z&quot;');
    expect(output).toContain('後文');
    expect(output).not.toContain('am-figure');
  });

  it('keeps the whole source, blank lines included, in the error box', () => {
    const output = transformDirectives(MAP.replace('to="P"', 'to="Z"'), body, inline);
    expect(output).toContain('&#10;&#10;');
    expect(output.split('\n').filter(line => !line.trim()).length).toBeLessThanOrEqual(2);
  });

  it('keeps reason and objection outside argument-map generic directives', () => {
    const output = transformDirectives(`:::reason{to="X"}\n- 一列\n:::\n\n:::objection\n- 另一列\n:::`, body, inline);
    expect(output).not.toContain('am-figure');
    expect(output).toContain('generic-directive');
    expect(output).toContain('一列');
    expect(output).toContain('另一列');
  });

  it('leaves an unclosed argument-map as text, as for other containers', () => {
    const output = transformDirectives(`::::argument-map\n- [C] a`, body, inline);
    expect(output).not.toContain('am-figure');
    expect(output).toContain('::::argument-map');
  });

  it('reads a figure written inside a blockquote', () => {
    const output = transformDirectives(`> ::::argument-map\n> - [C] a\n>\n> :::reason{to="C"}\n> - b\n> :::\n> ::::`, body, inline);
    expect(output).toContain('am-figure');
  });

  it('turns an unexpected failure into the error box too', () => {
    const output = transformDirectives(`::::argument-map\n- [C] a\n::::\n\nafter`, body, () => {
      throw new TypeError('inline renderer broke');
    });
    expect(output).toContain('<div class="am-error" role="alert">');
    expect(output).toContain('inline renderer broke');
    expect(output).toContain('after');
  });
});

describe('sanitised output (renderNote under DOMPurify)', () => {
  const { window } = new JSDOM('');
  const renderer = createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example', language: 'zh-TW' });
  const dom = (markdown: string) => new JSDOM(`<body>${renderer.renderNote(markdown, 'n.md')}</body>`).window.document;

  it('keeps the figure and its id', () => {
    const figure = dom(MAP).querySelector('figure.am-figure');
    expect(figure?.id).toMatch(/^am-\d+$/);
  });

  it('keeps the view radios: type, shared name, ids and the checked default', () => {
    const document = dom(`${MAP.replace('title="T"', 'title="T" view="standard"')}`);
    const radios = [...document.querySelectorAll<HTMLInputElement>('input.am-input')];
    expect(radios.map(radio => radio.type)).toEqual(['radio', 'radio']);
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    expect(radios[0].name).toBe(`${document.querySelector('figure')!.id}-view`);
    expect(radios.map(radio => radio.checked)).toEqual([false, true]);
    expect(radios.map(radio => radio.id)).toEqual([`${radios[0].name.replace('-view', '')}-map`, `${radios[0].name.replace('-view', '')}-standard`]);
  });

  it('keeps each tab label paired with its radio through for', () => {
    const document = dom(MAP);
    const labels = [...document.querySelectorAll<HTMLLabelElement>('label.am-tab')];
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(document.getElementById(label.htmlFor)?.tagName).toBe('INPUT');
  });

  it('keeps details open and the summary line', () => {
    const document = dom(MAP);
    const details = [...document.querySelectorAll('details.am-details')];
    expect(details).toHaveLength(2);
    for (const element of details) {
      expect(element.hasAttribute('open')).toBe(true);
      expect(element.querySelector(':scope > summary.am-rel > .am-badge')).not.toBeNull();
    }
  });

  it('keeps the tree lists, boxes and statement cards', () => {
    const document = dom(MAP);
    expect(document.querySelector('.am-outline > .am-st.am-root')).not.toBeNull();
    expect(document.querySelector('.am-outline > ul.am-kids > li.am-arg.am-support > details > .am-box > .am-st')).not.toBeNull();
    expect(document.querySelector('ol.am-sf-rows > li.am-sf-row > .am-sf-n')?.textContent).toBe('(2)');
  });

  it('keeps the figure caption, notes and the error box with its role', () => {
    const document = dom(`${MAP.replace('title="T"', 'title="T" subtitle="S" note="N" source="X"')}\n\n${MAP.replace('to="P"', 'to="Z"')}`);
    expect(document.querySelector('figcaption.am-caption > p.am-title')?.textContent).toBe('T');
    expect(document.querySelector('.am-notes')?.textContent).toBe('說明：N出處：X');
    const error = document.querySelector('.am-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.querySelector('pre')?.textContent).toContain('to="Z"');
  });

  it('strips script and handlers smuggled through a title, a row or the error source', () => {
    const document = dom(`::::argument-map{title="<img src=x onerror=alert(1)>"}\n- [C] <script>alert(1)</script><img src=x onerror=alert(1)>\n::::\n\n::::argument-map{view="<script>x</script>"}\n- [C] a\n::::`);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.querySelector('.am-error pre')?.textContent).toContain('<script>');
  });

  it('does not let a note id or name reach the page through an argument id', () => {
    const document = dom(MAP.replace('id="R1"', 'id="cookie"'));
    expect(document.querySelector('figure')?.id).toMatch(/^am-\d+$/);
  });

  it('draws two figures of one note with distinct radio groups and ids', () => {
    const document = dom(`${MAP}\n\n${MAP}`);
    const names = new Set([...document.querySelectorAll<HTMLInputElement>('input.am-input')].map(radio => radio.name));
    expect(names.size).toBe(2);
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('renderArgumentMap in English', () => {
  const english = (source: string) => renderArgumentMap(`${source}\n`, { renderInline: inline, language: 'en' });
  const FULL = `::::argument-map{title="T" note="N" source="X"}
- [C] Conclusion｜1

:::reason{to="C" id="R1" status="accepted"}
- [P] Premise｜2
- (implicit) Hidden｜3
:::

:::objection{to="P" id="O1" status="rejected"}
- Rebuttal｜4
:::

:::objection{to="R1" id="U1" status="open"}
- Undercutter｜5
:::
::::`;

  it('words the relations, statuses, counts and tabs in English', () => {
    const html = english(FULL);
    expect(html).toContain('<span class="am-badge">Supports</span>');
    expect(html).toContain('<span class="am-badge">Rebuts</span>');
    expect(html).toContain('<span class="am-badge">Undercuts</span><span class="am-target">inference R1</span>');
    expect(html).toContain('✓ Accepted');
    expect(html).toContain('✗ Rejected');
    expect(html).toContain('? Undecided');
    expect(html).toContain('statements collapsed');
    expect(html).toContain('Argument map</label>');
    expect(html).toContain('Standard form</label>');
    expect(html).toContain('Main conclusion');
    expect(html).toContain('Therefore');
    expect(html).toContain('Rebuts (');
    expect(html).toContain('Undercuts the inference R1:');
    expect(html).toContain('<p>Note: N</p><p>Source: X</p>');
  });

  it('leaves no Chinese wording of its own', () => {
    expect(english(FULL)).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
