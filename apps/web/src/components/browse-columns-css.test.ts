import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, 'browse-columns.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector!.replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: body!.trim() }));
const rule = (selector: string) => rules.find(candidate => candidate.selector === selector)?.body ?? '';

/**
 * The Kanban board used to dock above a Focus, 280px tall, where the filter chips took half the dock and left the columns without room for a
 * card. Now the board, like the table, spans the list and note columns and takes the page's full height; the note column waits out of sight.
 */
describe('the board and the table across the note column', () => {
  it('lets the merged list column take the room the note column leaves', () => {
    expect(rule('.browse-columns[data-merged] .browse-column-list')).toMatch(/flex:\s*1 1 0%/);
    expect(rule('.browse-column[hidden]')).toMatch(/display:\s*none/);
  });

  // Boss review (A1): beside the count, the view switch and the toggle, the path had ~85px and cut 「Examples」 to 「Exa…」.
  it('gives the list path the header beside a note: the count shows only across the note column, and a folder gives way before the notebook', () => {
    expect(rule('.browse-columns:not([data-merged]) .browse-list-count')).toMatch(/display:\s*none/);
    expect(rule('.browse-list-path > span:first-child')).toMatch(/flex:\s*0 0 auto;\s*max-width:\s*60%/);
    expect(rule('.browse-list-path > .browse-list-segment')).toMatch(/flex:\s*0 100 auto/);
  });

  it('keeps the list column its own width beside a note, and the notebooks rail narrow', () => {
    expect(rule('.browse-column-list')).toMatch(/flex:\s*0 0 var\(--browse-list-width\)/);
    expect(rule(".browse-columns[data-notebooks='rail'] .browse-column-notebooks")).toMatch(/flex-basis:\s*var\(--browse-rail-width\)/);
  });
});
