/**
 * The notebook a person last opened, kept per workspace in this browser, so an address that names no notebook (`/`,
 * `/notes`, the PWA's start URL, `/graph`) reopens it instead of the workspace's default notebook. It is a view
 * preference of this device: it writes no file and makes no commit.
 */
export const LAST_NOTEBOOK_STORAGE_PREFIX = 'github-notes:last-notebook:';

/** The notebook key remembered for a workspace (named by its default repository's storage id), or null. */
export function readLastNotebook(workspace: string): string | null {
  try {
    return localStorage.getItem(LAST_NOTEBOOK_STORAGE_PREFIX + workspace) || null;
  } catch {
    return null;
  }
}

export function rememberLastNotebook(workspace: string, notebook: string): void {
  try {
    if (localStorage.getItem(LAST_NOTEBOOK_STORAGE_PREFIX + workspace) !== notebook) localStorage.setItem(LAST_NOTEBOOK_STORAGE_PREFIX + workspace, notebook);
  } catch {
    // ignore quota / storage errors
  }
}

interface OpeningConfig {
  workspace: { default_notebook: string; };
  notebooks: readonly { id: string; }[];
}

/**
 * The notebook a page opens: the one its route names, else the one remembered while the workspace still serves it,
 * else the workspace's default notebook, else its first. A remembered notebook the workspace does not list now is kept,
 * not forgotten: its repository may be down for a moment, and it opens again once the workspace lists it.
 */
export function openingNotebook({ routed, remembered, config }: { routed: string | undefined; remembered: string | null; config: OpeningConfig | null; }): string {
  const fallback = config?.workspace.default_notebook || config?.notebooks[0]?.id || 'example';
  if (routed) return routed;
  return remembered && config?.notebooks.some(notebook => notebook.id === remembered) ? remembered : fallback;
}
