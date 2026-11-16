// @vitest-environment node
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';
import { createNoteRenderer } from './markdown.js';
import { mapScroll, scrollPoints } from './split-scroll.js';

function renderer() {
  const { window } = new JSDOM('');
  return { window, ...createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example' }) };
}

/** The source line each marked block of the rendered note starts on, by the block's tag (or class for a directive). */
function marked(html: string, window: JSDOM['window']) {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body;
  return [...body.querySelectorAll<HTMLElement>('[data-source-line]')].map(element => [element.tagName.toLowerCase(), Number(element.dataset.sourceLine)] as const);
}

const NOTE = [
  '# Title', // 1
  '', // 2
  'A paragraph', // 3
  'that wraps.', // 4
  '', // 5
  '- one', // 6
  '- two', // 7
  '', // 8
  '  still two', // 9
  '', // 10
  ':::info', // 11
  'Inside', // 12
  '', // 13
  'Still inside', // 14
  ':::', // 15
  '', // 16
  '```js', // 17
  'let a = 1;', // 18
  '', // 19
  'let b = 2;', // 20
  '```', // 21
  '## Next', // 22
  'Right after the heading', // 23
  '', // 24
  '| a | b |', // 25
  '| - | - |', // 26
  '| 1 | 2 |', // 27
].join('\n');

describe('source lines on the rendered blocks of a split preview', () => {
  it('marks each top-level block with the body line it starts on, a directive and a code block whole', () => {
    const { window, renderNote } = renderer();
    const html = renderNote(NOTE, 'notes/a.md', undefined, undefined, undefined, { sourceLines: true });
    expect(marked(html, window)).toEqual([['h1', 1], ['p', 3], ['ul', 6], ['div', 11], ['pre', 17], ['h2', 22], ['p', 23], ['div', 25]]);
    // Nothing is marked inside the directive, and the list stays one list.
    const body = new window.DOMParser().parseFromString(html, 'text/html').body;
    expect(body.querySelector('.custom-directive [data-source-line]')).toBeNull();
    expect(body.querySelectorAll('ul')).toHaveLength(1);
  });

  it('renders the same note as the read view, apart from the markers', () => {
    const { window, renderNote } = renderer();
    const strip = (html: string) => {
      const body = new window.DOMParser().parseFromString(html, 'text/html').body;
      for (const element of body.querySelectorAll('[data-source-line]')) element.removeAttribute('data-source-line');
      return body.innerHTML;
    };
    expect(strip(renderNote(NOTE, 'notes/a.md', undefined, undefined, undefined, { sourceLines: true }))).toBe(strip(renderNote(NOTE, 'notes/a.md')));
  });

  it('counts lines of a CRLF note as the source editor shows them', () => {
    const { window, renderNote } = renderer();
    expect(marked(renderNote('# A\r\n\r\nText\r\n', 'notes/a.md', undefined, undefined, undefined, { sourceLines: true }), window)).toEqual([['h1', 1], ['p', 3]]);
  });

  it('leaves the read view without markers', () => {
    const { window, renderNote } = renderer();
    expect(marked(renderNote(NOTE, 'notes/a.md'), window)).toEqual([]);
  });
});

describe('scroll sync between source lines and rendered blocks', () => {
  // Source lines are 20px; blocks at lines 1, 11 and 41 sit at 0, 300 and 500 in the preview.
  const points = scrollPoints([{ source: 0, preview: 0 }, { source: 200, preview: 300 }, { source: 800, preview: 500 }], { source: 2000, preview: 1000 });

  it('maps a block start in one pane to the same block start in the other, both ways', () => {
    expect(mapScroll(points, 200, 'source')).toBe(300);
    expect(mapScroll(points, 300, 'preview')).toBe(200);
    expect(mapScroll(points, 800, 'source')).toBe(500);
  });

  it('interpolates within a block, and reaches both ends together', () => {
    expect(mapScroll(points, 100, 'source')).toBe(150);
    expect(mapScroll(points, 500, 'source')).toBe(400);
    expect(mapScroll(points, 2000, 'source')).toBe(1000);
    expect(mapScroll(points, 1000, 'preview')).toBe(2000);
    expect(mapScroll(points, 5000, 'source')).toBe(1000);
    expect(mapScroll(points, -10, 'preview')).toBe(0);
  });

  it('is its own inverse, so a mapped scroll mapped back lands where it started (no feedback drift)', () => {
    for (const y of [0, 37, 200, 333, 799, 1500, 2000]) expect(mapScroll(points, mapScroll(points, y, 'source'), 'preview')).toBeCloseTo(y, 6);
  });

  it('drops anchors that would run backwards or past the end, keeping the map monotonic', () => {
    const odd = scrollPoints([{ source: 100, preview: 400 }, { source: 200, preview: 300 }, { source: 3000, preview: 900 }], { source: 1000, preview: 800 });
    expect(odd).toEqual([{ source: 0, preview: 0 }, { source: 100, preview: 400 }, { source: 1000, preview: 800 }]);
  });

  it('stays exact on a long note with thousands of blocks', () => {
    const anchors = Array.from({ length: 5000 }, (_, index) => ({ source: index * 40, preview: index * 90 }));
    const long = scrollPoints(anchors, { source: 5000 * 40, preview: 5000 * 90 });
    expect(mapScroll(long, 4321 * 40 + 20, 'source')).toBe(4321 * 90 + 45);
    expect(mapScroll(long, 4321 * 90 + 45, 'preview')).toBe(4321 * 40 + 20);
  });
});
