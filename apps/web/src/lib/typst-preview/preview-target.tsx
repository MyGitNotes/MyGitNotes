import { createContext, type Dispatch, type ReactNode, type SetStateAction, useContext, useEffect, useMemo, useState } from 'react';

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
  publish: Dispatch<SetStateAction<PreviewNote | null>>;
}

const NOTHING: PreviewTargetValue = { enabled: false, note: null, publish: () => {} };
const PreviewTargetContext = createContext<PreviewTargetValue>(NOTHING);

/**
 * Says whether the workspace offers the Typst preview and carries the note it follows. Without a provider (tests,
 * embedded editors, remote mode) nothing is offered and no preview request is ever made.
 */
export function TypstPreviewProvider({ enabled, children }: { enabled: boolean; children: ReactNode; }) {
  const [note, setNote] = useState<PreviewNote | null>(null);
  const value = useMemo(() => ({ enabled, note: enabled ? note : null, publish: setNote }), [enabled, note]);
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
  const { publish } = useContext(PreviewTargetContext);
  const notebookId = note?.notebookId, path = note?.path;
  useEffect(() => {
    if (!active || !path) return;
    const published = { notebookId, path };
    publish(published);
    // Leaving clears only what this editor published, so a pane that took over meanwhile keeps its note.
    return () => publish(current => current === published ? null : current);
  }, [active, notebookId, path, publish]);
}
