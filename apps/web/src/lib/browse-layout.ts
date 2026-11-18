import type { ViewMode } from './types.js';

/** How the Notes page lays out its folders, filters and list: the same as normal browsing unless a Focus is showing beside the browse region. */
export interface BrowseLayout {
  /** The filter sidebar folds away on a desktop because the left dock holds the folders and filters; below that breakpoint it stays a drawer. */
  sidebarFolded: boolean;
  /**
   * What the left dock holds below its list: the folders and filters, with the list's search and toggles over the list (`filters`), only the
   * folders (`folders`, a phone's list screen, whose bar keeps the search), or no split.
   */
  split: 'filters' | 'folders' | null;
  /** Where the chips of the filters in force show: in the phone's bar above the list (`bar`), at the top of the list (`list`), or nowhere. */
  chips: 'bar' | 'list' | null;
}

/**
 * `focusShown`: a Focus with a note shows on the Notes page. `capacity` is the pane capacity: `all` on a desktop, 1 on a phone. The list and
 * flat views dock left of a Focus and split; the Kanban board docks above it, beside the usual sidebar.
 */
export function browseLayout({ focusShown, capacity, viewMode }: { focusShown: boolean; capacity: 1 | 2 | 'all'; viewMode: ViewMode; }): BrowseLayout {
  const phone = capacity === 1;
  if (!focusShown) return { sidebarFolded: false, split: null, chips: phone ? 'bar' : null };
  if (viewMode === 'kanban') return { sidebarFolded: false, split: null, chips: phone ? 'bar' : capacity === 'all' ? null : 'list' };
  if (phone) return { sidebarFolded: false, split: 'folders', chips: 'list' };
  return { sidebarFolded: capacity === 'all', split: 'filters', chips: null };
}

/** The path line over the list: the folders below the notebook root, the notebook at its root, or the kind of list (outlines, compilations). */
export function browsePath({ kind, notebookTitle, breadcrumbs, labels }: { kind?: string; notebookTitle: string; breadcrumbs: readonly { name: string; path: string | null; }[]; labels: { outline: string; compilations: string; }; }): string {
  if (kind === 'outline') return labels.outline;
  if (kind === 'compilation') return labels.compilations;
  const folders = breadcrumbs.filter(segment => segment.path !== null).map(segment => segment.name);
  return folders.length > 0 ? folders.join(' / ') : notebookTitle;
}
