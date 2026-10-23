import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../directives/infographics.css', import.meta.url), 'utf8');
const rule = (selector: string) => new RegExp(`(^|\\n)${selector.replace(/[.>]/g, '\\$&')}\\s*\\{`).test(css);

describe('infographic figure styles', () => {
  it("do not restyle the figure through its kind class: the timeline's rule names the body's container", () => {
    // `<figure class="ig-figure ig-timeline">` holds `<div class="ig-timeline">`; a bare `.ig-timeline` rule hit both,
    // giving the figure no top padding and a grid layout of its own.
    expect(rule('.ig-timeline')).toBe(false);
    expect(rule('.ig-body > .ig-timeline')).toBe(true);
  });

  it('keep the axis ticks on one line, also inside an overflow-wrap: anywhere editor', () => {
    expect(css).toMatch(/\.ig-axis-tick \{[^}]*white-space: nowrap/);
  });

  it('animate on a timer, not on scroll: a figure at the end of a note cannot scroll far enough to finish a view() timeline', () => {
    expect(css).not.toMatch(/animation-timeline/);
  });

  it('hide crowded x ticks and in-plot point labels in a narrow figure', () => {
    expect(css).toMatch(/@container \(max-width: 34rem\) \{[^\n]*\.ig-x-tick\.is-minor[^\n]*\.ig-point\.is-labeled:not\(:hover, :focus-visible\) > \.ig-point-label \{ display: none; \}/);
  });
});
