import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { type Location, useLocation, useNavigate } from 'react-router-dom';
import { type EditorMode, editorModeOf, searchWithEditorMode } from '../lib/editor-mode-url.js';
import { useCurrentEntry } from './current-entry.js';

interface EditorModeRoute {
  /** The mode the URL names (`?mode=`), live when it names none. */
  mode: EditorMode;
  /** Names `mode` in the URL of the current history entry, replacing it; live is left out of the URL. */
  setMode: (mode: EditorMode) => void;
}

const EditorModeRouteContext = createContext<EditorModeRoute | null>(null);

/**
 * Keeps the note editor's mode in the page's URL as `?mode=live|source|split`, so a reload or a shared link reopens it. A
 * switch replaces the current entry, keeping the rest of the query, the hash and the entry's state (the mark of a Focus
 * address), and like the Focus's own address it replaces only the entry the page shows: a switch made while a newer entry
 * has not rendered yet waits for it.
 */
export function EditorModeRouteProvider({ children }: { children: ReactNode; }) {
  const location = useLocation(), navigate = useNavigate();
  const isCurrent = useCurrentEntry();
  const latest = useRef(location);
  const pending = useRef<EditorMode | null>(null);
  useLayoutEffect(() => {
    latest.current = location;
  });
  const apply = useCallback((at: Location, mode: EditorMode) => {
    if (editorModeOf(at.search) === mode) return;
    void navigate({ pathname: at.pathname, search: searchWithEditorMode(at.search, mode), hash: at.hash }, { replace: true, state: at.state });
  }, [navigate]);
  const setMode = useCallback((mode: EditorMode) => {
    const at = latest.current;
    if (isCurrent(at.key)) apply(at, mode);
    else pending.current = mode;
  }, [apply, isCurrent]);
  useEffect(() => {
    const mode = pending.current;
    if (mode === null || !isCurrent(location.key)) return;
    pending.current = null;
    apply(location, mode);
  }, [location, apply, isCurrent]);
  const mode = editorModeOf(location.search);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <EditorModeRouteContext.Provider value={value}>{children}</EditorModeRouteContext.Provider>;
}

/** The editor mode the page's URL names and its setter; null outside {@link EditorModeRouteProvider} (an editor embedded on its own). */
export function useEditorModeRoute(): EditorModeRoute | null {
  return useContext(EditorModeRouteContext);
}
