import { expect, it } from 'vitest';
import { assertInWriteScope, inWriteScope, NO_WRITE_SCOPE, scopeNotes, type WriteScope } from './write-scope.js';

const note = (path: string, notebookId = 'nb') => ({ notebookId, path });
const scope: WriteScope = { open: note('notes/a.md'), allowed: [note('notes/b.md'), note('notes/a.md')] };

it('lists the open note first and each note once', () => {
  expect(scopeNotes(scope)).toEqual([note('notes/a.md'), note('notes/b.md')]);
  expect(scopeNotes(NO_WRITE_SCOPE)).toEqual([]);
});

it('takes a note in scope only by the same notebook and the same path', () => {
  expect(inWriteScope(scope, note('notes/a.md'))).toBe(true);
  expect(inWriteScope(scope, note('notes/b.md'))).toBe(true);
  expect(inWriteScope(scope, note('notes/a.md', 'other'))).toBe(false);
  expect(inWriteScope(scope, note('notes/A.md'))).toBe(false);
  expect(inWriteScope(scope, note('/notes/a.md'))).toBe(false);
  expect(inWriteScope(scope, note('notes/a.md/'))).toBe(false);
  expect(inWriteScope(scope, note('notes'))).toBe(false);
  expect(inWriteScope(scope, note('notes/a.md.bak'))).toBe(false);
  expect(inWriteScope(NO_WRITE_SCOPE, note('notes/a.md'))).toBe(false);
});

it('refuses with a message that names what may change and sends the change back as text', () => {
  expect(() => assertInWriteScope(scope, note('notes/c.md'))).toThrow('You may change only notes/a.md, notes/b.md. Do not change notes/c.md: propose the change as text in your reply');
  expect(() => assertInWriteScope(scope, note('notes/a.md'))).not.toThrow();
});
