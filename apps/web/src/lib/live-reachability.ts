/*
 * Whether the server can be reached, as the live requests found it (collab-first A3.2.1, cf16-F007): a request can fail
 * while the browser counts itself online (a weak signal, a captive portal, a network switch), and then no `online` event
 * comes. What waits for the server (the offline direct editor, the draft handover) also tries again once a live request
 * gets through, when the page shows again, and on a timer.
 */

const REACHABLE = 'mygitnotes:live-reachable';
let unreachable = false;

/** A live request failed for want of a connection. */
export function markUnreachable(): void {
  unreachable = true;
}

/** A live request got through: what waits for the server tries now, once per stretch out of reach. */
export function markReached(): void {
  if (!unreachable) return;
  unreachable = false;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REACHABLE));
}

/** Calls `retry` when the browser is back online, a live request got through, or the page shows again; answers how to stop. */
export function onReachable(retry: () => void): () => void {
  const visible = () => {
    if (document.visibilityState !== 'hidden') retry();
  };
  window.addEventListener('online', retry);
  window.addEventListener(REACHABLE, retry);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', retry);
    window.removeEventListener(REACHABLE, retry);
    document.removeEventListener('visibilitychange', visible);
  };
}

/** The first wait before a timed try, doubled after each one up to {@link RETRY_MAX_MS}. */
export const RETRY_FIRST_MS = 5000;
export const RETRY_MAX_MS = 60_000;

/**
 * Calls `retry` on a timer, 5 s, then doubling to a minute, until stopped. `backoff` carries the wait over to the next
 * timer, so a try that fails and starts a new one does not start over at 5 s.
 */
export function retryOnTimer(retry: () => void, backoff: { wait: number; } = { wait: RETRY_FIRST_MS }): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const next = () => {
    timer = setTimeout(() => {
      backoff.wait = Math.min(backoff.wait * 2, RETRY_MAX_MS);
      retry();
      next();
    }, backoff.wait);
  };
  next();
  return () => clearTimeout(timer);
}
