/**
 * Tracks whether a newer build of the app is waiting behind the one the page runs. The service worker never replaces an
 * open page by itself: the page shows a notice, and only the person's choice to reload swaps the version.
 */
export interface UpdateWorker {
  postMessage(message: unknown): void;
}

let waiting: UpdateWorker | null = null;
const listeners = new Set<() => void>();

export const subscribeUpdate = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether a newer version is installed and waiting for the person's go-ahead. */
export const getUpdateReady = () => waiting !== null;

/** Records a waiting worker; the page shows its notice. A worker installed with no controlling worker is a first install, not an update. */
export function announceUpdate(worker: UpdateWorker, controlled: boolean): void {
  if (!controlled || waiting === worker) return;
  waiting = worker;
  for (const listener of listeners) listener();
}

/** Forgets the waiting worker, as when the person chose "later". */
export function dismissUpdate(): void {
  if (!waiting) return;
  waiting = null;
  for (const listener of listeners) listener();
}

/** Tells the waiting worker to take over and reloads once it has; false when nothing waits. */
export function applyUpdate(container: { addEventListener(type: 'controllerchange', listener: () => void, options: { once: true; }): void; }, reload: () => void): boolean {
  if (!waiting) return false;
  // Only now: a controllerchange on the first install must not reload the page.
  container.addEventListener('controllerchange', reload, { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Test seam: forgets all state. */
export function resetUpdateStore(): void {
  waiting = null;
  listeners.clear();
}
