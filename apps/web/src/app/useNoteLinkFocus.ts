import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { matchPath, useNavigationType } from 'react-router-dom';
import { useCurrentEntry } from './current-entry.js';
import type { useLocation, useNavigate } from 'react-router-dom';
import { findFocusTabInPane, focusPanes, focusTabKey } from '@mygitnotes/core/focus-page';
import { noteRefKey } from '@mygitnotes/core/note-query';
import type { FrameSelection } from '../components/note-editor/types.js';
import { type EditorMode, searchWithEditorMode } from '../lib/editor-mode-url.js';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { FOCUS_NOTE_STATE, isFocusNoteState, noteRoute, type parseWorkspaceRoute } from '../lib/routes.js';
import type { NoteItem } from '../lib/types.js';
import type { OpenResult } from '../lib/use-note-focus.js';
import { usePhone } from '../lib/use-phone.js';
import type { useFocusPanes } from './useFocusPanes.js';

/**
 * The note a note route names when it is no zoom: zoom carries `returnTo` (the app opened it) or `?zoom` (a link asked
 * for it). Such a route is a note's own link (typed, pasted or opened in a new tab) or the address the Focus gave its note.
 */
function routeNoteOf(location: ReturnType<typeof useLocation>, editorRoute: ReturnType<typeof parseWorkspaceRoute>): string | null {
  const query = new URLSearchParams(location.search);
  return editorRoute.tab === 'notes' && editorRoute.note && !query.has('returnTo') && !query.has('zoom') ? editorRoute.note : null;
}

/**
 * Whether the URL names a note the Focus shows: the link the page was loaded on, which waits to open in the Focus
 * instead of zoom, or an address the Focus gave its note. Read before the Focus, so it restores the one displayed last.
 */
export function useNoteLinkLoad(location: ReturnType<typeof useLocation>, editorRoute: ReturnType<typeof parseWorkspaceRoute>) {
  const routeNote = routeNoteOf(location, editorRoute);
  // `from`: the name the link was loaded on, when the note was found to lie elsewhere; the address is on its way to `note`.
  const [linked, setLinked] = useState<{ note: string; from?: string; } | null>(() => routeNote === null ? null : { note: routeNote });
  // Leaving the note before it opened (or a redirect to another note) drops the request; a redirect that only rewrites the notebook keeps it.
  const pending = linked !== null && (editorRoute.note === linked.note || (linked.from !== undefined && editorRoute.note === linked.from));
  /** Whether the Focus took the note of the history entry `key`; one it could not take is shown in zoom. */
  const [outcome, setOutcome] = useState<{ key: string; inFocus: boolean; } | null>(null);
  const settle = useCallback((key: string, inFocus: boolean) => {
    setLinked(null);
    setOutcome({ key, inFocus });
  }, []);
  useEffect(() => {
    if (linked !== null && !pending) setLinked(null);
  }, [linked, pending]);
  // A note route the app opened itself without `returnTo` (a folder's index, the guide of a demo) is zoom, as before.
  const inFocus = routeNote !== null && (pending || (outcome?.key === location.key ? outcome.inFocus : isFocusNoteState(location.state)));
  /** The note the link names lies at `to` now (another person moved it): the link waits for it there, where the address is redirected. */
  const follow = useCallback((from: string, to: string) => setLinked(current => current?.note === from ? { note: to, from } : current), []);
  return { pending, inFocus, settle, follow };
}

interface Params {
  link: ReturnType<typeof useNoteLinkLoad>;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  routedNote: NoteItem | null;
  /** The repository path of the note the route names, whether or not it was read yet. */
  routedPath: string | null;
  routeError: string;
  noteFocus: ReturnType<typeof useFocusPanes>['noteFocus'];
  /** The note the active pane shows, if it shows one. */
  activeNotePath: string | undefined;
  focusNarrowView: ReturnType<typeof useFocusPanes>['focusNarrowView'];
  selectedNotebookId: string;
  /** The folder of the selected notebook, which the paths of its Focus tabs start with. */
  notebookRoot: string | undefined;
  /** The browse view behind the note, where the Focus is shown. */
  returnTo: string;
  /** Whether the Notes page browses a notebook, where a Focus is shown (not a study session or another page). */
  browsing: boolean;
  flushZoom?: (keys: readonly string[]) => Promise<boolean>;
  setFocusNarrowView: ReturnType<typeof useFocusPanes>['setFocusNarrowView'];
  /** Whether a note is a template file of its notebook, which stays in zoom: it never opens in a Focus pane. */
  isTemplate?: (note: Pick<NoteItem, 'notebookId' | 'path'>) => boolean;
}

