import { markdownLanguage } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';
import { displayWidth, frontmatterEnd, noteBlocks } from './blocks.js';

const blocksOf = (text: string, bodyFrom?: number) => noteBlocks(text, markdownLanguage.parser.parse(text), bodyFrom);

describe('noteBlocks', () => {
  it('gives each line of prose with its width, and leaves headings and rules to the rail', () => {
    expect(blocksOf('# Title\n\nshort\na longer line\n\n---\n\nend')).toEqual([{ kind: 'text', line: 3, endLine: 3, depth: 0, length: 5 }, { kind: 'text', line: 4, endLine: 4, depth: 0, length: 13 }, { kind: 'text', line: 8, endLine: 8, depth: 0, length: 3 }]);
  });

  it('nests list items and quotes, and draws a bar beside a quote', () => {
    expect(blocksOf('- one\n  - two\n\n> said\n> more')).toEqual([{ kind: 'text', line: 1, endLine: 1, depth: 1, length: 3 }, { kind: 'text', line: 2, endLine: 2, depth: 2, length: 3 }, { kind: 'quote', line: 4, endLine: 5, depth: 0, length: 0 }, { kind: 'text', line: 4, endLine: 4, depth: 1, length: 4 }, { kind: 'text', line: 5, endLine: 5, depth: 1, length: 4 }]);
  });

  it('spans code, tables and pictures by their lines', () => {
    const text = '```js\nx\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![i](x.png)\n\n$$\nx\n$$\n\n```mermaid\ngraph TD\n```';
    expect(blocksOf(text).map(({ kind, line, endLine }) => ({ kind, line, endLine }))).toEqual([{ kind: 'code', line: 1, endLine: 3 }, { kind: 'table', line: 5, endLine: 7 }, { kind: 'media', line: 9, endLine: 9 }, { kind: 'media', line: 11, endLine: 13 }, { kind: 'media', line: 15, endLine: 17 }]);
  });

  it('skips directive fences but keeps their lines', () => {
    expect(blocksOf(':::note\ninside\n:::').map(block => block.line)).toEqual([2]);
  });

  it('shows a leading frontmatter as one code block, and nothing before the editor’s body', () => {
    const text = '---\ntitle: x\n---\nbody';
    expect(frontmatterEnd(text)).toBe(17);
    expect(blocksOf(text)).toEqual([{ kind: 'code', line: 1, endLine: 3, depth: 0, length: 0 }, { kind: 'text', line: 4, endLine: 4, depth: 0, length: 4 }]);
    expect(blocksOf(text, 17)).toEqual([{ kind: 'text', line: 4, endLine: 4, depth: 0, length: 4 }]);
  });

  it('counts a wide character as two columns', () => {
    expect(displayWidth('ab中文')).toBe(6);
    expect(blocksOf('中文段落')[0].length).toBe(8);
  });
});
