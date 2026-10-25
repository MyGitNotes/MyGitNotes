import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../directives/annotations.css', import.meta.url), 'utf8');

describe('annotation figure styles', () => {
  it('colour nothing but from theme tokens', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch|lab)a?\(/);
  });

  it('draw one-sided borders only as neutral rules, never as a coloured accent', () => {
    expect(css).not.toMatch(/border-(?:top|right|bottom|left)\s*:/);
  });

  it('keep every animation inside prefers-reduced-motion: no-preference', () => {
    const outside = css.replace(/^@media \(prefers-reduced-motion: no-preference\) \{.*\}$/gm, '');
    expect(css).toMatch(/^@media \(prefers-reduced-motion: no-preference\) \{.*animation/m);
    expect(outside).not.toMatch(/animation\s*:|transition\s*:/);
  });

  it('hide resolved markers while the resolved group is closed, with no script', () => {
    expect(css).toMatch(/\.ann-figure:has\(\.ann-resolved:not\(\[open\]\)\) \.ann-marker\.is-resolved \{ display: none; \}/);
  });

  it('stack the list under the image in a narrow figure and put it beside the image in a wide one', () => {
    expect(css).toMatch(/@container \(min-width: 720px\)/);
    expect(css).toMatch(/\.ann-figure \{[^}]*container-type: inline-size/);
  });

  it('size the stage to the image and never fit the image to a box', () => {
    expect(css).not.toMatch(/object-fit/);
    expect(css).toMatch(/\.ann-stage \{[^}]*display: inline-block/);
  });
});
