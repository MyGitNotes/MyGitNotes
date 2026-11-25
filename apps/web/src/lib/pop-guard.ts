import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Settles what a Back or Forward would leave unsaved; false keeps the app where it is. */
export type PopGuard = () => Promise<boolean>;

const guards = new Set<PopGuard>();
/** The history index (React Router's `idx`) of the entry the app shows. */
let shownIndex: number | null = null;
/** The traversals the guard made itself, in order: returns to the entry shown, then the replay of the person's own. */
const own: ('return' | 'replay')[] = [];
let busy = false;
/** Resolves once every return the guard started has landed: a browser drops a traversal asked for while another is under way. */
let landed: Promise<void> = Promise.resolve();
let land = () => {};
const goBack = (target: Window, delta: number) => {
  if (!own.includes('return')) landed = new Promise(resolve => void (land = resolve));
  own.push('return');
  target.history.go(delta);
};

const indexOf = (state: unknown) => {
  const index = (state as { idx?: unknown; } | null)?.idx;
  return typeof index === 'number' ? index : null;
};

/**
 * Holds Back and Forward while a guard is registered: the browser has already moved to the other entry, so the guard
 * stops the router hearing of it, returns the address to the entry the app shows, and runs every guard. When they all
 * settle the person's traversal is made again for the router; when one refuses, the app and its address stay. The
 * history is only traversed, never rewritten, so every entry keeps its address and state. Registered before the router
 * listens (at load), so its listener runs first.
 */
export function installPopGuard(target: Window): () => void {
  const pop = (event: PopStateEvent) => {
    const next = own[0];
    if (next) {
      own.shift();
      // The return to the entry shown is the guard's own: the router never hears of it.
      if (next === 'return') {
        event.stopImmediatePropagation();
        if (!own.includes('return')) land();
      }
      return;
    }
    const index = indexOf(event.state);
    if (!guards.size || index === null || shownIndex === null || index === shownIndex) return;
    event.stopImmediatePropagation();
    // Another Back or Forward while the guards run is put back too; the first one is made once they settle.
    if (busy) return goBack(target, shownIndex - index);
    const delta = index - shownIndex;
    busy = true;
    goBack(target, -delta);
    void (async () => {
      let settled = true;
      for (const guard of [...guards]) {
        settled = await guard().catch(() => false);
        if (!settled) break;
      }
      await landed;
      busy = false;
      if (!settled) return;
      own.push('replay');
      target.history.go(delta);
    })();
  };
  target.addEventListener('popstate', pop);
  return () => target.removeEventListener('popstate', pop);
}

/** Keeps the guard told which history entry the app shows; rendered inside the router. */
export function PopGuardSync() {
  const location = useLocation();
  useLayoutEffect(() => {
    shownIndex = indexOf(window.history.state);
  }, [location]);
  return null;
}

/** Registers `guard` while it is given: Back and Forward wait for it, and stay when it refuses. */
export function usePopGuard(guard: PopGuard | undefined) {
  useEffect(() => {
    if (!guard) return;
    guards.add(guard);
    return () => void guards.delete(guard);
  }, [guard]);
}
