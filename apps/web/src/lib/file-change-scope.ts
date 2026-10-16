import type { FileCommand, FolderCommand } from '@mygitnotes/core';
import { type FocusPage, relocateFocusPaths } from '@mygitnotes/core/focus-page';
import { baseName, parentPath } from './paths.js';

/**
 * The paths of one notebook a file change writes, moves or removes (files, or folders with all they hold). Only drafts
 * under them are stranded by the change, except the `carried` ones it moves along itself.
 */
export interface FileChangeScope {
  notebookId: string;
  paths: string[];
  carried?: string[];
}

/**
 * What a file manager command touches: its path, and the new path a move fills. Removing a folder moves what it holds
 * into an existing folder, whose own notes stay where they are.
 */
export function fileCommandScope(command: FileCommand): FileChangeScope {
  const paths = command.kind === 'metadata' ? [`${command.path}/_dir.yml`] : command.kind === 'move' ? [command.path, command.destination] : [command.path];
  return { notebookId: command.notebookId, paths };
}

/**
 * What a folder command touches: nothing for a new folder or a reorder among the same siblings, else the folder, and
 * where a move puts it (a draft there can only be a note never committed, which the move would collide with).
 */
export function folderCommandScope(command: FolderCommand, root: string): FileChangeScope {
  const base = root.replace(/\/$/, '');
  if (command.kind === 'delete') return { notebookId: command.notebookId, paths: [`${base}/${command.path}`] };
  if (command.kind === 'create' || parentPath(command.path) === command.parent) return { notebookId: command.notebookId, paths: [] };
  return { notebookId: command.notebookId, paths: [`${base}/${command.path}`, `${base}/${command.parent ? `${command.parent}/` : ''}${baseName(command.path)}`] };
}

/**
 * What a change would strand: the `drafts` (note paths with a staged or unsaved draft) under its paths, except the ones
 * it carries, and the pending Focus `documents` that name one of those paths, by file.
 */
export function strandedDrafts(scope: FileChangeScope, drafts: readonly string[], documents: readonly { file: string; page: unknown; }[]): string[] {
  const affected = (path: string) => scope.paths.some(target => path === target || path.startsWith(target + '/'));
  const notes = drafts.filter(path => affected(path) && !scope.carried?.includes(path));
  const names = (page: unknown) => Boolean(page) && relocateFocusPaths(structuredClone(page) as FocusPage, scope.notebookId, path => affected(path) ? '' : path);
  const files = documents.filter(document => names(document.page)).map(document => document.file);
  return [...new Set([...notes, ...files])];
}
