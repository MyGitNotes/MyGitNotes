import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { type NoteListItem, type NoteRef, noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import { boardPanelNote } from '../../lib/board/panel.js';
import { useNoteEditing } from '../../lib/note-editing.js';
import { usePopGuard } from '../../lib/pop-guard.js';
import { boardsQuery } from '../../lib/routes.js';
import type { NotebookConfig } from '../../lib/types.js';

/** What a board's side panel asks of the page around it. */
export interface BoardPanelActions {
  /** The notebook whose current Focus 「開進 Focus」 adds a note to; a note of another notebook cannot go there. */
  focusNotebook: string;
  /** Adds the note as a tab of the active pane of the notebook's current Focus and goes to the Notes page. */
  openInFocus: (note: NoteListItem) => void;
  /** Opens the note in zoom (全螢幕). */
  fullscreen: (note: NoteListItem) => void;
}

/** The history state of the entry opening a card pushed, so ✕ goes back to the entry before it instead of adding one. */
const OPENED = 'boardPanel';

/**
 * The side panel of a board, kept in the address: `&note=<repository path>` names the note it shows. Opening a card
 * pushes a history entry, so Back closes the panel; switching to another card replaces it, and saves the shown
 * editor first, as switching Focus tabs does. Back and Forward wait for the shown note to be saved, wherever they go
 * (`usePopGuard`), the panel taking no input meanwhile (`leaving`); a refused save keeps everything where it is. The
 * history state of the entry (a zoom's trail) is kept.
 */
export function useBoardPanel({ enabled, row, notebooks }: { enabled: boolean; row: CompilationRow | undefined; notebooks: readonly NotebookConfig[]; }) {
  const location = useLocation();
  const navigate = useNavigate();
  const editing = useNoteEditing();
  const query = boardsQuery(location.search);
  const note = enabled && row && query.note ? boardPanelNote(query.note, row, notebooks) : undefined;
  const key = note ? noteRefKey(note) : undefined;
  const [leaving, setLeaving] = useState(false);
  const { flushEditors } = editing;
  const flush = useCallback((keys: string | undefined) => keys ? flushEditors([keys]) : Promise.resolve(true), [flushEditors]);
  const guard = useCallback(async () => {
    setLeaving(true);
    try {
      return await flush(key);
    } finally {
      setLeaving(false);
    }
  }, [flush, key]);
  usePopGuard(key ? guard : undefined);
  const state = location.state && typeof location.state === 'object' ? location.state as Record<string, unknown> : null;
  const searchWith = (change: (query: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search);
    change(next);
    const search = next.toString();
    return { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash };
  };
  const open = async (next: NoteRef) => {
    if (note && sameNote(note, next)) return;
    if (!await flush(key)) return;
    const to = searchWith(search => {
      search.set('note', next.path);
      search.delete('card');
    });
    if (note) navigate(to, { replace: true, state });
    else navigate(to, { state: { ...state, [OPENED]: true } });
  };
  const close = async () => {
    if (!note || !await flush(key)) return;
    if (state?.[OPENED] === true) return navigate(-1);
    navigate(
      searchWith(search => {
        search.delete('note');
        search.delete('card');
      }),
      { replace: true, state },
    );
  };
  /** Saves the shown note's editor before the board opens something elsewhere. */
  const saved = () => flush(key);
  return { note, leaving, open, close, saved };
}
export type BoardPanel = ReturnType<typeof useBoardPanel>;
