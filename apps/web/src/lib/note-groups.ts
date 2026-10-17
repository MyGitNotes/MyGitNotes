import { noteDirectory, type NoteListItem } from '@mygitnotes/core/note-query';
import type { FolderItem } from './types.js';

export interface NoteGroup {
  /** The folder's path within the notebook; '' for the notebook root. */
  key: string;
  label: string;
}

export type NoteGroupOf = (note: NoteListItem) => NoteGroup;

/**
 * Names the folder a note sits in for a list grouped by folder: the folder titles below the selected folder joined by
 * " / ", or `selectedLabel` for notes directly in the selected folder.
 */
export function noteFolderGrouping({ notebookRoot, selectedFolder, folders, notebookId, selectedLabel }: { notebookRoot: string; selectedFolder: string | null; folders: FolderItem[]; notebookId: string; selectedLabel: string; }): NoteGroupOf {
  const root = notebookRoot.replace(/\/$/, '');
  const titles = new Map(folders.filter(folder => folder.notebookId === notebookId).map(folder => [folder.path, folder.title]));
  return note => {
    const directory = noteDirectory(note.path);
    const key = directory === root ? '' : directory.startsWith(root + '/') ? directory.slice(root.length + 1) : directory;
    const base = selectedFolder && (key === selectedFolder || key.startsWith(selectedFolder + '/')) ? selectedFolder : '';
    const rest = key.slice(base.length).replace(/^\//, '');
    if (!rest) return { key, label: selectedLabel };
    const parts = rest.split('/');
    const label = parts.map((part, index) => {
      const path = [base, ...parts.slice(0, index + 1)].filter(Boolean).join('/');
      return titles.get(path) ?? part;
    }).join(' / ');
    return { key, label };
  };
}
