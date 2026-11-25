import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteUpdatedTime } from '@mygitnotes/core/note-sort';

/** One tile of the 白板 page's list, read from a compilation's listing metadata. */
export interface BoardTile {
  path: string;
  notebookId: string;
  title: string;
  description?: string;
  /** A custom board's cards (its content items) and sections (its chapters); a dynamic board's members come from its query, so it counts none. */
  cards?: number;
  sections?: number;
  /** What a dynamic board's cards come from. */
  source?: 'tag' | 'folder';
  /** When the file was last edited, in milliseconds; 0 when nothing says. */
  updated: number;
}

type Metadata = Record<string, unknown>;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * Whether the 白板 page lists a compilation: arranged as a board (or as the graph it replaces), or holding board data
 * in any arrangement, so a board switched to a book or a lane stays in the list (`isBoardRow` reads the same from a row).
 */
export function isListedBoard(metadata: Metadata): boolean {
  return metadata.arrangement === 'board' || metadata.arrangement === 'graph' || (typeof metadata.board === 'object' && metadata.board !== null);
}

/** The boards among a notebook's compilations, newest edit first; a file that does not open is not listed. */
export function boardTiles(entries: readonly NoteListItem[]): BoardTile[] {
  const tiles = entries.filter(entry => entry.kind === 'compilation' && !entry.invalid && isListedBoard(entry.metadata)).map((entry): BoardTile => {
    const metadata = entry.metadata;
    const description = typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description : undefined;
    const dynamic = metadata.sourceKind === 'tag' || metadata.sourceKind === 'folder' ? metadata.sourceKind : undefined;
    return { path: entry.path, notebookId: entry.notebookId, title: entry.title, ...(description ? { description } : {}), ...(dynamic ? { source: dynamic } : { cards: count(metadata.itemCount), sections: count(metadata.chapterCount) }), updated: noteUpdatedTime(entry) };
  });
  return tiles.sort((a, b) => b.updated - a.updated || a.title.localeCompare(b.title));
}

/** Every compilation of a notebook by file id and path, and whether the 白板 page lists it: what a former graph address names (`legacyGraphRoute`). */
export function compilationIndex(entries: readonly NoteListItem[]): { id?: string; path: string; board: boolean; }[] {
  return entries.filter(entry => entry.kind === 'compilation' && !entry.invalid).map(entry => ({ ...(typeof entry.metadata.id === 'string' ? { id: entry.metadata.id } : {}), path: entry.path, board: isListedBoard(entry.metadata) }));
}
