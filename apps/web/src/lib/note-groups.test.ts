import { expect, it } from 'vitest';
import { noteFolderGrouping } from './note-groups.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { FolderItem } from './types.js';

const folders: FolderItem[] = [{ notebookId: 'nb', path: 'projects', title: 'Projects', order: 0 }, { notebookId: 'nb', path: 'projects/ideas', title: 'Ideas', order: 0 }, { notebookId: 'other', path: 'projects', title: 'Elsewhere', order: 0 }];
const note = (path: string): NoteListItem => ({ id: path, path, notebookId: 'nb', title: path, tags: [], metadata: {} });

it('names a folder by its titles below the notebook root, and the root by the given label', () => {
  const groupOf = noteFolderGrouping({ notebookRoot: 'notes/nb/', selectedFolder: null, folders, notebookId: 'nb', selectedLabel: 'Notebook' });
  expect(groupOf(note('notes/nb/a.md'))).toEqual({ key: '', label: 'Notebook' });
  expect(groupOf(note('notes/nb/projects/ideas/b.md'))).toEqual({ key: 'projects/ideas', label: 'Projects / Ideas' });
  expect(groupOf(note('notes/nb/untitled/c.md'))).toEqual({ key: 'untitled', label: 'untitled' });
});

it('names folders relative to the selected folder, whose own notes take its label', () => {
  const groupOf = noteFolderGrouping({ notebookRoot: 'notes/nb', selectedFolder: 'projects', folders, notebookId: 'nb', selectedLabel: 'Projects' });
  expect(groupOf(note('notes/nb/projects/a.md'))).toEqual({ key: 'projects', label: 'Projects' });
  expect(groupOf(note('notes/nb/projects/ideas/b.md'))).toEqual({ key: 'projects/ideas', label: 'Ideas' });
});
