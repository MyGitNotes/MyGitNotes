import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, 'parallel-quotes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The page language's words reach the stylesheet as attributes the renderer writes; a literal in `content` would show on every page. */
describe('parallel quote labels in the stylesheet', () => {
  it("write no literal text of any language in a `content` declaration, only the renderer's attributes", () => {
    const literals = [...css.matchAll(/content:\s*('[^']*'|"[^"]*")/g)].map(match => match[1]).filter(value => value.replace(/['"]/g, '').trim() !== '');
    expect(literals).toEqual([]);
  });

  it('read the toggle and block labels from the attributes', () => {
    expect(css).toMatch(/\[open\]\s*>\s*\.parallel-quote-toggle::after\s*\{\s*content:\s*attr\(data-collapse-label\)/);
    expect(css).toMatch(/:not\(\[open\]\)\s*>\s*\.parallel-quote-toggle::after\s*\{\s*content:\s*attr\(data-expand-label\)/);
    expect(css).toMatch(/\.parallel-quote-original::before\s*\{\s*content:\s*attr\(data-label\)/);
    expect(css).toMatch(/\.parallel-quote-translation::before\s*\{\s*content:\s*attr\(data-label\)/);
  });
});
