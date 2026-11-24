import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const strip = (file: string) => fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of the top-level and layered rules written for exactly `selector`. */
function rules(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, rule]) => rule!.split(',').some(part => part.trim() === selector)).map(([, , body]) => body!);
}
const opacity = (body: string) => Number(/opacity:\s*([\d.]+)/.exec(body)?.[1]);

/**
 * A Kanban card's delete rests at 0.4 opacity and shows fully on hover. The global disabled rule pins every disabled
 * button at 0.45 with `!important`, above that rest, so on a checked-out card the disabled delete looked enabled.
 */
describe('the disabled delete on a Kanban card', () => {
  it('dims its icon well below the enabled delete at rest, by opacity alone so light and dark read the same', () => {
    const icon = rules(strip('workspace.css'), '.kanban-card-delete:disabled > svg');
    expect(icon).toHaveLength(1);
    expect(0.45 * opacity(icon[0]!)).toBeLessThan(0.4 / 1.5);
  });

  it('leaves the global disabled rule for every other button as it was', () => {
    const global = rules(strip('index.css'), 'button:disabled');
    expect(global.join(';')).toMatch(/opacity:\s*0\.45\s*!important/);
  });
});

describe('the board columns', () => {
  const board = strip('components/kanban/kanban.css');
  it('share the width between 180px and 320px each, and fold to a 30px strip', () => {
    const column = rules(board, '.kanban-column').join(';');
    expect(column).toMatch(/flex:\s*1 1 0%/);
    expect(column).toMatch(/min-width:\s*180px/);
    expect(column).toMatch(/max-width:\s*320px/);
    expect(rules(board, '.kanban-strip').join(';')).toMatch(/width:\s*30px/);
  });

  it('let a narrow column drop its own sort and the cards their step arrows, keeping date, open, move and delete', () => {
    expect(board).toMatch(/@container \(max-width: 239px\) \{ \.kanban-column-sort, \.kanban-card-step \{ display: none; \} \}/);
  });
});
