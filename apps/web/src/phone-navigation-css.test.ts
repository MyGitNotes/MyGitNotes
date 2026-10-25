import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'workspace.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of the rules written for a selector inside every `@media (max-width: 767px)` block (one level of nesting). */
function phoneRules(selector: string): string[] {
  const bodies: string[] = [];
  for (const media of css.matchAll(/@media \(max-width: 767px\)\s*\{/g)) {
    let depth = 1, end = media.index! + media[0].length;
    while (depth > 0 && end < css.length) depth += css[end++] === '{' ? 1 : css[end - 1] === '}' ? -1 : 0;
    const block = css.slice(media.index! + media[0].length, end - 1);
    for (const [, rule, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (rule!.split(',').some(part => part.trim() === selector)) bodies.push(body!);
  }
  return bodies;
}

/**
 * On a phone the main navigation is `position: fixed` to the screen's bottom edge, written as an offset from the
 * viewport's top. An ancestor with `backdrop-filter` becomes the containing block of a fixed descendant, so the offset
 * is measured from the header's own top instead: under the demo banner (or any notice above the header) the tab bar
 * moved down by the banner's height and left the screen, seen on the Files screen at 390 px with only the tool rail left.
 */
describe('the phone navigation bar', () => {
  it('sits in a header that does not blur what is behind it, so the bar stays fixed to the screen', () => {
    const header = phoneRules('.workspace-header').join(';');
    expect(header).toMatch(/backdrop-filter:\s*none/);
  });

  it('keeps an opaque surface of its own where the header no longer blurs', () => {
    expect(phoneRules('.workspace-header .header-nav').join(';')).toMatch(/background:\s*var\(--color-surface\)/);
  });
});
