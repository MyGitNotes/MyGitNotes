import { noteFollowed } from '../lib/note-follows.js';
import { inNotebookRoot } from '../lib/note-whereabouts.js';
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
  /** The state of the address's history entry, kept as it is: a note the Focus shows stays in the Focus. */
  state?: unknown;
  /** The note link the page was loaded on, which waits for the Focus to show it: it waits for the note where it lies now (note names relative to the notebook). */
  link?: { follow: (from: string, to: string) => void; };
  relocatePaths: (notebookId: string, move: (path: string) => string) => void;
  navigate: (to: string, options: { replace: true; state?: unknown; }) => void;
  /** Reads the lists and the workspace again, which still show the note where it was. */
  refresh: () => void;
}

/**
 * A note this page shows answered that it lies elsewhere now: a live note another person moved, checked in or still waiting
 * for its check-in (docs/specs/2026-11-15-builtin-live-editor §20.4). Every view of it follows it there: the Focus tabs
 * that show it, and the address when it names it; the lists are read again. Each keeps the editor it shows the note in,
 * with the person's typing, caret and focus ({@link noteFollowed}). A path outside the note's notebook is not followed.
 */
export function followMovedNote({ note, to, notebook, routedPath, search, state, link, relocatePaths, navigate, refresh }: FollowMovedNote): void {
  if (!notebook || notebook.id !== note.notebookId || !inNotebookRoot(notebook.root, to) || to === note.path) return;
  noteFollowed(note.notebookId, note.path, to);
  relocatePaths(note.notebookId, path => path === note.path ? to : path);
  if (routedPath === note.path) {
    const name = to.slice(notebook.root.length + 1);
    if (note.path.startsWith(`${notebook.root}/`)) link?.follow(note.path.slice(notebook.root.length + 1), name);
    navigate(noteRoute(notebook.id, name) + search, { replace: true, state: state ?? null });
  }
  refresh();
}
