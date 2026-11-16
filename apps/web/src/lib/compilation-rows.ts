import { compilationFile, type CompilationRow, compilationRow, parseCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import type { NotebookConfig } from './types.js';

/** A compilation entry as the browser reads it: its row when the file opens, else why it does not. */
export interface ParsedCompilation {
  path: string;
  notebookId: string;
  title: string;
  /** The file's YAML. */
  content: string;
  row?: CompilationRow;
  error?: string;
}

/** The repository a notebook key names; bare local ids, as a single-repository workspace may hold, share one. */
const repositoryOf = (notebookId: string) => parseNotebookKey(notebookId)?.alias ?? '';

/** The notebooks of the repository `notebookId` belongs to, that one first: where a compilation's items may come from. */
export function repositoryNotebooks<T extends Pick<NotebookConfig, 'id'>>(notebooks: readonly T[], notebookId: string): T[] {
  const repository = repositoryOf(notebookId);
  const scope = notebooks.filter(candidate => repositoryOf(candidate.id) === repository);
  return [...scope.filter(candidate => candidate.id === notebookId), ...scope.filter(candidate => candidate.id !== notebookId)];
}

/** Every notebook a row reads from: its own, its items' and its source's. */
export function compilationNotebookIds(row: CompilationRow | undefined, fallback: string): string[] {
  if (!row) return [fallback];
  const ids = row.kind === 'custom' ? row.items.flatMap(item => item.kind === 'youtube' ? [] : [item.notebookId]) : [row.source.notebookId];
  return [...new Set([row.notebookId, ...ids])];
}

/** Parses the YAML of a compilation entry listed or looked up with its content. */
export function parseCompilationNote(note: Pick<NoteListItem, 'path' | 'notebookId' | 'title' | 'content' | 'invalid'>, notebooks: readonly NotebookConfig[]): ParsedCompilation {
  const base = { path: note.path, notebookId: note.notebookId, title: note.title, content: note.content ?? '' };
  const notebook = notebooks.find(candidate => candidate.id === note.notebookId);
  if (!notebook) return { ...base, error: `Notebook ${note.notebookId} is not configured.` };
  // A file the catalog marks invalid (a duplicate id, a folder source outside every notebook) opens to the error, even though its text is readable.
  if (note.invalid) return { ...base, error: note.invalid };
  if (typeof note.content !== 'string') return { ...base, error: note.invalid };
  // Items may lie in any notebook of the compilation's repository, never in another repository's, whatever its roots.
  const repository = repositoryOf(note.notebookId);
  const scope = notebooks.filter(candidate => repositoryOf(candidate.id) === repository);
  const notebookOf = (path: string) => scope.find(candidate => path === candidate.root || path.startsWith(`${candidate.root}/`))?.id;
  try {
    return { ...base, row: compilationRow(parseCompilation(note.content, scope.map(candidate => candidate.root)), { notebookId: note.notebookId, path: note.path }, notebookOf) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The YAML a row is stored as. */
export const compilationText = (row: CompilationRow) => serializeCompilation(compilationFile(row));

/** What the note actions carry beside the YAML: the title, tags and status shown in listings. */
export const compilationMetadata = (row: CompilationRow) => ({ title: row.name, tags: row.tags ?? [], ...(row.status ? { status: row.status } : {}) });

export interface CompilationWrites {
  /** Rows whose file exists and changed. */
  save: CompilationRow[];
  /** Rows with no file yet; their `path` names where it goes. */
  create: CompilationRow[];
  /** Paths of files that left the page. */
  remove: string[];
}

/** What turning the rows `before` into `after` takes. Rows are told apart by path; a row without one is new. */
export function planCompilationWrites(before: readonly CompilationRow[], after: readonly CompilationRow[]): CompilationWrites {
  const stored = new Map(before.map(row => [row.path, row]));
  const kept = new Set<string>();
  const writes: CompilationWrites = { save: [], create: [], remove: [] };
  for (const row of after) {
    const previous = row.path ? stored.get(row.path) : undefined;
    if (!previous) {
      writes.create.push(row);
      continue;
    }
    kept.add(row.path);
    if (compilationText(previous) !== compilationText(row)) writes.save.push(row);
  }
  for (const row of before) if (!kept.has(row.path)) writes.remove.push(row.path);
  return writes;
}
