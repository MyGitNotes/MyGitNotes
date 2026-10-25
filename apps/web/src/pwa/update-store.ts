/**
 * Tracks whether a newer build of the app is waiting behind the one the page runs. The service worker never replaces an
 * open page by itself: the page shows a notice, and only the person's choice to reload swaps the version.
 */
export interface UpdateWorker {
  postMessage(message: unknown): void;
  /** A worker's lifecycle state; "activated" means it already took over. */
  readonly state?: string;
}

/** The part of `navigator.serviceWorker` the store reads: which worker controls the page, and when that changes. */
export interface WorkerContainer {
  readonly controller: unknown;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

let waiting: UpdateWorker | null = null;
/** The waiting worker took over the page's tab (this one or another); reloading now loads the new version at once. */
let swapped = false;
let pendingReload: (() => void) | null = null;
const watched = new WeakSet<object>();
const listeners = new Set<() => void>();

export const subscribeUpdate = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether a newer version is installed and waiting for the person's go-ahead. */
export const getUpdateReady = () => waiting !== null;

const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Every tab that announced an update hears the swap, whichever tab asked for it: the worker takes all open pages
 * (`clients.claim()`), so a tab that did not click Reload still sees the controller change, and its own Reload then works at once.
 */
function watchController(container: WorkerContainer): void {
  if (watched.has(container)) return;
  watched.add(container);
  container.addEventListener('controllerchange', () => {
    swapped = true;
    const reload = pendingReload;
    pendingReload = null;
    reload?.();
  });
}

/** Records a waiting worker; the page shows its notice. A worker installed with no controlling worker is a first install, not an update. */
export function announceUpdate(worker: UpdateWorker, container: WorkerContainer): void {
  if (container.controller === null || waiting === worker) return;
  waiting = worker;
  swapped = false;
  // Only now: a controllerchange on the first install must not count as a swap.
  watchController(container);
  notify();
}

/** Forgets the waiting worker, as when the person chose "later". */
export function dismissUpdate(): void {
  if (!waiting) return;
  waiting = null;
  notify();
}

/**
 * Takes the waiting version: reloads at once when it already controls the page (another tab applied it), otherwise tells it to
 * take over and reloads once it has. False when nothing waits.
 */
export function applyUpdate(container: WorkerContainer, reload: () => void): boolean {
  if (!waiting) return false;
  if (swapped || waiting.state === 'activated' || container.controller === waiting) {
    reload();
    return true;
  }
  pendingReload = reload;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Test seam: forgets all state. */
export function resetUpdateStore(): void {
  waiting = null;
  swapped = false;
  pendingReload = null;
  listeners.clear();
}
