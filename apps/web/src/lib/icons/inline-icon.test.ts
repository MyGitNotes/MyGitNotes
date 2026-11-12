// @vitest-environment node
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNoteRenderer } from '../markdown.js';
import { findInlineIcons } from './inline-icon.js';
import { loadLucideIcons, lucideIcon, lucideIconNames } from './lucide-registry.js';

/** The renderer a server builds: the app pipeline under a jsdom window and the real DOMPurify. */
function serverRenderer() {
  const { window } = new JSDOM('');
  return createNoteRenderer({ parser: new window.DOMParser() as unknown as DOMParser, purify: createDOMPurify(window as unknown as Window & typeof globalThis), origin: 'https://app.example' });
}
const render = (markdown: string) => serverRenderer().renderNote(markdown, 'notes/a.md');
const svgOf = (html: string) => new JSDOM(html).window.document.querySelector('svg');

beforeAll(async () => {
  await loadLucideIcons();
});

describe('inline icons in rendered notes', () => {
  it('draws the real Lucide User icon, sized 1em by default', () => {
    const html = render('A :icon{name="User"} here');
    const svg = svgOf(html)!;
    expect([...svg.children].map(child => child.tagName)).toEqual(['path', 'circle']);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2');
    expect(svg.querySelector('circle')!.getAttribute('r')).toBe('4');
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(html).toContain('data-lucide="User"');
  });

  it('draws FileText with its five shapes and a pixel size', () => {
    const svg = svgOf(render(':icon{name="FileText" size="20"}'))!;
    expect(svg.querySelectorAll('path')).toHaveLength(5);
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });

  it('takes a CSS length as the size and ignores one it cannot trust', () => {
    expect(svgOf(render(':icon{name="User" size="1.5em"}'))!.getAttribute('width')).toBe('1.5em');
    expect(svgOf(render(':icon{name="User" size="2rem"}'))!.getAttribute('height')).toBe('2rem');
    for (const bad of ['calc(1px)', 'red', '"><b>', '-4', '0']) expect(svgOf(render(`:icon{name="User" size='${bad}'}`))!.getAttribute('width')).toBe('1em');
  });

  it('accepts kebab-case, lower case and the bracket form', () => {
    const pascal = svgOf(render(':icon{name="FileText"}'))!.innerHTML;
    expect(svgOf(render(':icon{name="file-text"}'))!.innerHTML).toBe(pascal);
    expect(svgOf(render(':icon{name="filetext"}'))!.innerHTML).toBe(pascal);
    const bracket = svgOf(render(':icon[User]{size="16"}'))!;
    expect(bracket.querySelector('circle')).not.toBeNull();
    expect(bracket.getAttribute('width')).toBe('16');
  });

  it('draws every icon of a line, around the text that follows', () => {
    const html = render(':icon{name="User"} 評論人　洪偉｜:icon{name="FileText"} 頁碼依 11/12 補署名版');
    expect(new JSDOM(html).window.document.querySelectorAll('span.lucide-icon svg')).toHaveLength(2);
    expect(html).toContain('評論人　洪偉｜');
    expect(html).toContain('頁碼依 11/12 補署名版');
  });

  it('shows a visible fallback with the name in its title for an unknown icon', () => {
    const html = render('x :icon{name="NoSuchIcon9"} y');
    const holder = new JSDOM(html).window.document.querySelector('.lucide-icon')!;
    expect(holder.classList.contains('lucide-icon-missing')).toBe(true);
    expect(holder.getAttribute('title')).toBe('NoSuchIcon9');
    expect(holder.querySelector('svg')!.children.length).toBeGreaterThan(0);
    expect(holder.classList.contains('lucide-icon-pending')).toBe(false);
  });

  it('escapes a hostile name', () => {
    const html = render(':icon{name="a&quot;onload=&quot;x"}');
    expect(new JSDOM(html).window.document.querySelector('[onload]')).toBeNull();
  });

  it('leaves no style attribute behind and keeps every shape element and attribute of every Lucide icon', () => {
    const renderer = serverRenderer();
    const lost: string[] = [];
    const tags = new Set<string>();
    // One note with all of them, so the sanitizer runs once.
    const names = lucideIconNames();
    const html = renderer.renderNote(names.map(name => `:icon{name="${name}" size="18"}`).join('\n\n'), 'notes/a.md');
    expect(html).not.toMatch(/\sstyle=/);
    const holders = [...new JSDOM(html).window.document.querySelectorAll('span.lucide-icon')];
    expect(holders).toHaveLength(names.length);
    holders.forEach((holder, index) => {
      const icon = lucideIcon(names[index])!;
      const kept = [...holder.querySelectorAll('svg > *')];
      if (kept.length !== icon.children.length) lost.push(`${icon.name}: ${kept.length} of ${icon.children.length} shapes`);
      icon.children.forEach(([tag, attributes], position) => {
        tags.add(tag);
        for (const [attribute, value] of Object.entries(attributes)) if (attribute !== 'key' && kept[position]?.getAttribute(attribute) !== String(value)) lost.push(`${icon.name} <${tag}> ${attribute}`);
      });
    });
    expect(lost).toEqual([]);
    expect([...tags].sort()).toEqual(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect']);
  });

  it('keeps the fallback glyph whole, dashes included', () => {
    const svg = svgOf(render(':icon{name="NoSuchIcon9"}'))!;
    expect(svg.querySelectorAll('rect, path')).toHaveLength(3);
    expect(svg.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('3 3');
  });

  it('keeps an icon in text but not inside inline code, and leaves :icons alone', () => {
    const html = render('Write `:icon{name="User"}` for :icon{name="User"}, not :icons or :icon alone.');
    expect(new JSDOM(html).window.document.querySelectorAll('svg')).toHaveLength(1);
    expect(html).toContain('<code>:icon{name="User"}</code>'.replace(/"/g, '"'));
    expect(html).toContain(':icons or :icon alone.');
  });
});

describe('an icon directive inside a code block', () => {
  const icon = ':icon{name="User"}';
  const blocks: [string, string][] = [['a backtick fence', `Before\n\n\`\`\`md\n${icon}\n\`\`\`\n\nAfter ${icon}`], ['a tilde fence', `Before\n\n~~~\ntext ${icon} text\n~~~\n\nAfter ${icon}`], ['an indented block', `Before\n\n    ${icon}\n\n    more ${icon}\n\nAfter ${icon}`], ['an indented block at the top of the note', `    ${icon}\n\nAfter ${icon}`], ['a tab-indented block', `Before\n\n\t${icon}\n\nAfter ${icon}`], ['an indented block inside a list item', `- item\n\n      ${icon}\n\nAfter ${icon}`]];
  // The print export draws `renderNote` without options; a slide note's preview and its deck pass `slides`.
  const renderings: [string, { slides: 'preview' | 'deck'; } | undefined][] = [['a note and its print', undefined], ['a slide preview', { slides: 'preview' }], ['a deck', { slides: 'deck' }]];
  const cases = renderings.flatMap(([rendering, options]) => blocks.map(([block, markdown]) => [block, rendering, markdown, options] as const));

  it.each(cases)('%s stays literal text in %s', (_block, _rendering, markdown, options) => {
    const page = new JSDOM(serverRenderer().renderNote(markdown, 'notes/a.md', undefined, undefined, undefined, options)).window.document;
    const code = page.querySelector('pre code')!;
    expect(code.textContent).toContain(icon);
    expect(code.querySelector('svg')).toBeNull();
    expect(page.body.textContent).not.toContain('lucide-icon');
    // The one after the block is still drawn.
    expect(page.querySelectorAll('svg')).toHaveLength(1);
  });

  it('still draws an icon in the indented paragraphs of a list item, which are no code', () => {
    const page = new JSDOM(render(`- item\n\n    ${icon} in the item\n\n  - nested\n\n      ${icon} in the nested item\n\n1. numbered\n\n    ${icon} in the numbered item`)).window.document;
    expect(page.querySelector('pre')).toBeNull();
    expect(page.querySelectorAll('li svg')).toHaveLength(3);
  });

  it('still draws an icon on an indented line that continues a paragraph', () => {
    const page = new JSDOM(render(`A paragraph\n    continued ${icon} here`)).window.document;
    expect(page.querySelector('pre')).toBeNull();
    expect(page.querySelectorAll('p svg')).toHaveLength(1);
  });
});

describe('findInlineIcons', () => {
  it('lists each directive with its range, name and size, and skips a bare :icon and :icons', () => {
    const text = 'a :icon{name="User"} b :icon[FileText]{size="20"} :icon :icons{name="X"}';
    const found = findInlineIcons(text);
    expect(found.map(icon => [text.slice(icon.from, icon.to), icon.name, icon.size])).toEqual([[':icon{name="User"}', 'User', undefined], [':icon[FileText]{size="20"}', 'FileText', '20']]);
  });
});
