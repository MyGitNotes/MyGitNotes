import { expect, it } from 'vitest';
import { stagedNoteFields } from './staged-note.js';
import type { NoteItem } from './types.js';

const broken = '---\ntitle: C\nstatus: draft\n----\n# C\n';
const original: NoteItem = { id: 'notes/c.md', path: 'notes/c.md', notebookId: 'life', title: 'C', tags: [], metadata: {}, content: broken, frontmatterInvalid: true };

it('derives the unreadable mark of a staged note from its staged text, not from the note it was copied from', () => {
  const fixed = stagedNoteFields({ ...original, metadata: { status: 'done' }, content: '# C\n' });
  expect(fixed).toMatchObject({ status: 'done' });
  expect(fixed).not.toHaveProperty('frontmatterInvalid');
  expect(stagedNoteFields({ ...original })).toMatchObject({ frontmatterInvalid: true, status: undefined });
  const { frontmatterInvalid: _, ...readable } = original;
  expect(stagedNoteFields({ ...readable, content: broken })).toMatchObject({ frontmatterInvalid: true });
});
