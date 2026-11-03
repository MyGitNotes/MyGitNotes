import { useCallback, useEffect, useState } from 'react';
import type { useLocation, useNavigate } from 'react-router-dom';
import type { parseWorkspaceRoute } from '../lib/routes.js';
import type { NoteItem } from '../lib/types.js';
import type { useFocusPanes } from './useFocusPanes.js';

/**
 * The note a page load's URL names as a link to it (typed, pasted, or opened in a new tab): its note route with no
 * `returnTo`. A route the app navigated to itself to zoom a note carries `returnTo`, so a reload of zoom stays zoom.
 */
function linkedNoteOf(location: ReturnType<typeof useLocation>, editorRoute: ReturnType<typeof parseWorkspaceRoute>): string | null {
  return editorRoute.tab === 'notes' && editorRoute.note && !new URLSearchParams(location.search).has('returnTo') ? editorRoute.note : null;
}

/** Whether the page was loaded on a note's link, which waits to open in the Focus instead of zoom; read before the Focus so it restores the one displayed last. */
export function useNoteLinkLoad(location: ReturnType<typeof useLocation>, editorRoute: ReturnType<typeof parseWorkspaceRoute>) {
  const [linked, setLinked] = useState(() => linkedNoteOf(location, editorRoute));
  // Leaving the note before it opened (or a redirect to another note) drops the request; a redirect that only rewrites the notebook keeps it.
  const pending = linked !== null && editorRoute.note === linked;
  const settle = useCallback(() => setLinked(null), []);
  useEffect(() => {
    if (linked !== null && !pending) settle();
  }, [linked, pending, settle]);
  return { pending, settle };
}

interface Params {
  link: ReturnType<typeof useNoteLinkLoad>;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  routedNote: NoteItem | null;
  routeError: string;
  noteFocus: ReturnType<typeof useFocusPanes>['noteFocus'];
  selectedNotebookId: string;
  /** The browse view behind the note, where the Focus is shown. */
  returnTo: string;
  setFocusNarrowView: ReturnType<typeof useFocusPanes>['setFocusNarrowView'];
}

/** Opens a linked note as a tab of the active Focus and shows that Focus; when the Focus cannot take it, the note stays in zoom as before. */
export function useOpenNoteLinkInFocus({ link, location, navigate, routedNote, routeError, noteFocus, selectedNotebookId, returnTo, setFocusNarrowView }: Params) {
  const { pending, settle } = link;
  const ready = pending && Boolean(routedNote) && !noteFocus.loading && Boolean(noteFocus.shown && noteFocus.layout);
  /* eslint-disable react-hooks/exhaustive-deps -- The note opens once, when it and the Focus are ready; the Focus callbacks change on every render and must not replay it. */
  useEffect(() => {
    if (!pending) return;
    // A missing note keeps its not-found page. A notebook named by its bare local id is not found until the route is redirected to its key, so that error waits.
    if (routeError && routeError !== 'route.notebookNotFound') return settle();
    if (!ready || !routedNote) return;
    settle();
    // A note of another notebook has no place in this notebook's Focus, so it stays in zoom.
    if (routedNote.notebookId !== selectedNotebookId) return;
    void noteFocus.openNote(routedNote.path).then(result => {
      if (result !== 'opened') return;
      setFocusNarrowView('focus');
      navigate(returnTo + location.hash, { replace: true });
    });
  }, [pending, ready, routeError, routedNote?.path, routedNote?.notebookId, selectedNotebookId]);
  /* eslint-enable react-hooks/exhaustive-deps */
}
