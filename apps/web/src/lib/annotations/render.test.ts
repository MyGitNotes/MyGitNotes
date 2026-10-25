// @vitest-environment node
import { readFileSync } from 'node:fs';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en.js';
import { zhTW } from '../i18n/zh-TW.js';
import { transformDirectives } from '../directives.js';
import { createNoteRenderer } from '../markdown.js';
import { AnnotateError, renderAnnotate } from './render.js';

const marked = new Marked();
const renderMarkdown = (markdown: string) => marked.parse(markdown, { gfm: true, breaks: true }) as string;
const render = (source: string, strings = en) => renderAnnotate(source, { renderMarkdown, strings });
const fixture = readFileSync(new URL('./fixtures/review.md', import.meta.url), 'utf8').replace(/\n$/, '');
const dom = (html: string) => new JSDOM(`<body>${html}</body>`).window.document;
const IMG = '![a](a.png)';

describe('renderAnnotate: the figure contract', () => {
  const html = render(fixture);
  const document = dom(html);

  it('is one line of HTML, so it survives inside a Markdown document', () => {
    expect(html).not.toContain('\n');
  });

  it('writes a figure with the data-type and a unique id', () => {
    const figure = document.querySelector('figure.ann-figure')!;
    expect(figure.getAttribute('data-type')).toBe('annotate');
    expect(figure.id).toMatch(/^ann-\d+$/);
    expect(render(fixture)).not.toBe(html);
  });

  it('puts the title, the counts and the open-image link in the caption', () => {
    const caption = document.querySelector('figcaption.ann-caption')!;
    expect(caption.querySelector('.ann-title')!.textContent).toBe('首頁 v3 設計審閱');
    expect(caption.querySelector('.ann-counts')!.textContent).toBe('2 open · 1 resolved');
    expect(caption.querySelectorAll('a')).toHaveLength(1);
    expect(caption.querySelector('a.ann-open')!.getAttribute('href')).toBe('/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b');
  });

  it('puts the image in a stage with an overlay that carries percentages as attributes', () => {
    const stage = document.querySelector('.ann-stage')!;
    expect(stage.querySelector('img')!.getAttribute('alt')).toBe('首頁 v3');
    expect(stage.querySelector('svg.ann-overlay')!.getAttribute('aria-label')).toBe('Annotations on 首頁 v3');
    const pin = stage.querySelector('.ann-marker.ann-pin.ann-n-1 > svg')!;
    expect(pin.getAttribute('x')).toBe('41.2%');
    expect(pin.getAttribute('y')).toBe('23.3%');
    const rect = stage.querySelector('.ann-marker.ann-region.ann-n-2 rect')!;
    expect(['x', 'y', 'width', 'height', 'rx'].map(name => rect.getAttribute(name))).toEqual(['8%', '61.5%', '35%', '12%', '3']);
    expect(stage.querySelector('.ann-region .ann-badge')!.getAttribute('x')).toBe('8%');
  });

  it('draws regions under pins', () => {
    const order = [...document.querySelectorAll('.ann-overlay > a')].map(marker => marker.getAttribute('class') ?? '');
    expect(order.map(name => /ann-region/.test(name) ? 'region' : 'pin')).toEqual(['region', 'pin', 'pin']);
  });

  it('labels each marker with its number, kind and state, and links it to its list item', () => {
    const marker = document.getElementById(`${document.querySelector('figure')!.id}-1-m`);
    expect(marker?.getAttribute('aria-label')).toBe('1, pin, open');
    expect(marker?.getAttribute('href')).toBe(`#${document.querySelector('figure')!.id}-1`);
    expect(marker?.querySelector('title')!.textContent).toBe('1 · Logo 太小，和導覽列的基線沒有對齊。');
    expect(document.querySelector('.ann-marker.ann-n-3')!.getAttribute('aria-label')).toBe('3, pin, resolved');
  });

  it('lists open annotations in source order and resolved ones in a closed details', () => {
    const open = [...document.querySelectorAll('.ann-side > .ann-list > .ann-item')];
    expect(open.map(item => item.querySelector('.ann-ref')!.textContent)).toEqual(['1', '2']);
    expect(document.querySelector('.ann-side > .ann-list')!.getAttribute('aria-label')).toBe('Open annotations');
    const details = document.querySelector('details.ann-resolved')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Resolved (1)');
    const item = details.querySelector('.ann-item')!;
    expect(item.classList.contains('is-resolved')).toBe(true);
    expect(item.querySelector('.ann-state')!.textContent).toBe('✓ Resolved');
    expect(item.querySelector('.ann-by')!.textContent).toBe('bob');
    expect(document.querySelector('.ann-marker.ann-n-3')!.classList.contains('is-resolved') || document.querySelector('.ann-marker.ann-n-3')!.getAttribute('class')).toBeTruthy();
  });

  it('links each number in the list back to its marker, and states kind as text', () => {
    const figure = document.querySelector('figure')!.id;
    const item = document.querySelector(`#${figure}-2`)!;
    expect(item.querySelector('a.ann-ref')!.getAttribute('href')).toBe(`#${figure}-2-m`);
    expect(item.querySelector('.ann-kind')!.textContent).toBe('Region');
    expect(item.querySelector('.ann-by')!.textContent).toBe('alice');
  });

  it('renders the comment as Markdown, continuation lines included', () => {
    const comment = document.querySelector('.ann-n-2.ann-item .ann-comment')!;
    expect(comment.textContent).toContain('CTA 對比不足，改用主色。');
    expect(comment.textContent).toContain('hover 狀態也一起看。');
    expect(render(':::annotate\n' + IMG + '\n\n- {#1 pin x=1% y=1%} **bold** and `code`\n:::')).toContain('<strong>bold</strong>');
  });

  it('keeps blank lines and code blocks of a comment inside one line of HTML', () => {
    const out = render(`:::annotate\n${IMG}\n\n- {#1 pin x=1% y=1%} first\n\n  \`\`\`\n  a\n\n  b\n  \`\`\`\n:::`);
    expect(out).not.toContain('\n');
    expect(dom(out).querySelector('.ann-comment pre')!.textContent).toContain('a\n\nb');
  });

  it('escapes the author, title and alt', () => {
    const out = render(`:::annotate[<b>t</b>]\n![<i>](a.png)\n\n- {#1 pin x=1% y=1% by="a<b"} c\n:::`);
    expect(out).not.toContain('<b>t</b>');
    expect(out).not.toContain('<i>');
    expect(out).toContain('a&lt;b');
  });

  it('shows a block with no rows as just the image', () => {
    const empty = dom(render(`:::annotate\n${IMG}\n:::`));
    expect(empty.querySelectorAll('.ann-marker')).toHaveLength(0);
    expect(empty.querySelector('.ann-counts')!.textContent).toBe('0 open · 0 resolved');
    expect(empty.querySelector('details')).toBeNull();
  });

  it('shows a no-comment row in muted text', () => {
    expect(dom(render(`:::annotate\n${IMG}\n\n- {#1 pin x=1% y=1%}\n:::`)).querySelector('.ann-empty')!.textContent).toBe('No comment');
  });

  it('renders the strings of the language it is given', () => {
    const out = dom(render(fixture, zhTW));
    expect(out.querySelector('.ann-counts')!.textContent).toBe('2 則未解決 · 1 則已解決');
    expect(out.querySelector('summary')!.textContent).toBe('已解決（1）');
    expect(out.querySelector('.ann-kind')!.textContent).toBe('標記點');
  });
});

