import { assistantDock } from './assistant-dock.js';
import type { PanelToolId, WorkspaceToolId } from './panel-context.js';

export const PANEL_OPEN_STORAGE_KEY = 'github-notes:panel-open';
export const PANEL_TOOL_STORAGE_KEY = 'github-notes:panel-tool';

/** The editor's own document panel remembers its section and whether it is open under these keys. */
export const DOCUMENT_PANEL_STORAGE_KEY = 'mygitnotes.documentPanel';
export const DOCUMENT_PANEL_OPEN_STORAGE_KEY = 'mygitnotes.documentPanel.open';

export const DEFAULT_PANEL_TOOL: WorkspaceToolId = 'todo';

export interface SavedPanelState {
  open: boolean;
  tool: PanelToolId;
}

/** The section the rail and the editor's document panel showed before the agent moved to its own dock. */
const LEGACY_AGENT_TOOL = 'agent';

/**
 * A rail or document panel that was open on the agent opens the dock instead and stays closed, so no one returns to an
 * empty panel. Runs as the app reads its saved panels, before anything shows the dock, since it opens it; once it has run,
 * no saved panel names the agent, so running it again changes nothing.
 */
function migrateLegacyAgentPanels(storage: Storage): void {
  let opensDock = false;
  for (const [toolKey, openKey, fallback] of [[PANEL_TOOL_STORAGE_KEY, PANEL_OPEN_STORAGE_KEY, DEFAULT_PANEL_TOOL], [DOCUMENT_PANEL_STORAGE_KEY, DOCUMENT_PANEL_OPEN_STORAGE_KEY, undefined]] as const) {
    if (storage.getItem(toolKey) !== LEGACY_AGENT_TOOL) continue;
    opensDock ||= storage.getItem(openKey) === 'true';
    if (fallback) storage.setItem(toolKey, fallback);
    else storage.removeItem(toolKey);
    storage.setItem(openKey, 'false');
  }
  if (opensDock) assistantDock.open();
}

export function getSavedPanelState(validToolIds: readonly PanelToolId[]): SavedPanelState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { open: false, tool: DEFAULT_PANEL_TOOL };
  }
  try {
    migrateLegacyAgentPanels(window.localStorage);
    const rawTool = window.localStorage.getItem(PANEL_TOOL_STORAGE_KEY);
    const tool = validToolIds.includes(rawTool as PanelToolId) ? (rawTool as PanelToolId) : DEFAULT_PANEL_TOOL;
    const open = window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === 'true';
    return { open, tool };
  } catch {
    return { open: false, tool: DEFAULT_PANEL_TOOL };
  }
}

export function savePanelState(state: SavedPanelState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, String(state.open));
    window.localStorage.setItem(PANEL_TOOL_STORAGE_KEY, state.tool);
  } catch {
    // ignore quota / storage errors
  }
}
