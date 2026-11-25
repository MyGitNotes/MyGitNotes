import type { NotebookConfig, NoteItem } from './types.js';
import { isNoteHidden } from './note-status.js';
import { type LiveFilter, noteMatchesLive, noteSearchTerms, noteTextMatches } from './note-query.js';

export interface NoteFilters {
  /** What the list shows: ordinary notes (the default), outlines or compilations; the in-memory `filterNotes` ignores it. */
  kind?: 'note' | 'compilation' | 'outline';
  notebookId: string;
  folders: string[];
  descendants: boolean;
  tags: string[];
  tagMode: 'any' | 'all';
  q: string;
  status: string | null;
  showHidden: boolean;
  /** Live states to keep (none: every note); see `NoteQuery.live`. */
  live?: LiveFilter[];
}

export function safeFilterPath(value: string): boolean {
  return Boolean(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => Boolean(part) && part !== '.' && part !== '..');
}

export function filterNotes(notes: NoteItem[], filters: NoteFilters): NoteItem[] {
  const { parts, tokens } = noteSearchTerms(filters.q);
  return notes.filter(note => {
    if (!filters.showHidden && isNoteHidden({ ...note.metadata, status: note.status })) return false;
    if (filters.notebookId !== 'all' && note.notebookId !== filters.notebookId) return false;
    if (
      filters.folders.length && !filters.folders.some(folder => {
        const directory = note.path.slice(0, note.path.lastIndexOf('/'));
        return directory === folder || (filters.descendants && directory.startsWith(folder + '/'));
      })
    ) return false;
    if (filters.status && note.status !== filters.status) return false;
    if (filters.tags.length && !(filters.tagMode === 'all' ? filters.tags.every(tag => note.tags.includes(tag)) : filters.tags.some(tag => note.tags.includes(tag)))) return false;
    if (!noteMatchesLive(note, filters.live, tokens)) return false;
    return !parts.length || noteTextMatches([note.title, note.path, note.content, note.status || '', ...note.tags], parts);
  });
}

export function legacyFolderPaths(notebooks: NotebookConfig[], notebookId: string, folder: string | null): string[] {
  const notebook = notebooks.find(item => item.id === notebookId);
  return notebook && folder ? [notebook.root.replace(/\/$/, '') + '/' + folder] : [];
}
