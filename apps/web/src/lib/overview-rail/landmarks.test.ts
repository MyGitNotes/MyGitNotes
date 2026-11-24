import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { linesOfOffsets, noteLandmarks, pageBreakOffsets, positionsOfOffsets } from './landmarks.js';

const parse = (text: string) => markdownLanguage.parser.parse(text);

describe('pageBreakOffsets', () => {
  const text = ['# Title', '', 'Intro', '', '---', '', 'Setext', '---', '', '- item', '', '  ---', '', '***', '', '```', '---', '```', '', '> ---', '', '---'].join('\n');

  it('counts the top-level `---` the editor draws as page breaks', () => {
    const lines = linesOfOffsets(text, pageBreakOffsets(parse(text), text));
    // Not the setext underline (line 8), a rule inside a list (12), `***` (14), a fence (17) or a quote (20).
    expect(lines).toEqual([5, 22]);
  });

  it('counts every top-level thematic break of a slide note', () => {
    expect(linesOfOffsets(text, pageBreakOffsets(parse(text), text, { slides: true }))).toEqual([5, 14, 22]);
  });

  it('skips the frontmatter the collab editor holds', () => {
    const withFrontmatter = '---\ntitle: A\n---\n\nBody\n\n---\n\nMore';
    const bodyFrom = withFrontmatter.indexOf('\n\nBody') + 1;
    expect(linesOfOffsets(withFrontmatter, pageBreakOffsets(parse(withFrontmatter), withFrontmatter, { bodyFrom }))).toEqual([7]);
  });
});

describe('noteLandmarks', () => {
  it('lists the outline headings and labels each break with the page that ends there', () => {
    const text = '# One\n\nText\n\n## Two\n\n---\n\n### Three\n\n---\n\nEnd';
    expect(noteLandmarks(text, parse(text), 'Page')).toEqual({ headings: [{ line: 1, depth: 1, label: 'One' }, { line: 5, depth: 2, label: 'Two' }, { line: 9, depth: 3, label: 'Three' }], breaks: [{ line: 7, label: 'Page 1' }, { line: 11, label: 'Page 2' }], endLabel: 'Page 3' });
  });

  it('has no pages without breaks', () => {
    const text = '# One\n\nText';
    expect(noteLandmarks(text, parse(text), 'Page').endLabel).toBeNull();
  });

  it('leaves out headings in the frontmatter before the body', () => {
    const text = '---\ntitle: A\n---\n# Body';
    expect(noteLandmarks(text, parse(text), 'Page', text.indexOf('# Body')).headings).toEqual([{ line: 4, depth: 1, label: 'Body' }]);
  });
});

describe('positionsOfOffsets', () => {
  it('answers the line and column of ascending offsets', () => {
    const text = 'ab\ncd\r\nef';
    expect(positionsOfOffsets(text, [0, 1, 3, 5, 7, 9])).toEqual([{ line: 1, column: 0 }, { line: 1, column: 1 }, { line: 2, column: 0 }, { line: 2, column: 2 }, { line: 3, column: 0 }, { line: 3, column: 2 }]);
  });

  it('starts again for an offset out of order', () => {
    expect(positionsOfOffsets('a\nb\nc', [4, 0])).toEqual([{ line: 3, column: 0 }, { line: 1, column: 0 }]);
  });
});