describe('renderAnnotate: problems never hide the figure or drop text', () => {
  const out = dom(render(`:::annotate\n${IMG}\n\n- {#1 pin x=1% y=1%} ok\n- {#1 pin x=2% y=2%} duplicate\n- {pin x=3% y=3%} no number\n- {#4 pin x=1% y=1% reslved} typo\n- {#5 pin x=500% y=1%} off\n- plain text\n:::`));
  const items = [...out.querySelectorAll('.ann-item')];

  it('lists every row, in source order', () => {
    expect(items.map(item => item.querySelector('.ann-comment')!.textContent!.trim())).toEqual(['ok', 'duplicate', 'no number', 'typo', 'off', 'plain text']);
  });

  it('tags a problem row with the cause, and marks it', () => {
    expect(items[1].classList.contains('is-problem')).toBe(true);
    expect(items[1].querySelector('.ann-problem')!.textContent).toBe('This number is already used');
    expect(items[3].querySelector('.ann-problem')!.textContent).toBe('Unknown word "reslved"');
    expect(items[4].querySelector('.ann-problem')!.textContent).toMatch(/Outside the image/);
    expect(items[5].querySelector('.ann-problem')!.textContent).toMatch(/Not an annotation row/);
  });

  it('draws a marker when the geometry is valid, and keeps the duplicate id out of the DOM id', () => {
    const ids = [...out.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.querySelectorAll('.ann-marker')).toHaveLength(4);
  });

  it('writes an unnumbered row as ? and without a link to a marker that does not exist', () => {
    expect(items[5].querySelector('.ann-ref')!.tagName).toBe('SPAN');
    expect(items[2].querySelector('.ann-ref')!.textContent).toBe('?');
  });
});

describe('renderAnnotate: block errors', () => {
  it('throw AnnotateError', () => {
    expect(() => render(':::annotate\nno image\n:::')).toThrow(AnnotateError);
  });
});

