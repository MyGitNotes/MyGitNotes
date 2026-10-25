import { useLocation, useNavigate } from 'react-router-dom';
import { parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import { useState } from 'react';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FocusTab } from '@mygitnotes/core/focus-page';
import { useNoteFocus } from '../lib/use-note-focus.js';
import { CURRENT_FOCUS, displayedPanes } from '../lib/focus-view.js';
import { parseNotebookKey } from '@mygitnotes/core/notebook-key';
import { usePaneCapacity } from '../components/FocusArea.js';
import { isDocumentTool, usePanelContext } from '../lib/panel-context.js';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import type { NotePanelMode } from '../components/note-editor/types.js';
import type { WorkspaceState } from './workspace-state.js';
import { isPhoneViewport } from '../lib/use-phone.js';

interface Params {
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  /** The id of the repository serving the selected notebook, which scopes this device's Focus view of it. */
  notebookRepository: string;
  focusPage: WorkspaceState['focus'];
  remote: WorkspaceState['remote'];
  sourceId: WorkspaceState['sourceId'];
  repoRoot: WorkspaceState['repoRoot'];
  activeTab: WorkspaceTab;
  route: ReturnType<typeof parseWorkspaceRoute>;
  /** Whether the Focus document may be saved; it lives in its repository. */
  canWrite: boolean;
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  resolveBareNotebook: WorkspaceState['resolveBareNotebook'];
}

export function useFocusPanes({ selectedNotebookId, notebookRepository, focusPage, remote, sourceId, repoRoot, activeTab, route, canWrite, editorRegistry, location, navigate, editorRoute, resolveBareNotebook }: Params) {
  // Focus: the URL names the displayed one; named Focus sync through their workspace document.
  const focusCapacity = usePaneCapacity();
  // A view kept before notebook keys belongs to the notebook its local id stands for, as an old URL's does.
  const localId = parseNotebookKey(selectedNotebookId)?.localId;
  const focusScope = localId && resolveBareNotebook(localId) === selectedNotebookId ? remote ? sourceId : `local:${repoRoot}` : null;
  // A Notes page whose URL names no Focus shows the one it displayed last, decided while rendering so the list never paints first.
  const noteFocus = useNoteFocus({ page: focusPage, notebookId: selectedNotebookId, repository: notebookRepository, scope: focusScope, focusKey: activeTab === 'notes' ? route.focus : null, restoreLast: activeTab === 'notes' && !editorRoute.note, writable: canWrite, splitBeside: focusCapacity === 'all', flushEditors: editorRegistry.flushEditors });
  const focusDisplay = noteFocus.layout && noteFocus.entry ? displayedPanes(noteFocus.entry, noteFocus.layout, focusCapacity) : undefined;
  /** On phones the browse region and the Focus take turns filling the screen; a phone starts on the list. */
  const [focusNarrowView, setFocusNarrowView] = useState<'focus' | 'browse'>(() => isPhoneViewport() ? 'browse' : 'focus');
  const [addingToFocus, setAddingToFocus] = useState<{ tab: FocusTab; label: string; } | null>(null);
  // The rail shows the active pane's document panel when that pane displays a note.
  const panel = usePanelContext();
  const [documentContainer, setDocumentContainer] = useState<HTMLDivElement | null>(null);
  const activeKey = noteFocus.entry ? focusDisplay?.panes.find(pane => pane.panes.includes(noteFocus.entry!.activePane))?.key : undefined;
  // A compilation pane has no editor, so it has no document panel either.
  /** Whether the active pane shows a tab at all: a phone's note screen has nothing to show without one. */
  const hasActiveTab = Boolean(activeKey);
  /** The path of the note the active pane shows, if it shows one. */
  const activeNotePath = activeKey?.startsWith('note:') ? activeKey.slice('note:'.length) : undefined;
  const activePaneNote = Boolean(activeKey?.startsWith('note:') && !isCompilationPath(activeKey.slice('note:'.length)));
  const focusDocumentPanel = {
    target: documentContainer,
    mode: panel.isOpen && isDocumentTool(panel.activeTool) ? panel.activeTool : null,
    onChange: (mode: NotePanelMode | null) => {
      if (!mode) panel.close();
      else if (!panel.isOpen || panel.activeTool !== mode) panel.openTool(mode);
    },
  };
  /** Shows a Focus (`current` or an id). */
  const showFocus = async (key: string) => {
    if (!await editorRegistry.flushEditors()) return;
    const query = new URLSearchParams(location.search);
    query.set('focus', key);
    setFocusNarrowView('focus');
    navigate({ pathname: location.pathname, search: query.toString() });
  };
  /** Whether the named Focus is waiting for the user to confirm clearing it. */
  const [confirmingClear, setConfirmingClear] = useState(false);
  /** Clears the default Focus at once and asks before clearing a named one. */
  const requestClear = () => {
    if (noteFocus.shown === CURRENT_FOCUS) void noteFocus.clear().catch(() => {});
    else if (noteFocus.shown) setConfirmingClear(true);
  };
  return { requestClear, confirmingClear, setConfirmingClear, hasActiveTab, focusCapacity, noteFocus, focusDisplay, focusNarrowView, setFocusNarrowView, addingToFocus, setAddingToFocus, activePaneNote, activeNotePath, focusDocumentPanel, setDocumentContainer, showFocus };
}
