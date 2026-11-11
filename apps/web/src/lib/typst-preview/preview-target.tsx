import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** A note the Typst preview may follow. */
export interface PreviewNote {
  notebookId?: string;
  path: string;
}

interface PreviewTargetValue {
  /** Whether this workspace has the Typst preview at all: a local workspace, never a remote or demo one. */
  enabled: boolean;
  /** The note in the zoomed editor or the active Focus pane. */
  note: PreviewNote | null;
  /** Names a note while its editor is the active one; the answer takes it back. */
  register: (note: PreviewNote) => () => void;
}

const NOTHING: PreviewTargetValue = { enabled: false, note: null, register: () => () => {} };
const PreviewTargetContext = createContext<PreviewTargetValue>(NOTHING);

/**
 * Says whether the workspace offers the Typst preview and carries the note it follows. Without a provider (tests,
 * embedded editors, remote mode) nothing is offered and no preview request is ever made.
 */
export function TypstPreviewProvider({ enabled, children }: { enabled: boolean; children?: ReactNode; }) {
  // The most recently activated editor wins; when it leaves, the one it covered (a Focus pane under a zoomed note) is followed again.
  const [notes, setNotes] = useState<PreviewNote[]>([]);
  const register = useCallback((note: PreviewNote) => {
    setNotes(current => [...current, note]);
    return () => setNotes(current => current.filter(entry => entry !== note));
  }, []);
  const note = enabled ? notes.at(-1) ?? null : null;
  const value = useMemo(() => ({ enabled, note, register }), [enabled, note, register]);
  return <PreviewTargetContext.Provider value={value}>{children}</PreviewTargetContext.Provider>;
}

export function useTypstPreviewEnabled(): boolean {
  return useContext(PreviewTargetContext).enabled;
}

/** The note the preview follows, or null. */
export function usePreviewTarget(): PreviewNote | null {
  return useContext(PreviewTargetContext).note;
}

/** Publishes the note an editor shows while `active` (the zoomed editor, or the active Focus pane) as the one the preview follows. */
export function usePublishPreviewTarget(note: PreviewNote | null, active: boolean): void {
  const { register } = useContext(PreviewTargetContext);
  const notebookId = note?.notebookId, path = note?.path;
  useEffect(() => active && path ? register({ notebookId, path }) : undefined, [active, notebookId, path, register]);
}
