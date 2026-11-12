import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformDirectives } from '../lib/directives.js';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css: string, selector: string) => css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

/** A grid cell or a table sized by its content would push past the editor pane and overlap its neighbour or be cut off, so both must be able to shrink to the room they have. */
describe('grid cells in the editor', () => {
  const presentation = read('presentation.css');

  it('split the grid into equal tracks that may shrink below their content, for every column count', () => {
    for (const cols of [2, 3, 4]) {
      const html = transformDirectives(`::::grid{cols=${cols}}\n:::cell\nA\n:::\n::::`, text => text);
      expect(html).toContain(`grid-template-columns:repeat(${cols},minmax(0,1fr))`);
    }
  });

  it('let each cell shrink below its content, so long text wraps inside it', () => {
    expect(rule(presentation, '.prose-custom .slide-cell')).toMatch(/min-width:\s*0\b/);
    expect(rule(presentation, '.prose-custom .slide-grid')).toMatch(/width:\s*100%/);
  });
});

describe('wide tables in the editor', () => {
  const index = read('../index.css');

  it('scroll sideways inside their own wrapper, which never grows past its widget', () => {
    const wrapper = rule(index, '.markdown-table-scroll');
    expect(wrapper).toMatch(/max-width:\s*100%/);
    expect(wrapper).toMatch(/overflow-x:\s*auto/);
  });

  it('sit in a block widget that is as wide as the editor line, not as wide as the table', () => {
    expect(rule(index, '.live-md-table')).toMatch(/width:\s*100%/);
  });
});
