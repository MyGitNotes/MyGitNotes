import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = [read('index.css'), read('workspace.css')];

/** The declarations written for `selector` at the top level (`media` null) or inside every `@media <media>` block (one level of nesting). */
function declarations(selector: string, media: string | null): Record<string, string> {
  const found: Record<string, string> = {};
  const collect = (block: string) => {
    for (const [, rule, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!rule!.split(',').some(part => part.trim() === selector)) continue;
      for (const declaration of body!.split(';')) {
        const [name, ...value] = declaration.split(':');
        if (name?.trim() && value.length) found[name.trim()] = value.join(':').trim();
      }
    }
  };
  for (const css of sheets) {
    if (media === null) {
      collect(css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''));
      continue;
    }
    const opener = `@media ${media}`;
    for (let start = css.indexOf(opener); start !== -1; start = css.indexOf(opener, start + 1)) {
      const open = css.indexOf('{', start);
      let depth = 1, end = open + 1;
      while (depth > 0 && end < css.length) depth += css[end++] === '{' ? 1 : css[end - 1] === '}' ? -1 : 0;
      collect(css.slice(open + 1, end - 1));
    }
  }
  return found;
}

const px = (value: string | undefined) => value === undefined ? undefined : parseFloat(value);
const rendered = (selector: string, media: string | null) => {
  const base = declarations(selector, null), touch = media ? declarations(selector, media) : {};
  return Math.max(px(touch.width ?? base.width) ?? 0, px(touch['min-width'] ?? base['min-width']) ?? 0);
};

/**
 * A folder with subfolders starts its row with a chevron button; a folder without one starts it with a spacer of the same width, so
 * every folder's icon lines up. A phone and any touch screen give every button a 44 px minimum width; the 20 px spacer kept its width,
 * and at 390 px the folders without subfolders sat 24 px left of their siblings with a chevron.
 */
describe('the folder tree', () => {
  const touch = '(pointer: coarse), (max-width: 767px)';

  it('gives a touch screen a minimum button width, which the chevron takes', () => {
    expect(px(declarations('button', touch)['min-width'])).toBe(44);
  });

  it('lines leaf rows up with rows that have a chevron, on a desktop and on a touch screen', () => {
    expect(rendered('.nav-tree-chevron-spacer', null)).toBe(rendered('.nav-tree-chevron', null));
    const chevron = Math.max(rendered('.nav-tree-chevron', touch), px(declarations('button', touch)['min-width'])!);
    expect(rendered('.nav-tree-chevron-spacer', touch)).toBe(chevron);
  });
});
