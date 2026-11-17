import { noteRefKey, sameNote } from '@mygitnotes/core/note-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NotebookConfig, NoteItem } from '../lib/types.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useNoteLookup } from '../lib/use-note-queries.js';
import { useNoteWhereabouts } from '../lib/note-whereabouts.js';
import type { parseWorkspaceRoute } from '../lib/routes.js';

interface UseRoutedNoteParams {
  config: { notebooks: NotebookConfig[]; } | null;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  editorNotebookId: string;
  editingNote: NoteListItem | null;
  loading: boolean;
  sourceId: string;
  setEditingNote: (note: NoteListItem | null) => void;
  /** The note at `from` (a pending live note checked in and filed, or a live note moving elsewhere) is now at `path` of the same notebook. */
  onFiled?: (notebookId: string, path: string, from: string) => void;
}

/** Opening a note reads that one note, with its body, instead of holding every note in memory. */
export function useRoutedNote({ config, editorRoute, editorNotebookId, editingNote, loading, sourceId, setEditingNote, onFiled }: UseRoutedNoteParams) {
  const [routeError, setRouteError] = useState('');
  const routedNotebook = config?.notebooks.find(nb => nb.id === editorNotebookId) || (!editorRoute.notebook ? config?.notebooks[0] : undefined);
  const routedPath = editorRoute.note && routedNotebook ? `${routedNotebook.root}/${editorRoute.note}` : null;
  const routedLookup = useNoteLookup(routedPath && routedNotebook ? [{ notebookId: routedNotebook.id, path: routedPath }] : [], true);
  const routedCommitted = routedLookup.committed[0];
  const listedNote = useMemo<NoteItem | null>(() => {
    if (!routedPath) return null;
    if (editingNote && routedNotebook && sameNote(editingNote, { notebookId: routedNotebook.id, path: routedPath }) && typeof editingNote.content === 'string') return editingNote as NoteItem;
    const found = routedLookup.notes[0];
    return found && typeof found.content === 'string' ? found as NoteItem : null;
  }, [routedPath, routedNotebook, editingNote, routedLookup.notes]);
  // A note the lists do not show is not taken for a missing one: the server says where it is (a live note's move or
  // rename by someone else, its check-in, or a target a later move replaced: §20.4 of the built-in editor spec), and the
  // address follows it there. Not found is said only once the server says the note is gone.
  const routedRef = useMemo(() => routedPath && routedNotebook && !listedNote && !loading ? [{ notebookId: routedNotebook.id, path: routedPath }] : [], [routedPath, routedNotebook, listedNote, loading]);
  const answers = useNoteWhereabouts(routedRef, routedLookup);
  const whereabouts = routedRef[0] ? answers.get(noteRefKey(routedRef[0])) : undefined;
  const routedNote = listedNote ?? (whereabouts?.kind === 'here' && typeof whereabouts.note.content === 'string' ? whereabouts.note : null);
  // A read that waits for the connection is not loading: the note opens once the browser is online and the read runs again.
  const routedOffline = Boolean(routedPath) && !routedNote && routedLookup.paused;
  const asking = routedRef.length > 0 && !routedLookup.loading && !routedLookup.error && (!whereabouts || whereabouts.kind === 'moved');
  const routedLoading = Boolean(routedPath) && !routedNote && ((routedLookup.loading && !routedOffline) || asking);

  useEffect(() => {
    if (loading || !config) return;
    if (!editorRoute.valid) {
      /* eslint-disable react/set-state-in-effect -- Route resolution waits for configuration and the note query; preserve the previous error during loading and clear the shared editor only after route commit. */
      setRouteError('route.pageNotFound');
      /* eslint-enable react/set-state-in-effect */
      return;
    }
    if (!routedNotebook) {
      setRouteError('route.notebookNotFound');
      return;
    }
    if (!editorRoute.note) {
      setRouteError('');
      setEditingNote(null);
      return;
    }
    if (routedLookup.error) {
      setRouteError(routedLookup.error);
      return;
    }
    if (routedOffline) {
      setRouteError('route.noteOffline');
      return;
    }
    if (routedNote || routedLoading) {
      setRouteError('');
      return;
    }
    // The server could not be asked where the note is: its words, as a failed read of the lists says.
    setRouteError(whereabouts?.kind === 'unknown' ? whereabouts.error : 'route.noteNotFound');
  }, [editorRoute, config, loading, editorNotebookId, sourceId, routedNotebook, routedNote, routedLoading, routedOffline, routedLookup.error, whereabouts, setEditingNote]);

  // A note the server says lies elsewhere now (a pending live note checked in, a filed one moving elsewhere) opens there.
  const filed = useRef(onFiled);
  useEffect(() => {
    filed.current = onFiled;
  });
  const movedTo = whereabouts?.kind === 'moved' ? whereabouts.path : undefined;
  const routedNotebookId = routedNotebook?.id;
  useEffect(() => {
    if (movedTo && routedNotebookId && routedPath) filed.current?.(routedNotebookId, movedTo, routedPath);
  }, [movedTo, routedNotebookId, routedPath]);

  return { routedNotebook, routedPath, routedNote, routedCommitted, routedLoading, routeError };
}
