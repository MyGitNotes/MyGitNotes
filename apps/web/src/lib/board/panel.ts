import type { CompilationRow } from '@mygitnotes/core/compilation';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { notebookOfPath } from '@mygitnotes/core/workspace-links';
import type { NotebookConfig } from '../types.js';

const repositoryOf = (notebookId: string) => parseNotebookKey(notebookId)?.alias ?? '';

/**
 * The note a board's side panel names by its repository path (`&note=`): a custom board's item names its notebook;
 * otherwise (a dynamic board's member, or an item since removed) the notebook of the board's repository whose root
 * holds the path. Undefined for a path in no such notebook.
 */
export function boardPanelNote(path: string, row: CompilationRow, notebooks: readonly NotebookConfig[]): NoteRef | undefined {
  const item = row.kind === 'custom' ? row.items.find(candidate => candidate.kind === 'note' && candidate.path === path) : undefined;
  if (item && 'notebookId' in item) return { notebookId: item.notebookId, path };
  const repository = repositoryOf(row.notebookId);
  const notebook = notebookOfPath(path, notebooks.filter(candidate => repositoryOf(candidate.id) === repository));
  return notebook ? { notebookId: notebook.id, path } : undefined;
}

/**
 * The key of a note's card on a board (`&card=`), as the board draws it: a custom item's id, or the id a dynamic
 * compilation derives for a member from its own id and the member's path. Undefined when a custom board pins no such note.
 */
export function boardCardKey(row: CompilationRow, note: NoteRef): string | undefined {
  if (row.kind === 'dynamic') return `dynamic:${row.id}:${note.path}`;
  return row.items.find(item => item.kind === 'note' && item.notebookId === note.notebookId && item.path === note.path)?.id;
}
