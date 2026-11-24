import { safeFilterPath } from '@mygitnotes/core/note-filters';
import { noteDemoViewWriteIn, storageOwner } from './demo-storage.js';

const folderKey = (repository: string, notebook: string) => `github-notes:last-folder:${storageOwner(repository)}:${notebook}`;

/** The last notebook-relative folder on this device, or null for the root. */
export function readLastFolder(repository: string, notebook: string): string | null {
  try {
    const folder = localStorage.getItem(folderKey(repository, notebook));
    return folder && safeFilterPath(folder) ? folder : null;
  } catch {
    return null;
  }
}

export function rememberLastFolder(repository: string, notebook: string, folder: string | null): void {
  try {
    const key = folderKey(repository, notebook);
    if (localStorage.getItem(key) === folder) return;
    if (folder === null) localStorage.removeItem(key);
    else if (noteDemoViewWriteIn(repository)) localStorage.setItem(key, folder);
  } catch {
    // A browser that denies storage can still browse by URL.
  }
}
