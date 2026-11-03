import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'pi-agent.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of the top-level rules written for a selector. */
const rules = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, rule]) => rule!.split(',').some(part => part.trim() === selector)).map(([, , body]) => body!).join(';');

/** A question's options are often sentences; `.ui-button` keeps its label on one line, which ran a long option past the card. */
describe('the agent question card', () => {
  it('wraps a long option inside its button', () => {
    expect(rules('.pi-agent-dialog-options .ui-button')).toMatch(/white-space:\s*normal/);
    expect(rules('.pi-agent-dialog-options .ui-button')).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('wraps a long question heading', () => {
    expect(rules('.pi-agent-dialog h3')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
