import { useEffect, useMemo } from 'react';
import { type Location, useNavigate } from 'react-router-dom';
import { readLastFolder, rememberLastFolder } from '../lib/last-folder.js';
import { isFocusNoteState, notebookRoute, type parseWorkspaceRoute } from '../lib/routes.js';
import type { FolderItem } from '../lib/types.js';
import { useCurrentEntry } from './current-entry.js';

interface Params {
  location: Location;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  browseRoute: ReturnType<typeof parseWorkspaceRoute>;
  focusNoteRoute: boolean;
  repositoryId: string | undefined;
  notebookId: string;
  folderRoot: string | undefined;
  folders: readonly FolderItem[];
  foldersLoading: boolean;
}

/** Notes resolve from the committed URL; other views keep their existing query or return-to route. */
export function useRememberedFolder({ location, editorRoute, browseRoute, focusNoteRoute, repositoryId, notebookId, folderRoot, folders, foldersLoading }: Params) {
  const navigate = useNavigate();
  const isCurrent = useCurrentEntry();
  const { key, pathname, search, hash, state } = location;
  const { valid, notebook, note, tab, kind, view, study, legacyScreen, legacyAllNotebooks } = editorRoute;
  const enabled = Boolean(repositoryId && folderRoot && valid && tab === 'notes' && kind === 'note' && view !== 'graph' && (!note || focusNoteRoute) && !study && !legacyScreen && !legacyAllNotebooks);
  const { folder, folders: urlFolders } = enabled ? editorRoute : browseRoute;
  // The Notes page browses one folder; links from before single selection keep their first.
  const path = urlFolders[0];
  const routedFolder = folderRoot && path?.startsWith(`${folderRoot}/`) ? path.slice(folderRoot.length + 1) : folder;
  // An empty `folder` means the person chose root, not a notebook entrance that can restore a folder.
  const explicit = Boolean(folder || urlFolders.length || new URLSearchParams(search).has('folder'));
  const restored = enabled && !explicit && repositoryId ? readLastFolder(repositoryId, notebookId) : null;
  const candidate = routedFolder ?? restored;
  const missing = enabled && candidate !== null && !foldersLoading && !folders.some(item => item.notebookId === notebookId && item.path === candidate);
  const selectedFolder = missing ? null : candidate;
  const selectedFolders = useMemo(() => {
    if (missing) return [];
    if (urlFolders.length) return [...new Set(urlFolders)];
    return folderRoot && selectedFolder ? [`${folderRoot}/${selectedFolder}`] : [];
  }, [folderRoot, missing, selectedFolder, urlFolders]);

  useEffect(() => {
    // A named folder needs validation; the root does not. Wait for bare notebook URLs to canonicalize and for Focus to take a note link.
    if (!enabled || !repositoryId || (foldersLoading && selectedFolder) || (notebook && notebook !== notebookId) || (note && !isFocusNoteState(state)) || !isCurrent(key)) return;
    rememberLastFolder(repositoryId, notebookId, selectedFolder);
    if (!restored && !missing) return;
    const query = new URLSearchParams(search);
    query.delete('folder');
    query.delete('folders');
    if (selectedFolder && folderRoot) query.set('folders', `${folderRoot}/${selectedFolder}`);
    else query.set('folder', '');
    navigate({ pathname: note ? pathname : notebookRoute(notebookId), search: query.toString(), hash }, { replace: true, state });
  }, [enabled, folderRoot, foldersLoading, hash, isCurrent, key, missing, navigate, note, notebook, notebookId, pathname, repositoryId, restored, search, selectedFolder, state]);

  return { selectedFolder, selectedFolders };
}