describe('transformDirectives', () => {
  it('puts the error box in the place of a bad block and renders the rest of the note', () => {
    const out = transformDirectives('before\n\n:::annotate\nnot an image\n:::\n\nafter', renderMarkdown);
    expect(out).toContain('class="ann-error"');
    expect(out).toContain('This image annotation block could not be drawn');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('draws a block inside a blockquote inside the quote', () => {
    const out = transformDirectives(`> intro\n>\n> :::annotate\n> ${IMG}\n> :::\n>\n> outro`, renderMarkdown);
    expect(out).toContain('> <figure class="ann-figure"');
  });

  it('names the language of the labels: annotation and handout labels', () => {
    const note = `:::handout{id="D1" keeper="k"}\nbody\n:::\n\n:::annotate\n${IMG}\n\n- {#1 pin x=1% y=1%} c\n:::`;
    expect(transformDirectives(note, renderMarkdown, undefined, 'zh-TW')).toContain('編輯備註');
    expect(transformDirectives(note, renderMarkdown, undefined, 'zh-TW')).toContain('則未解決');
    expect(transformDirectives(note, renderMarkdown, undefined, 'en')).toContain('Editor note');
    expect(transformDirectives(note, renderMarkdown, undefined, 'en')).toContain('1 open');
  });
});

describe('sanitised output (renderNote under DOMPurify)', () => {
  const { window } = new JSDOM('');
  const purify = createDOMPurify(window as unknown as Window & typeof globalThis);
  const parser = new window.DOMParser() as unknown as DOMParser;
  const renderer = createNoteRenderer({ parser, purify, origin: 'https://app.example' });
  const html = renderer.renderNote(fixture, 'n.md');
  const document = dom(html);

  it('keeps every element and attribute of the contract', () => {
    const figure = document.querySelector('figure.ann-figure')!;
    expect(figure.getAttribute('data-type')).toBe('annotate');
    const pin = document.querySelector('.ann-marker.ann-pin > svg')!;
    expect(['x', 'y', 'overflow'].map(name => pin.getAttribute(name))).toEqual(['41.2%', '23.3%', 'visible']);
    expect(pin.querySelector('path')!.getAttribute('d')).toMatch(/^M0 0 C/);
    const text = pin.querySelector('text')!;
    expect(['y', 'text-anchor', 'dominant-baseline'].map(name => text.getAttribute(name))).toEqual(['-20', 'middle', 'central']);
    const rect = document.querySelector('.ann-region rect')!;
    expect(['x', 'y', 'width', 'height', 'rx'].map(name => rect.getAttribute(name))).toEqual(['8%', '61.5%', '35%', '12%', '3']);
    expect(document.querySelector('.ann-badge circle')!.getAttribute('r')).toBe('11');
    expect(document.querySelector('.ann-marker title')).not.toBeNull();
    expect(document.querySelector('a.ann-marker')!.getAttribute('href')).toMatch(/^#ann-\d+-/);
    expect(document.querySelector('details.ann-resolved summary')).not.toBeNull();
    expect(document.querySelector('.ann-overlay')!.getAttribute('aria-label')).toBe('Annotations on 首頁 v3');
  });

  it('writes no inline style and no data attribute but the ones it needs', () => {
    expect(html).not.toMatch(/\sstyle=/);
    const names = new Set([...document.querySelectorAll('.ann-figure *')].flatMap(element => element.getAttributeNames().filter(name => name.startsWith('data-'))));
    expect([...names].sort()).toEqual(['data-source-path', 'data-workspace-link']);
  });

  it('makes the caption link, and only it, a workspace link; the stage image and the markers are not', () => {
    const links = [...document.querySelectorAll('.ann-figure [data-workspace-link]')];
    expect(links.map(element => element.className)).toEqual(['ann-open']);
    expect(document.querySelector('.ann-stage img')!.hasAttribute('role')).toBe(false);
    expect(document.querySelector('.ann-stage img')!.hasAttribute('tabindex')).toBe(false);
    expect(document.querySelector('a.ann-marker')!.hasAttribute('data-workspace-link')).toBe(false);
    expect(document.querySelector('a.ann-ref')!.hasAttribute('data-workspace-link')).toBe(false);
  });

  it('resolves a repository path for the stage image like any note image', () => {
    const out = dom(renderer.renderNote(`:::annotate\n![a](shots/a%20b.png)\n:::`, 'notes/x/n.md'));
    expect(out.querySelector('.ann-stage img')!.getAttribute('src')).toBe('/raw-assets/notes/x/shots/a%20b.png');
  });

  it('keeps an r2 image in its stage as a plain img', () => {
    const out = dom(renderer.renderNote(`:::annotate\n![a](r2:shots/a.png)\n:::`, 'n.md'));
    expect(out.querySelector('.ann-stage > img')).not.toBeNull();
    expect(out.querySelector('.ann-stage figure')).toBeNull();
  });

  it('renders the annotation and handout labels in the language given to the renderer', () => {
    const zh = createNoteRenderer({ parser, purify, origin: 'https://app.example', language: 'zh-TW' });
    const out = zh.renderNote(`:::handout{id="D1" keeper="k"}\nb\n:::\n\n${fixture}`, 'n.md');
    expect(out).toContain('編輯備註');
    expect(out).toContain('2 則未解決 · 1 則已解決');
    const english = renderer.renderNote(`:::handout{id="D1" keeper="k"}\nb\n:::\n\n${fixture}`, 'n.md');
    expect(english).toContain('Editor note');
    expect(english).toContain('2 open · 1 resolved');
  });
});
