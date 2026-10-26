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

  // The note's prose reset (`.prose-custom .ann-figure :where(p, ul, ol, li, details, summary)`) is two classes strong; a figure rule on the
  // same element with one class loses to it, which once left every comment card with no padding at all.
  describe('against the prose reset', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...bare.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((match, order) => ({ selectors: match[1].split(/,(?![^(]*\))/).map(selector => selector.trim()), body: match[2], order }));
    const specificity = (selector: string): [number, number, number] => {
      const bare = selector.replace(/:where\([^)]*\)/g, '');
      const classes = (bare.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g) ?? []).length;
      const types = (bare.replace(/\.[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
      return [0, classes, types];
    };
    const beats = (a: [number, number, number], b: [number, number, number]) => a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];
    const reset = rules.find(rule => rule.selectors.some(selector => selector.startsWith('.prose-custom .ann-figure :where(p, ul, ol, li')))!;
    const resetPower = specificity(reset.selectors[0]);

    it('understands the reset it measures against', () => {
      expect(resetPower).toEqual([0, 2, 0]);
    });

    it.each([['.ann-item', 'padding'], ['.ann-resolved', 'margin-top'], ['.ann-resolved > summary', 'padding']])('lets %s keep its %s inside a note', (tail, property) => {
      const declaring = rules.filter(rule => new RegExp(`(?:^|[;\\s])${property}\\s*:`).test(rule.body)).flatMap(rule => rule.selectors.filter(selector => selector === tail || selector.endsWith(` ${tail}`)).map(selector => ({ selector, order: rule.order })));
      expect(declaring.length).toBeGreaterThan(0);
      expect(declaring.some(({ selector, order }) => beats(specificity(selector), resetPower) && (specificity(selector)[1] > resetPower[1] || order > reset.order))).toBe(true);
    });
  });
});
