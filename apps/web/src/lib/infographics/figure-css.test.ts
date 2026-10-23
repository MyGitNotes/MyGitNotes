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
});
