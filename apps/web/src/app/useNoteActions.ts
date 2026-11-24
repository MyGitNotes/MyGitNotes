import { type NoteListItem } from '@mygitnotes/core/note-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { noteRoute, noteTrail, parseWorkspaceRoute, WorkspaceTab } from '../lib/routes.js';
import React from 'react';
import { fetchAssets } from '../lib/api.js';
import { type EditorMode, searchWithEditorMode } from '../lib/editor-mode-url.js';
import { LIVE_EDIT_PARAM, searchWithoutLiveEdit } from '../lib/live-edit-url.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  activeTab: WorkspaceTab;
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  config: WorkspaceState['config'];
  location: ReturnType<typeof useLocation>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  /** Whether the URL is the address of the note the Focus shows, which zoom leaves as it leaves the notebook page. */
  focusNoteRoute?: boolean;
  returnTo: string;
  selectedFolder: string | null;
  selectedNotebookId: WorkspaceState['selectedNotebookId'];
  navigate: ReturnType<typeof useNavigate>;
  setAssets: WorkspaceState['setAssets'];
}

export function useNoteActions({ activeTab, editorRegistry, setEditingNote, config, location, editorRoute, focusNoteRoute = false, returnTo, selectedFolder, selectedNotebookId, navigate, setAssets }: Params) {
  // Note Handlers
  /** `mode` names the editor mode zoom opens in; without one the zoom keeps the mode the page's URL names. */
  const handleOpenNote = async (note: NoteListItem, anchor = '', { mode }: { mode?: EditorMode; } = {}) => {
    // Zoom is a Notes route: leaving another tab unmounts its graph cards, so their edits are saved first.
    if (activeTab !== 'notes' && !await editorRegistry.flushEditors()) return false;
    setEditingNote(note);

    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (notebook) {
      const query = new URLSearchParams(location.search);
      query.delete('notebook');
      // A zoom the app opens carries `returnTo`, so a link's `?zoom` request is not passed on; its `?edit` request was
      // the address's own, which neither the zoom nor the way back repeats.
      query.delete('zoom');
      query.delete(LIVE_EDIT_PARAM);
      const here = location.pathname + searchWithoutLiveEdit(location.search) + location.hash;
      query.set('returnTo', editorRoute.note ? returnTo : here);
      if (selectedFolder && note.notebookId === selectedNotebookId) query.set('folder', selectedFolder);
      else query.delete('folder');
      // `returnTo` stays the browse view behind the editor, so a note reached from another note
      // stacks that note on the trail instead, and closing walks back the way the reader came.
      // Reopening the zoomed note itself keeps the trail as it is, so closing never shows it again.
      const path = noteRoute(notebook.id, note.path.slice(notebook.root.length + 1));
      // Zoom opened over the Focus closes back to it, as from the notebook page; its address follows the Focus again there.
      const zoomed = Boolean(editorRoute.note) && !focusNoteRoute;
      const reopened = zoomed && location.pathname === path;
      const trail = reopened ? noteTrail(location.state) : zoomed ? [...noteTrail(location.state), here] : [];
      navigate(path + (mode ? searchWithEditorMode(query.toString(), mode) : '?' + query.toString()) + (anchor ? '#' + encodeURIComponent(anchor) : ''), { replace: reopened, state: trail.length ? { noteTrail: trail } : null });
    }
    const targetNotebook = note.notebookId || selectedNotebookId;
    if (targetNotebook) {
      fetchAssets(targetNotebook).then(setAssets).catch(console.error);
    }
    return Boolean(notebook);
  };

  const closeZoom = () => {
    setEditingNote(null);
    navigate(returnTo, { replace: true });
  };
  const closeCompilationZoom = () => {
    const trail = noteTrail(location.state);
    const previous = trail.at(-1);
    if (!previous) return closeZoom();
    setEditingNote(null);
    navigate(previous, { replace: true, state: trail.length > 1 ? { noteTrail: trail.slice(0, -1) } : null });
  };
  return { handleOpenNote, closeZoom, closeCompilationZoom };
}
