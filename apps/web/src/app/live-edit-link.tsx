import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { asksLiveEdit, searchWithoutLiveEdit } from '../lib/live-edit-url.js';
import { isFocusNoteState } from '../lib/routes.js';
import { useCurrentEntry } from './current-entry.js';

interface LiveEditLink {
  /** The `noteRefKey` of the note the address asks to edit live (`?edit`), once its editor shows it; null otherwise. */
  target: string | null;
  /** Takes the request for the note `key`: true once per arrival, when `edit` leaves the address. */
  claim: (key: string) => boolean;
}

const LiveEditLinkContext = createContext<LiveEditLink | null>(null);

/** Where the note the address names shows now: the inputs of {@link liveEditLinkTarget}. */
export interface LiveEditLinkArrival {
  /** The query of the page's address. */
  search: string;
  /** The state of the page's history entry, which marks an address the Focus gave its note. */
  state: unknown;
  /** The note the address names, once read. */
  routedNote: NoteRef | null;
  /** Whether zoom shows the routed note. */
  zoomOpen: boolean;
  /** Whether the address is one the Focus shows its note at, and whether the note it names still waits to open there. */
  inFocus: boolean;
  focusPending: boolean;
  /** The note the Focus's active pane shows. */
  activeNotePath: string | undefined;
}

/**
 * The note an `?edit` address asks to edit live, once an editor shows it where 編輯 works: zoom, or the Focus's active
 * pane after the Focus settled on it and marked the address as its own (so that Back returns there, not to zoom). Null
 * while the note loads or opens, and for an address without `edit`.
 */
export function liveEditLinkTarget({ search, state, routedNote, zoomOpen, inFocus, focusPending, activeNotePath }: LiveEditLinkArrival): string | null {
  if (!routedNote || !asksLiveEdit(search)) return null;
  const shown = zoomOpen || (inFocus && !focusPending && activeNotePath === routedNote.path && isFocusNoteState(state));
  return shown ? noteRefKey(routedNote) : null;
}

/**
 * Carries a note address's `?edit` request to the note's editor (`useLiveEdit`), which checks the note out as 編輯 does:
 * in zoom at once, from a Focus pane (a phone's too) by opening zoom. The first editor of the note to claim it takes it,
 * and `edit` leaves the address with a replace that keeps every other part of the query, the hash and the entry's
 * state, so a reload or Back does not check it out again. An editor that cannot edit live (a reader, a deployment
 * without a live editor, a note kind it does not take) never claims it, and the address keeps `edit`.
 */
export function LiveEditLinkProvider({ target, children }: { target: string | null; children: ReactNode; }) {
  const location = useLocation(), navigate = useNavigate();
  const isCurrent = useCurrentEntry();
  const latest = useRef({ location, target });
  useLayoutEffect(() => {
    latest.current = { location, target };
  });
  /** The history entry whose request was taken. */
  const claimed = useRef<string | null>(null);
  const claim = useCallback((key: string) => {
    const { location: at, target: asked } = latest.current;
    // A request answers the entry it was read from only, never a newer one the person moved to meanwhile.
    if (asked !== key || claimed.current === at.key || !isCurrent(at.key)) return false;
    claimed.current = at.key;
    void navigate({ pathname: at.pathname, search: searchWithoutLiveEdit(at.search), hash: at.hash }, { replace: true, state: at.state });
    return true;
  }, [navigate, isCurrent]);
  const value = useMemo(() => ({ target, claim }), [target, claim]);
  return <LiveEditLinkContext.Provider value={value}>{children}</LiveEditLinkContext.Provider>;
}

/** The `?edit` request of the page's address; null outside {@link LiveEditLinkProvider} (an editor embedded on its own). */
export function useLiveEditLink(): LiveEditLink | null {
  return useContext(LiveEditLinkContext);
}