/**
 * Keeps the address bar on the note the Focus shows, so it can be copied: while a Focus is shown the URL is the note
 * route of the active pane's note, with the browse query and hash; a compilation, an empty pane or a phone's list
 * screen names the notebook. A note the person opens adds a history entry; switching tabs or panes, closing a tab or a
 * rename replaces it. A note link the page was loaded on, and an address Back or Forward returns to, opens that note in
 * the Focus (its tab where one is open, else a new one); when the Focus cannot take it, the note stays in zoom.
 */
export function useOpenNoteLinkInFocus({ link, location, navigate, editorRoute, routedNote, routedPath, routeError, noteFocus, activeNotePath, focusNarrowView, selectedNotebookId, notebookRoot, returnTo, browsing, flushZoom, setFocusNarrowView, isTemplate }: Params) {
  const { pending, inFocus, settle } = link;
  const navigationType = useNavigationType();
  const isCurrent = useCurrentEntry();
  const phone = usePhone();
  const focusReady = !noteFocus.loading && Boolean(noteFocus.shown && noteFocus.layout && noteFocus.entry);
  /**
   * The history entry whose note the Focus was brought to on this visit of it: the Focus answers an arrival once, so the
   * person's own changes there are never undone. Every arrival is answered again, a return to an entry answered before too.
   */
  const [answered, setAnswered] = useState<string | null>(null);
  const [visited, setVisited] = useState(location.key);
  if (visited !== location.key) {
    setVisited(location.key);
    setAnswered(null);
  }
  // An entry reached by Back or Forward names the note the Focus showed then.
  const returning = inFocus && !pending && navigationType === 'POP' && answered !== location.key;
  const resolving = pending || returning;
  const busy = useRef<string | null>(null);

  /* eslint-disable react-hooks/exhaustive-deps -- The note opens once per history entry, when it and the Focus are ready; the Focus callbacks change on every render and must not replay it. */
  useEffect(() => {
    if (!resolving || busy.current === location.key) return;
    const key = location.key;
    const done = (shown: boolean) => {
      busy.current = null;
      setAnswered(key);
      settle(key, shown);
      if (shown) setFocusNarrowView('focus');
    };
    // A missing note keeps its not-found page. A notebook named by its bare local id is not found until the route is redirected to its key, so that error waits.
    if (routeError && routeError !== 'route.notebookNotFound') return done(false);
    if (!focusReady || !routedPath || !noteFocus.layout) return;
    // A note of another notebook has no place in this notebook's Focus, so it stays in zoom.
    if (routedNote && (routedNote.notebookId !== selectedNotebookId || isTemplate?.(routedNote))) return done(false);
    if (activeNotePath === routedPath) return done(true);
    // Its tab, where one is open, is shown again rather than a second one opened: the active pane's first.
    const tabKey = `note:${routedPath}`;
    const holding = focusPanes(noteFocus.layout).filter(pane => pane.tabs.some(tab => `note:${tab.path}` === tabKey)).map(pane => pane.id);
    const pane = holding.includes(noteFocus.entry!.activePane) ? noteFocus.entry!.activePane : holding[0];
    if (pane !== undefined) {
      busy.current = key;
      void noteFocus.show(pane, tabKey).then(() => done(true), () => done(false));
      return;
    }
    if (!routedNote) return;
    busy.current = key;
    void noteFocus.openNote(routedNote.path).then(result => done(result === 'opened'), () => done(false));
  }, [resolving, location.key, focusReady, routeError, routedNote?.path, routedNote?.notebookId, routedPath, activeNotePath, selectedNotebookId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Back on a phone from a note's address to the notebook's shows the list again.
  const previousKey = useRef(location.key);
  useEffect(() => {
    if (previousKey.current === location.key) return;
    previousKey.current = location.key;
    if (phone && browsing && !editorRoute.note && navigationType === 'POP') setFocusNarrowView('browse');
  }, [location.key, phone, browsing, editorRoute.note, navigationType, setFocusNarrowView]);

  /** The note the address should name, null for the notebook, undefined while the Focus does not decide the address (zoom, loading, another page). */
  const managed = browsing && focusReady && !resolving && (!editorRoute.note || inFocus);
  const target = !managed ? undefined : activeNotePath && !isCompilationPath(activeNotePath) && !(phone && focusNarrowView !== 'focus') ? activeNotePath : null;
  /** The note the address names now. */
  const named = editorRoute.note && inFocus ? routedPath : null;
  /** The board spans the note column: its address stays the notebook's until the person opens a note from it. */
  const onBoard = !editorRoute.note && new URLSearchParams(location.search).get('view') === 'kanban';
  const urlFor = (path: string | null) => {
    const browse = editorRoute.note ? returnTo : location.pathname + location.search;
    if (!path || !notebookRoot || !path.startsWith(`${notebookRoot}/`)) return browse + location.hash;
    const url = new URL(browse, 'https://workspace.invalid');
    // A folder the notebook route names travels in the query, as zoom's does, so leaving the note returns to it.
    const folder = matchPath('/notebooks/:notebook/folders/*', url.pathname)?.params['*'];
    if (folder) url.searchParams.set('folder', decodeURIComponent(folder));
    // The note route names its notebook in the path, as zoom's does; a `?notebook=` the notebook route carries (the way back from Settings sets one) is not kept.
    url.searchParams.delete('notebook');
    // The board spans the note's column, so a note opened from it shows beside the list, and closing the note leaves the list there.
    if (url.searchParams.get('view') === 'kanban') url.searchParams.delete('view');
    return noteRoute(selectedNotebookId, path.slice(notebookRoot.length + 1)) + url.search + location.hash;
  };
  /** Set while the person opens a note, so the address it gets is a new history entry. */
  const pushNext = useRef(false);
  const latest = useRef({ named, managed, urlFor, pending });
  useLayoutEffect(() => {
    latest.current = { named, managed, urlFor, pending };
  });
  const follow = (path: string | null, push: boolean) => navigate(urlFor(path), { replace: !push, state: path ? FOCUS_NOTE_STATE : null });

  const previous = useRef<{ target: string | null | undefined; key: string; }>({ target: undefined, key: location.key });
  /* eslint-disable react-hooks/exhaustive-deps -- The address follows a change of the Focus or a navigation the app made; Back and Forward leave it as the entry has it. */
  useEffect(() => {
    const changed = previous.current.target !== target, moved = previous.current.key !== location.key;
    previous.current = { target, key: location.key };
    if (target === undefined || onBoard || !(changed || (moved && navigationType !== 'POP')) || target === named) return;
    // A newer entry is followed once it renders; Back or Forward leaves it as the entry has it.
    if (!isCurrent(location.key)) return;
    const push = pushNext.current;
    pushNext.current = false;
    void follow(target, push);
  }, [target, named, onBoard, location.key, navigationType]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // A note link the Focus took (the page was loaded on it) is marked as an address the Focus gave, as the entry a note's
  // opening pushes is: Back or Forward to it, or a change of its query, keeps it in the Focus, after a reload too.
  const unmarked = managed && named !== null && target === named && !isFocusNoteState(location.state);
  useEffect(() => {
    if (unmarked && isCurrent(location.key)) void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: FOCUS_NOTE_STATE });
  }, [unmarked, location, navigate, isCurrent]);

  /**
   * Runs `open` for the note at `path`; when it opens, the note's address is a new history entry. While the note link the
   * page was loaded on still opens, the note it names wins: a click elsewhere then is most likely a stray one, so it opens
   * nothing and leaves the history alone (reported as blocked, so it does not fall back to zoom either).
   */
  const trackOpen = async (path: string, open: () => Promise<OpenResult>): Promise<OpenResult> => {
    if (latest.current.pending) return 'blocked';
    pushNext.current = true;
    let result: OpenResult = 'blocked';
    try {
      result = await open();
    } finally {
      // The address did not follow yet (the Focus has not rendered the change): it follows now, and the Focus finds it already there.
      if (pushNext.current) {
        pushNext.current = false;
        const destination = isCompilationPath(path) ? null : path;
        if (result === 'opened' && latest.current.managed && latest.current.named !== destination) void navigate(latest.current.urlFor(destination), { state: destination ? FOCUS_NOTE_STATE : null });
      }
    }
    return result;
  };
  // A toggle is not a Back: it explicitly chooses this note, even if the browse entry had another tab showing.
  const returnToFocus = !inFocus && routedNote && focusReady && noteFocus.layout && noteFocus.entry && routedNote.notebookId === selectedNotebookId && !isTemplate?.(routedNote) ? async (mode: EditorMode) => {
    const path = routedNote.path;
    const active = noteFocus.entry!.activePane;
    const key = focusTabKey({ kind: 'note', path });
    const layout = noteFocus.layout!;
    const pane = findFocusTabInPane(layout, active, key) !== -1 ? active : focusPanes(layout).find(pane => findFocusTabInPane(layout, pane.id, key) !== -1)?.id ?? active;
    if (flushZoom && !await flushZoom([noteRefKey(routedNote)])) return false;
    if (!isCurrent(location.key) || await noteFocus.openNote(path, pane, 'here') !== 'opened' || !isCurrent(location.key)) return false;
    const url = new URL(urlFor(path), 'https://workspace.invalid');
    setFocusNarrowView('focus');
    // Replace the zoom entry so Back goes to the entry that opened it, rather than reopening zoom.
    void navigate(url.pathname + searchWithEditorMode(url.search, mode) + url.hash, { replace: true, state: FOCUS_NOTE_STATE });
    return true;
  } : undefined;
  const frameSelection = useRef<FrameSelection | null>(null);
  return { trackOpen, returnToFocus, frameSelection };
}
