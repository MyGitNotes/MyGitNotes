import { boardCompilation, CompilationError, type CompilationFile, compilationFile, type CompilationRow, compilationRow, isFileItem, parseCompilation, serializeCompilation } from '@mygitnotes/core/compilation';
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
  /** Why the row may be drawn but not written: its legacy graph layout places more notes than a board holds, so writing it as a board would lose positions. */
  upgradeLoss?: string;
}

/** The repository a notebook key names; bare local ids, as a single-repository workspace may hold, share one. */
const repositoryOf = (notebookId: string) => parseNotebookKey(notebookId)?.alias ?? '';

/** The notebooks of the repository `notebookId` belongs to, that one first: where a compilation's items may come from. */
export function repositoryNotebooks<T extends Pick<NotebookConfig, 'id'>>(notebooks: readonly T[], notebookId: string): T[] {
  const repository = repositoryOf(notebookId);
  const scope = notebooks.filter(candidate => repositoryOf(candidate.id) === repository);
  return [...scope.filter(candidate => candidate.id === notebookId), ...scope.filter(candidate => candidate.id !== notebookId)];
}

/**
 * Whether a file or folder item lies outside the root of the notebook it was given: a path in no notebook falls
 * back to the owner's, and a folder there, or one above a root, would list nothing or the whole notebook.
 * An unknown notebook is left to the lookup.
 */
export function outsideNotebook(item: { kind: string; notebookId?: string; path?: string; }, notebooks: readonly Pick<NotebookConfig, 'id' | 'root'>[]): boolean {
  if (item.kind === 'youtube' || item.kind === 'heading' || item.path === undefined) return false;
  const root = notebooks.find(candidate => candidate.id === item.notebookId)?.root;
  return root !== undefined && item.path !== root && !item.path.startsWith(`${root}/`);
}

/** Every notebook a row reads from: its own, its items' and its source's. */
export function compilationNotebookIds(row: CompilationRow | undefined, fallback: string): string[] {
  if (!row) return [fallback];
  const ids = row.kind === 'custom' ? row.items.flatMap(item => isFileItem(item) ? [item.notebookId] : []) : [row.source.notebookId];
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
    // A file in the graph arrangement it replaces opens as a board; the next write of the compilation writes the board and drops `graph`.
    const file = parseCompilation(note.content, scope.map(candidate => candidate.root));
    const upgraded = boardCompilation(file);
    const loss = upgradeLoss(file, upgraded);
    return { ...base, row: compilationRow(upgraded, { notebookId: note.notebookId, path: note.path }, notebookOf), ...(loss ? { upgradeLoss: loss } : {}) };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Why writing a legacy graph layout as a board would lose positions, if it would: the layout places more notes than a
 * board holds (a legacy layout may name 5,000 paths, a board 2,000 cards). The board still draws what fits.
 */
function upgradeLoss(file: CompilationFile, upgraded: CompilationFile): string | undefined {
  if (file.board || !file.graph) return undefined;
  const paths = new Set(file.graph.nodes.map(node => node.path));
  const placed = file.items ? file.items.filter(item => item.kind !== 'heading' && item.kind !== 'youtube' && paths.has(item.path)).length : paths.size;
  const kept = upgraded.board?.cards?.length ?? 0;
  return placed > kept ? `${file.title}: not saved, its legacy graph layout places ${placed} notes and a whiteboard keeps ${kept}; remove positions from its graph section first` : undefined;
}

/** The YAML a row is stored as. */
export const compilationText = (row: CompilationRow) => serializeCompilation(compilationFile(row));

/**
 * `text` when the file it makes would open again, else a `CompilationError` naming `title`: a file over the 512 KiB cap
 * (a legacy graph layout written as a board's one-line entries can grow past it) or outside the schema is not written,
 * and the stored file stays as it is.
 */
export function openableCompilationText(text: string, title: string): string {
  try {
    parseCompilation(text);
  } catch (error) {
    throw new CompilationError(`${title}: not saved, the file would not open (${error instanceof Error ? error.message : String(error)})`);
  }
  return text;
}

/** The YAML a row is written as, refused as `openableCompilationText` refuses it. */
export const writableCompilationText = (row: CompilationRow): string => openableCompilationText(compilationText(row), row.name);

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
