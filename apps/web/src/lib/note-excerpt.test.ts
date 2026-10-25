import { expect, it } from 'vitest';
import { noteExcerpt } from './note-excerpt.js';

it('reads the opening of a note as plain text, without a repeated title heading, marks, images or code', () => {
  const body = '# My note\n\n![cover](cover.png)\n\n> A **quoted** line with a [link](x.md) and `code`.\n\n```sh\nrm -rf nothing\n```\n\n- [ ] first task\n';
  expect(noteExcerpt(body, 'My note')).toBe('A quoted line with a link and code. first task');
});

it('keeps a heading that says something else, drops rules, and cuts long text with an ellipsis', () => {
  expect(noteExcerpt('## Summary\n\n---\n\nBody', 'Other')).toBe('Summary Body');
  const cut = noteExcerpt('word '.repeat(100), '', 40);
  expect(cut.length).toBeLessThanOrEqual(41);
  expect(cut.endsWith('…')).toBe(true);
});

it('is empty for a note with no text', () => {
  expect(noteExcerpt('\n\n```\ncode only\n```\n')).toBe('');
});
