import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSavedPanelState, savePanelState } from './panel-state.js';
import { isPhoneViewport } from './use-phone.js';

/** The rail's own tools. The agent has its own dock (see assistant-dock.ts), so it is not one of them. */
export type WorkspaceToolId = 'calendar' | 'todo' | 'changes';
export const WORKSPACE_TOOL_IDS: readonly WorkspaceToolId[] = ['calendar', 'todo', 'changes'];
/** The active pane's document panel sections, offered in the rail while a Focus is displayed. */
export type DocumentToolId = 'outline' | 'find' | 'frontmatter' | 'view' | 'history';
export const DOCUMENT_TOOL_IDS: readonly DocumentToolId[] = ['outline', 'find', 'frontmatter', 'view', 'history'];
export type PanelToolId = WorkspaceToolId | DocumentToolId;
export const isDocumentTool = (id: PanelToolId): id is DocumentToolId => (DOCUMENT_TOOL_IDS as readonly PanelToolId[]).includes(id);

/**
 * Tracks the workspace-level tool panel (Calendar/Todo). It hides itself
 * while a note is open — the editor owns its own document panel (find,
 * outline, frontmatter, view, history) rather than sharing this one.
 * Zoomed notes and compilations each count while they are mounted, so a
 * compilation kept behind a note keeps the panel hidden after the note closes.
 */
interface PanelContextValue {
  isOpen: boolean;
  activeTool: PanelToolId;
  hasOpenNote: boolean;
  openTool: (id: PanelToolId) => void;
  close: () => void;
  /** A zoomed note or compilation mounts (`true`) or unmounts (`false`); every `true` is paired with a `false`. */
  setHasOpenNote: (open: boolean) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanelContext(): PanelContextValue {
  const context = useContext(PanelContext);
  if (!context) throw new Error('usePanelContext must be used within a PanelProvider');
  return context;
}

export function PanelProvider({ children }: { children: ReactNode; }) {
  const saved = useMemo(() => getSavedPanelState([...WORKSPACE_TOOL_IDS, ...DOCUMENT_TOOL_IDS]), []);
  // On a phone a tool is a full-height sheet, which opens only when the person asks and leaves a larger screen's remembered panel alone.
  const [isOpen, setIsOpen] = useState(saved.open && !isPhoneViewport());
  const [activeTool, setActiveTool] = useState<PanelToolId>(saved.tool);
  const [openNotes, setOpenNotes] = useState(0);
  const hasOpenNote = openNotes > 0;
  const setHasOpenNote = useCallback((open: boolean) => setOpenNotes(count => Math.max(0, count + (open ? 1 : -1))), []);

  useEffect(() => {
    if (!isPhoneViewport()) savePanelState({ open: isOpen, tool: activeTool });
  }, [isOpen, activeTool]);

  const openTool = (id: PanelToolId) => {
    if (isOpen && activeTool === id) {
      setIsOpen(false);
      return;
    }
    setActiveTool(id);
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  const value: PanelContextValue = { isOpen, activeTool, hasOpenNote, openTool, close, setHasOpenNote };
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
