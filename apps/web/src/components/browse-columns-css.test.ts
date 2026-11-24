import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, 'browse-columns.css'), 'utf8');
const split = fs.readFileSync(path.resolve(__dirname, 'kanban-focus-split.css'), 'utf8');
const rules = [...(css + split).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: body!.trim() }));
const rule = (selector: string) => rules.find(candidate => candidate.selector === selector)?.body ?? '';

describe('the board beside the Focus', () => {
  it('takes the space beside notebooks at full height, with zero width reserved for an absent Focus', () => {
    const board = rule('.kanban-focus-split[data-board]');
    expect(board).toMatch(/flex:\s*1 1 0%/);
    expect(board).toContain('grid-template-columns: minmax(0, 100fr) 0px minmax(0, 0fr)');
    expect(board).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(rule('.kanban-focus-split[data-split]')).toContain('grid-template-columns: minmax(0, var(--kanban-board-share)) 8px minmax(0, var(--kanban-focus-share))');
    expect(rule('.kanban-focus-split[data-board] > .browse-column-note')).toMatch(/grid-column:\s*3/);
    expect(rule('.kanban-focus-divider')).toMatch(/cursor:\s*col-resize/);
    expect(rule('.browse-column[hidden]')).toMatch(/display:\s*none/);
  });

  // Boss review (A1): beside the count, the view switch and the toggle, the path had ~85px and cut 「Examples」 to 「Exa…」.
  it('gives the list path the header beside a note: the count shows only across the note column, and a folder gives way before the notebook', () => {
    expect(rule('.kanban-focus-split:not([data-board]) .browse-list-count')).toMatch(/display:\s*none/);
    expect(rule('.browse-list-path > span:first-child')).toMatch(/flex:\s*0 0 auto;\s*max-width:\s*60%/);
    expect(rule('.browse-list-path > .browse-list-segment')).toMatch(/flex:\s*0 100 auto/);
  });

  it('keeps the list column its own width beside a note, and the notebooks rail narrow', () => {
    expect(rule('.browse-column-list')).toMatch(/flex:\s*0 0 var\(--browse-list-width\)/);
    expect(rule(".browse-columns[data-notebooks='rail'] .browse-column-notebooks")).toMatch(/flex-basis:\s*var\(--browse-rail-width\)/);
  });
});

// Boss report: hovering the open notebook's tile on the rail turned its fill to the hover grey under the dark text it keeps on the accent,
// so its initial all but vanished.
describe('the rail notebook tiles', () => {
  it("keeps the open notebook's tile on the accent under the pointer", () => {
    expect(rule('.browse-rail-notebook:hover:not(:disabled)')).toBe('');
    expect(rule(".browse-rail-notebook:hover:not(:disabled):not([aria-current='true'])")).toMatch(/background:\s*var\(--workspace-selection\)/);
  });
});
