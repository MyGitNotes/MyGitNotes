import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'live-editor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of the rules written for a selector inside every `@media (max-width: 767px)` block. */
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

describe('the live editor bar on a phone', () => {
  it('gives 在新分頁開啟, 立即簽回 and 關閉 44px touch targets', () => {
    expect(phoneRules('.live-editor-actions .ui-button.ui-button-small').join(';')).toMatch(/min-height:\s*44px/);
  });
});

describe('the collab editor', () => {
  it('names a remote cursor in the app font, not y-codemirror’s serif', () => {
    expect(css).toMatch(/\.live-collab \.cm-editor \.cm-ySelectionInfo\s*\{[^}]*font-family:\s*var\(--font-body\)/);
  });
});
