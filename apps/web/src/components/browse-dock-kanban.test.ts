import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, 'browse-dock.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: body!.trim() }));

/**
 * A Focus docks the Kanban board above it and the filters in force show as chips over the board. The top dock stretches
 * the board to its height with `flex: 1`; written for every child it also stretched the chips, which took half of the
 * 280px dock and left the columns without room for a single card (seen in the demo, which opens trpg as Kanban).
 */
describe('top dock with a Kanban board', () => {
  const stretching = rules.filter(rule => rule.selector.includes(':has([data-kanban-columns]) >') && /flex:\s*1/.test(rule.body));

  it('stretches the board only, never every child of the dock', () => {
    expect(stretching.length).toBeGreaterThan(0);
    for (const rule of stretching) expect(rule.selector, rule.selector).toContain(':not(.filter-chips)');
  });

  it('keeps the filter chips at their own height', () => {
    const chips = rules.find(rule => rule.selector.includes(':has([data-kanban-columns]) > .filter-chips'));
    expect(chips?.body).toMatch(/flex:\s*none/);
  });
});
