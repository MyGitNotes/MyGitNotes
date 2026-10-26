// @vitest-environment node
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';
import { createNoteRenderer } from './markdown.js';

const NOTE = '# Title\n\nA **bold** word, `code`, and a [link](https://example.com).\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n::: tip\nKeep going\n:::\n\nInline $x^2$ and\n\n$$\\frac{1}{2}$$\n\n![Alt](images/pic.png)\n\n```mermaid\ngraph TD\n  A --> B\n```\n';

/** The renderer a server builds: the same pipeline under a jsdom window, without any browser global. */
function serverRenderer(mathOutput?: 'html' | 'mathml') {
  const { window } = new JSDOM('');
  return createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example', mathOutput });
}

it('renders a note on a server with the app pipeline, without a browser global', () => {
  expect(typeof globalThis.DOMParser).toBe('undefined');
  const html = serverRenderer().renderNote(NOTE, 'notes/a/b.md');
  expect(html).toContain('<h1 data-heading-slug="title">Title</h1>');
  expect(html).toContain('<strong>bold</strong>');
  expect(html).toContain('markdown-table-scroll');
  expect(html).toContain('class="katex"');
  expect(html).toContain('<div class="note-mermaid"><pre>graph TD\n  A --&gt; B</pre></div>');
  expect(html).toContain('src="/raw-assets/notes/a/images/pic.png"');
  expect(html).toContain('Keep going');
});

it('draws formulas as MathML without inline style or the TeX source when asked', () => {
  const html = serverRenderer('mathml').renderNote('Inline $x^2$ and\n\n$$\\frac{1}{2}$$\n', 'notes/a.md');
  expect(html).toContain('<math');
  expect(html).not.toContain('style=');
  expect(html).not.toContain('annotation');
  expect(html.replace(/aria-label="[^"]*"/g, '')).not.toContain('x^2');
  expect(html).toContain('aria-label="x^2"');
});

it('keeps the app output for HTML formulas', () => {
  const html = serverRenderer('html').renderNote('Inline $x^2$\n', 'notes/a.md');
  expect(html).toContain('class="katex-html"');
});

// A pasted block of spaces once cost seconds: marked's inline text rule read to the end of the run at every space.
describe('a long run of spaces inside a line', () => {
  const SPACES = ' '.repeat(120_000);
  const render = (source: string) => serverRenderer().renderNote(source, 'notes/a.md');

  it.each([['a list item', `- a${SPACES}x`], ['a task list item', `- [ ] a${SPACES}x`], ['a paragraph', `a${SPACES}x`], ['a heading', `# a${SPACES}x`], ['a line before a line break', `a${SPACES}\nx`]])('renders %s in well under a second', (_name, source) => {
    const started = performance.now();
    const html = render(source);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(html).toContain('a');
  });

  it('keeps line breaks and the text around trailing spaces as before', () => {
    expect(render('a  \nb')).toBe('<p>a<br>b</p>\n');
    expect(render('a\nb')).toBe('<p>a<br>b</p>\n');
    expect(render('a   \n')).toBe('<p>a   </p>\n');
    expect(render('a b  c   \n\nd')).toBe('<p>a b  c   </p>\n<p>d</p>\n');
    expect(render('  a  \n  b\n')).toBe('<p>  a<br>b</p>\n');
    expect(render('x  `y  `  \nz')).toBe('<p>x  <code>y  </code><br>z</p>\n');
  });
});
