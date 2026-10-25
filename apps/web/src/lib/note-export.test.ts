// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const drawn: { mode: string; }[] = [];

vi.mock('./markdown.js', () => ({ renderNote: () => '<details class="ann-resolved"><summary>Resolved</summary></details><p>Plan</p><div class="note-mermaid" data-mermaid-source="graph LR"><pre>graph LR</pre></div>' }));
vi.mock('./mermaid.js', () => ({
  currentAppearance: () => ({ familyId: 'flexoki', mode: 'dark' }),
  renderMermaidBlocks: async (root: ParentNode, appearance: { mode: string; }) => {
    drawn.push(appearance);
    await new Promise(resolve => setTimeout(resolve, 20));
    root.querySelector('.note-mermaid')!.innerHTML = '<svg id="diagram"></svg>';
  },
}));

import { printDocument, renderPrintableNote } from './note-export.js';

describe('renderPrintableNote', () => {
  it('resolves only after the diagrams are drawn, on the light variant of the active family', async () => {
    const body = await renderPrintableNote('```mermaid\ngraph LR\n```', 'notes/n.md');
    expect(body).toContain('<svg id="diagram"></svg>');
    expect(body).not.toContain('<pre>graph LR</pre>');
    expect(drawn.at(-1)).toMatchObject({ familyId: 'flexoki', mode: 'light' });
  });

  it('opens the resolved annotations, since paper cannot', async () => {
    const body = await renderPrintableNote('x', 'notes/n.md');
    expect(body).toContain('<details class="ann-resolved" open="">');
  });
});

describe('printDocument', () => {
  it('carries the annotation figure rules, because the print frame loads no app stylesheet', () => {
    const html = printDocument('T', '<p>x</p>');
    expect(html).toMatch(/\.ann-stage \{[^}]*position: relative/);
    expect(html).toMatch(/\.ann-overlay \{[^}]*position: absolute/);
  });
});
