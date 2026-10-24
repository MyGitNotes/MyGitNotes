import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../directives/argument-maps.css', import.meta.url), 'utf8');

describe('argument map figure styles', () => {
  it('colour nothing but from theme tokens', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch|lab)a?\(/);
    expect(css).toMatch(/--am-support: var\(--color-success\)/);
    expect(css).toMatch(/--am-attack: var\(--color-danger\)/);
  });

  it('draw one-sided borders only as neutral rules, never as a coloured accent', () => {
    const oneSided = [...css.matchAll(/border-(?:top|right|bottom|left)\s*:\s*([^;]+);/g)].map(match => match[1]);
    expect(oneSided.length).toBeGreaterThan(0);
    for (const value of oneSided) expect(value).toMatch(/var\(--am-line\)|var\(--color-text\)/);
  });

  it('keep every animation inside prefers-reduced-motion: no-preference', () => {
    // The formatter keeps a block on one line, so the media block runs to the line's last closing brace.
    const outside = css.replace(/^@media \(prefers-reduced-motion: no-preference\) \{.*\}$/gm, '');
    expect(css).toMatch(/^@media \(prefers-reduced-motion: no-preference\) \{.*animation/m);
    expect(outside).not.toMatch(/animation\s*:|transition\s*:/);
  });

  it('use the panel radius for the figure and the error box', () => {
    expect(css).toMatch(/\.am-figure \{[^}]*border-radius: var\(--radius-panel, 10px\)/);
    expect(css).toMatch(/\.am-error \{[^}]*border-radius: var\(--radius-panel, 10px\)/);
  });

  it('trade indent for width by the figure width, since a live-editor pane is narrow at any screen size', () => {
    expect(css).toMatch(/@container \(max-width: 34rem\)/);
  });
});
