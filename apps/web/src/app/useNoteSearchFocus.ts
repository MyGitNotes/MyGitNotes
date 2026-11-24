import { useEffect, useRef } from 'react';
import type { NoteSearchHandle } from '../components/note-list-search.js';
import type { WorkspaceTab } from '../lib/routes.js';
import type { BrowseColumns } from './useBrowseColumns.js';
import type { useFocusPanes } from './useFocusPanes.js';
import type { useWorkspaceNavigation } from './useWorkspaceNavigation.js';

interface Params {
  /** Whether the Notes page shows its columns, the notebooks column holding the search. */
  notesColumns: boolean;
  columns: BrowseColumns;
  activeTab: WorkspaceTab;
  /** Whether a phone shows its note screen, which hides the list's search. */
  phoneNoteScreen: boolean;
  setActiveTab: ReturnType<typeof useWorkspaceNavigation>['setActiveTab'];
  setFocusNarrowView: ReturnType<typeof useFocusPanes>['setFocusNarrowView'];
}

/** The notes search field, and the command that puts the cursor in it from wherever the person is. */
export function useNoteSearchFocus({ notesColumns, columns, activeTab, phoneNoteScreen, setActiveTab, setFocusNarrowView }: Params) {
  const noteSearch = useRef<NoteSearchHandle>(null);
  // Searching from another page opens Notes, then focuses the search once it has rendered.
  const noteSearchPending = useRef(false);
  const focusNoteSearch = () => {
    // The search sits at the top of the notebooks column: a folded column opens first, then the field takes the cursor once it is back.
    if (notesColumns && columns.layout.notebooks !== 'open') {
      noteSearchPending.current = true;
      return columns.toggleNotebooks();
    }
    if (noteSearch.current) return noteSearch.current.focus();
    if (activeTab === 'notes' && !phoneNoteScreen) return;
    noteSearchPending.current = true;
    void setActiveTab('notes');
  };
  useEffect(() => {
    if (!noteSearchPending.current || activeTab !== 'notes') return;
    // A phone's search is on the list screen, which a note screen has to give way to first.
    if (!noteSearch.current) {
      setFocusNarrowView('browse');
      return;
    }
    noteSearchPending.current = false;
    noteSearch.current.focus();
  }, [activeTab, phoneNoteScreen, columns.layout.notebooks, setFocusNarrowView]);
  return { noteSearch, focusNoteSearch };
}
