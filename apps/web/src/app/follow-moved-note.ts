import { noteRoute } from '../lib/routes.js';

export interface FollowMovedNote {
  /** The note as this page shows it, at the path it was read at. */
  note: { notebookId: string; path: string; };
  /** Where the note lies now, as the server said. */
  to: string;
  notebook: { id: string; root: string; } | undefined;
  /** The note path the address names now, if any. */
  routedPath: string | null | undefined;
  /** The address's query, kept as it is. */
  search: string;
  relocatePaths: (notebookId: string, move: (path: string) => string) => void;
  navigate: (to: string, options: { replace: true; }) => void;
  /** Reads the lists and the workspace again, which still show the note where it was. */
  refresh: () => void;
}

/**
 * A note this page shows answered that it lies elsewhere now: a live note another person moved, checked in or still waiting
 * for its check-in (docs/specs/2026-11-15-builtin-live-editor §20.4). Every view of it follows it there: the Focus tabs
 * that show it, and the address when it names it; the lists are read again. A path outside the note's notebook is not
 * followed.
 */
export function followMovedNote({ note, to, notebook, routedPath, search, relocatePaths, navigate, refresh }: FollowMovedNote): void {
  if (!notebook || notebook.id !== note.notebookId || !to.startsWith(`${notebook.root}/`) || to === note.path) return;
  relocatePaths(note.notebookId, path => path === note.path ? to : path);
  if (routedPath === note.path) navigate(noteRoute(notebook.id, to.slice(notebook.root.length + 1)) + search, { replace: true });
  refresh();
}
