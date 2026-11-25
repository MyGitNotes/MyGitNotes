import type { QueryClient } from '@tanstack/react-query';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import { overlayDraftLookup, overlayDraftPaths } from './draft-overlay.js';
import { noteDrafts } from './note-templates.js';
import { noteLookupOptions, notePathsOptions, noteQueryInput, type NoteQueryScope, useNoteList, useNoteLookup, useNotePaths } from './use-note-queries.js';

/** Whether a dynamic lane follows the order the user set by hand. */
function isManual(row: CompilationRow | undefined): boolean {
  return row?.kind === 'dynamic' && row.sort?.field === 'manual';
}

/** The server query a dynamic lane's membership comes from; its filter mirrors `compilationNotes`. With chapters by folder the server pages in chapter order, so a later page never lands before a chapter already shown. */
export function laneNoteQuery(row: CompilationRow): Partial<NoteQuery> | null {
  if (row.kind !== 'dynamic') return null;
  const source = row.source;
  return { notebookId: source.notebookId, tags: source.kind === 'tag' ? [source.tag] : [], folders: source.kind === 'folder' ? [source.path] : [], descendants: source.kind === 'folder' ? source.recursive : true, status: row.study?.status || null, showHidden: false, sort: !row.sort || row.sort.field === 'manual' ? 'title' : row.sort.field, order: row.sort?.order || 'asc', ...(row.group ? { group: row.group } : {}) };
}

/** Reads the full, unfiltered membership on demand, with the same paths → lookup and draft overlay as the order dialog. */
export async function readLaneMembers(client: QueryClient, scope: NoteQueryScope, row: Extract<CompilationRow, { kind: 'dynamic'; }>): Promise<NoteListItem[] | null> {
  const input = noteQueryInput(laneNoteQuery({ ...row, study: undefined })!);
  const { notes: paths } = await client.fetchQuery(notePathsOptions(scope, input));
  const refs = overlayDraftPaths(paths, input, noteDrafts(scope.drafts));
  if (!refs.length) return [];
  const { notes } = await client.fetchQuery(noteLookupOptions(scope, refs, false));
  const members = overlayDraftLookup(refs, notes, scope.drafts);
  // A live note may disappear between the paths read and the lookup. Do not save a partial snapshot.
  return members.length === refs.length ? members : null;
}

export interface LaneNotes {
  notes: NoteListItem[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/**
 * A lane's notes: a dynamic lane queries the server, a custom lane reads its pinned paths.
 * `all` skips paging for a study session, which needs the whole queue to order it.
 */
export function useLaneNotes(row: CompilationRow | undefined, requested: { content?: boolean; all?: boolean; } = {}): LaneNotes {
  // A manual order can place any member first, so it needs every member rather than the first page.
  const options = { ...requested, all: requested.all || isManual(row) };
  const dynamic = row?.kind === 'dynamic' ? laneNoteQuery(row) : null;
  const paged = useNoteList(options.all ? null : dynamic, { content: options.content });
  const allPaths = useNotePaths(options.all ? dynamic : null);
  // A note pinned as several sections is looked up once.
  const pinned = row?.kind === 'custom' ? [...new Map(row.items.flatMap(item => item.kind === 'note' ? [[JSON.stringify([item.notebookId, item.path]), { notebookId: item.notebookId, path: item.path }] as const] : [])).values()] : [];
  const lookupNotes = row?.kind === 'custom' ? pinned : (options.all ? allPaths.notes : []);
  const lookup = useNoteLookup(lookupNotes, Boolean(options.content));
  if (row?.kind === 'custom' || options.all) {
    return { notes: lookup.notes, loading: allPaths.loading || lookup.loading, error: allPaths.error || lookup.error, hasMore: false, loadingMore: false, loadMore: () => {} };
  }
  return { notes: [...paged.uncommitted, ...paged.notes], loading: paged.loading, error: paged.error, hasMore: paged.hasMore, loadingMore: paged.loadingMore, loadMore: paged.loadMore };
}
