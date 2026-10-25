// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { mergeNotebookStatuses, STATUS_CYCLE, statusColor } from '@mygitnotes/core/note-status';
import { PALETTE_FAMILIES } from './palettes.js';
import { statusAvoidColor } from './status-color.js';

const AVOIDED: Record<string, string> = { flexoki: 'teal', github: 'blue', catppuccin: 'purple', 'rose-pine': 'purple', gruvbox: 'blue', 'tokyo-night': 'green', carbon: 'blue', solarized: 'blue', everforest: 'green' };

it('names a cycle colour to skip for every theme family', () => {
  expect(PALETTE_FAMILIES.map(family => family.id).sort()).toEqual(Object.keys(AVOIDED).sort());
  for (const family of PALETTE_FAMILIES) expect(statusAvoidColor(family.id), family.id).toBe(AVOIDED[family.id]);
});

it('skips teal for Flexoki and purple for Catppuccin and Rosé Pine, the colours closest to their primaries', () => {
  expect([statusAvoidColor('flexoki'), statusAvoidColor('catppuccin'), statusAvoidColor('rose-pine')]).toEqual(['teal', 'purple', 'purple']);
  expect(statusAvoidColor('no-such-family')).toBe(statusAvoidColor('flexoki'));
});

it('never gives a cycled status the colour closest to the theme primary, nor gray, in any family', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (const family of PALETTE_FAMILIES) {
    const avoid = statusAvoidColor(family.id);
    expect(STATUS_CYCLE, family.id).toContain(avoid);
    const colours = list.map(status => statusColor(status, mergeNotebookStatuses([{ statuses: list }], avoid)));
    expect(colours, family.id).not.toContain(avoid);
    expect(colours, family.id).not.toContain('gray');
    expect(colours, family.id).not.toContain('primary');
  }
});
