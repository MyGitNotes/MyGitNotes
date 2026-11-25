import type { ViewMode } from './types.js';

/** How a phone's list screen lays out its path line and the filters in force; wider screens keep the three columns (`BrowseColumns`). */
export interface BrowseLayout {
  /** The path line over the list (where it is, how many notes), on a phone's list screen beside a Focus whose bar keeps the search. */
  path: boolean;
  /** Where the chips of the filters in force show: in the phone's bar above the list (`bar`), at the top of the list (`list`), or nowhere. */
  chips: 'bar' | 'list' | null;
}

/**
 * `focusShown`: a Focus with a note shows on the Notes page. On a phone the list and flat views beside such a Focus take the path line
 * over the list and show the filters in force at its top; the board, and the list with no Focus, keep the chips in the bar. The folders
 * are in the drawer's 目錄 tab. Wider screens have neither: the notebooks column holds the folders and the list's own buttons show the
 * filters.
 */
export function phoneBrowseLayout({ phone, focusShown, viewMode }: { phone: boolean; focusShown: boolean; viewMode: ViewMode; }): BrowseLayout {
  if (!phone) return { path: false, chips: null };
  if (!focusShown || viewMode === 'kanban') return { path: false, chips: 'bar' };
  return { path: true, chips: 'list' };
}

/** The path line over a phone's list: the folders below the notebook root, the notebook at its root, or the kind of list (outlines, compilations). */
export function browsePath({ kind, notebookTitle, breadcrumbs, labels }: { kind?: string; notebookTitle: string; breadcrumbs: readonly { name: string; path: string | null; }[]; labels: { outline: string; compilations: string; }; }): string {
  if (kind === 'outline') return labels.outline;
  if (kind === 'compilation') return labels.compilations;
  const folders = breadcrumbs.filter(segment => segment.path !== null).map(segment => segment.name);
  return folders.length > 0 ? folders.join(' / ') : notebookTitle;
}
