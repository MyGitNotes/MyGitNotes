import { expect, it, vi } from 'vitest';
import { noteStatusChange } from './note-mutations.js';
import type { NoteItem } from './types.js';

const note = (extra: Partial<NoteItem> = {}): NoteItem => ({ id: 'notes/life/a.md', path: 'notes/life/a.md', notebookId: 'life', title: 'A', tags: [], metadata: { title: 'A' }, content: '# A\n\nbody\n', status: 'inbox', ...extra });

it('reads the note in full before writing a status from a list row', async () => {
  const read = vi.fn().mockResolvedValue(note());
  const change = await noteStatusChange(read, { notebookId: 'life', path: 'notes/life/a.md' }, 'done', 'unreadable');
  expect(read).toHaveBeenCalledWith({ notebookId: 'life', path: 'notes/life/a.md' });
  expect(change).toEqual({ path: 'notes/life/a.md', notebookId: 'life', content: '# A\n\nbody\n', metadata: { title: 'A', status: 'done' } });
});

it('archives and unarchives through the same metadata rules as the editor', async () => {
  expect((await noteStatusChange(async () => note(), { notebookId: 'life', path: 'notes/life/a.md' }, 'archived', 'unreadable')).metadata).toMatchObject({ status: 'archived', hiden: true });
  expect((await noteStatusChange(async () => note({ status: 'archived', metadata: { hiden: true } }), { notebookId: 'life', path: 'notes/life/a.md' }, 'inbox', 'unreadable')).metadata).toMatchObject({ status: 'inbox', hiden: false });
});

it('writes nothing when the note cannot be read', async () => {
  const read = vi.fn().mockRejectedValue(new Error('The full note could not be read (notes/life/a.md); nothing was changed.'));
  await expect(noteStatusChange(read, { notebookId: 'life', path: 'notes/life/a.md' }, 'done', 'unreadable')).rejects.toThrow('nothing was changed');
});

it('refuses a status change, without writing, when the note opens with frontmatter that cannot be read', async () => {
  const reason = 'The frontmatter cannot be read';
  await expect(noteStatusChange(async () => note(), { notebookId: 'life', path: 'notes/life/a.md', frontmatterInvalid: true }, 'done', reason)).rejects.toThrow(reason);
  const read = vi.fn().mockResolvedValue(note({ frontmatterInvalid: true, metadata: {}, status: undefined, content: '---\ntitle: A\n----\n# A\n' }));
  await expect(noteStatusChange(read, { notebookId: 'life', path: 'notes/life/a.md' }, 'done', reason)).rejects.toThrow(reason);
});
