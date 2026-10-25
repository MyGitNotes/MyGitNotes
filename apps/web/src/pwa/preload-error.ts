/** Where the time of the last reload this handler made is kept, for the length of the browser tab. */
export const PRELOAD_RELOAD_KEY = 'gh_notes_preload_reload';
/** A second failure inside this long after a reload is not answered with another reload, so a file that stays missing cannot loop the page. */
const RELOAD_WINDOW_MS = 30_000;

interface PreloadTarget {
  addEventListener(type: 'vite:preloadError', listener: (event: Event) => void): void;
}

/**
 * Vite fires `vite:preloadError` when a lazy file cannot be loaded. After a deployment that means the open page is an older build
 * whose files the server replaced; one reload brings the new build. Reloads at most once per window, guarded by sessionStorage.
 */
export function reloadOnPreloadError(target: PreloadTarget, storage: Pick<Storage, 'getItem' | 'setItem'>, reload: () => void, now: () => number = Date.now): void {
  target.addEventListener('vite:preloadError', event => {
    const last = Number(readStored(storage));
    if (Number.isFinite(last) && last > 0 && now() - last < RELOAD_WINDOW_MS) return;
    try {
      storage.setItem(PRELOAD_RELOAD_KEY, String(now()));
    } catch {
      // Without a guard a reload could repeat forever, so none is made: the failure surfaces as it would without this handler.
      return;
    }
    // The reload replaces the failure, so Vite does not throw it at the code that asked for the file.
    event.preventDefault();
    reload();
  });
}

function readStored(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(PRELOAD_RELOAD_KEY);
  } catch {
    return null;
  }
}
