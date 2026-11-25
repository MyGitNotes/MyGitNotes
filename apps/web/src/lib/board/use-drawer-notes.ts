import { useMemo } from 'react';
import { type NoteListItem, type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { useNoteList, useNoteLookup, useNotePaths } from '../use-note-queries.js';

export interface DrawerNotes {
  notes: NoteListItem[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/**
 * The notes the 筆記庫 drawer searches, as the Notes page searches them (`q` over the notebook's visible notes,
 * newest edit first): page by page, or, while 「連到選取的卡片」 is on (`linked`), every match among the linked notes
 * at once, since those are few and may lie on any page of the search.
 */
export function useDrawerNotes(notebookId: string, q: string, linked: ReadonlySet<string> | null): DrawerNotes {
  const query = { notebookId, q, showHidden: false };
  const list = useNoteList(linked ? null : query);
  const paths = useNotePaths(linked ? query : null);
  const refs = useMemo<NoteRef[]>(() => linked ? paths.notes.filter(note => linked.has(noteRefKey(note))) : [], [linked, paths.notes]);
  const lookup = useNoteLookup(refs, false);
  const found = useMemo(() => {
    const byKey = new Map(lookup.notes.map(note => [noteRefKey(note), note]));
    return refs.flatMap(ref => byKey.get(noteRefKey(ref)) ?? []);
  }, [refs, lookup.notes]);
  if (linked) return { notes: found, loading: paths.loading || (refs.length > 0 && lookup.loading), error: paths.error || lookup.error, hasMore: false, loadingMore: false, loadMore: () => {} };
  return { notes: [...list.uncommitted, ...list.notes], loading: list.loading, error: list.error, hasMore: list.hasMore, loadingMore: list.loadingMore, loadMore: list.loadMore };
}
