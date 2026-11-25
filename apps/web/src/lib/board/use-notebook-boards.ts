import { useEffect, useMemo } from 'react';
import { type CompilationRow, isBoardRow } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { parseCompilationNote } from '../compilation-rows.js';
import type { NotebookConfig } from '../types.js';
import { useNoteList } from '../use-note-queries.js';

/**
 * Every compilation of a notebook with its text, read whole (page after page) with this page's working changes: the
 * 白板 page's list, the former graph addresses it redirects, and a side panel's 「在 N 塊白板上」 read the same query.
 * `boards` holds the rows of the ones that open and are boards (`isBoardRow`); null while the list is still being read.
 */
export function useNotebookBoards(notebookId: string | null, notebooks: readonly NotebookConfig[]): { entries: NoteListItem[] | null; boards: CompilationRow[] | null; error: string; } {
  const list = useNoteList(notebookId ? { notebookId, kind: 'compilation', showHidden: true, sort: 'updated', order: 'desc' } : null, { content: true });
  const { hasMore, loadingMore, loadMore } = list;
  useEffect(() => {
    if (hasMore && !loadingMore) loadMore();
  }, [hasMore, loadingMore, loadMore]);
  const done = !list.loading && !hasMore;
  const entries = useMemo(() => done ? [...list.notes, ...list.uncommitted] : null, [done, list.notes, list.uncommitted]);
  const boards = useMemo(() => entries ? entries.flatMap(entry => parseCompilationNote(entry, notebooks).row ?? []).filter(isBoardRow) : null, [entries, notebooks]);
  return { entries, boards, error: list.error };
}
