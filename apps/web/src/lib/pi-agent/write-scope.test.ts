import { expect, it } from 'vitest';
import { assertInWriteScope, inWriteNotebook, inWriteScope, NO_WRITE_SCOPE, scopeNotebooks, scopeNotes, type WriteScope, writeScopeRefusal } from './write-scope.js';

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

it('refuses with a message that names what may change and where a note may be created, and sends the change back as text', () => {
  expect(() => assertInWriteScope(scope, note('notes/c.md'))).toThrow('You may change only notes/a.md, notes/b.md. You may also create a note that does not exist yet in notebook nb. Do not change notes/c.md: propose the change as text in your reply');
  expect(() => assertInWriteScope(scope, note('notes/a.md'))).not.toThrow();
  expect(writeScopeRefusal({ open: note('a.md', 'x'), allowed: [note('b.md', 'y'), note('c.md', 'x')] }, note('d.md', 'z')).message).toContain('You may change only a.md, b.md, c.md. You may also create a note that does not exist yet in notebook x, y.');
  expect(writeScopeRefusal(NO_WRITE_SCOPE, note('notes/a.md')).message).toBe('Refused: notes/a.md is not a note the person has put in scope for you. You may change no note now: none is open in their editor. Do not change notes/a.md: propose the change as text in your reply, and the person will apply it.');
});

it('takes a notebook in scope by any note in scope, the open one or a kept one, and no other', () => {
  expect(scopeNotebooks({ open: note('a.md', 'x'), allowed: [note('b.md', 'y'), note('c.md', 'x')] })).toEqual(['x', 'y']);
  expect(inWriteNotebook(scope, 'nb')).toBe(true);
  expect(inWriteNotebook({ open: null, allowed: [note('notes/b.md', 'kept')] }, 'kept')).toBe(true);
  expect(inWriteNotebook(scope, 'other')).toBe(false);
  expect(inWriteNotebook(scope, 'NB')).toBe(false);
  expect(inWriteNotebook(NO_WRITE_SCOPE, 'nb')).toBe(false);
  // A notebook in scope makes no note of it in scope: creating is decided apart from changing.
  expect(inWriteScope(scope, note('notes/new.md'))).toBe(false);
});
