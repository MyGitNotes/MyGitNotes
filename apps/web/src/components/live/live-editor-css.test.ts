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

describe('live editor notices on a phone', () => {
  it('keeps 44px touch targets in the leave and discard notices', () => {
    expect(phoneRules('.live-editor-notice-actions .ui-button.ui-button-small').join(';')).toMatch(/min-height:\s*44px/);
  });
});

describe('the collab editor', () => {
  it('names a remote cursor in the app font, not y-codemirror’s serif', () => {
    expect(css).toMatch(/\.live-collab \.cm-editor \.cm-ySelectionInfo\s*\{[^}]*font-family:\s*var\(--font-body\)/);
  });

  // A long note in Source or Split had no scroll bar: CodeMirror took the height of its text and its pane cut it off.
  it('lets CodeMirror fill the Source and Split pane, so a long note scrolls inside it', () => {
    const rule = (selector: RegExp) => css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const host = rule(/\.live-collab-source/);
    expect(host).toMatch(/display:\s*flex/);
    expect(host).toMatch(/flex-direction:\s*column/);
    const editor = rule(/\.live-collab-source > \.cm-editor/);
    expect(editor).toMatch(/flex:\s*1 1 auto/);
    expect(editor).toMatch(/min-height:\s*0/);
  });

  // VQ P2-3: Source and Split drew their line numbers on CodeMirror's light default strip in the dark theme.
  it('draws the line numbers of Source and Split in the theme’s colours, over CodeMirror’s light defaults', () => {
    const rule = (selector: RegExp) => css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const gutters = rule(/\.live-collab-source \.cm-editor \.cm-gutters/);
    expect(gutters).toMatch(/background(?:-color)?:\s*(?:transparent|var\(--color-[a-z-]+\))/);
    expect(gutters).toMatch(/color:\s*var\(--color-muted\)/);
    expect(gutters).toMatch(/border-right:[^;]*var\(--color-[a-z-]+\)/);
    expect(rule(/\.live-collab-source \.cm-editor \.cm-activeLineGutter/)).toMatch(/background(?:-color)?:\s*(?:transparent|var\(--color-[a-z-]+\))/);
  });
});
