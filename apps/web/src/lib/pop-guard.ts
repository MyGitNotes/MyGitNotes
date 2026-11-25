import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Settles what a Back or Forward would leave unsaved; false keeps the app where it is. */
export type PopGuard = () => Promise<boolean>;

const guards = new Set<PopGuard>();
/** The history entry the app shows: React Router's `idx` and `key` of it. */
let shown: { index: number | null; key: string | null; } = { index: null, key: null };
/** The traversals the guard made itself, in order, each with the index it goes to: returns to the entry shown, then the replay of the person's own. */
const own: { kind: 'return' | 'replay'; index: number; }[] = [];
let busy = false;
/** Resolves once every return the guard started has landed: a browser drops a traversal asked for while another is under way. */
let landed: Promise<void> = Promise.resolve();
let land = () => {};
/** How long a return may take to land before the guard stops waiting for it. */
const LANDING = 1000;
const goBack = (target: Window, from: number, to: number) => {
  if (!own.some(entry => entry.kind === 'return')) landed = new Promise(resolve => void (land = resolve));
  own.push({ kind: 'return', index: to });
  target.history.go(to - from);
};

const entryOf = (state: unknown) => {
  const { idx, key } = (state ?? {}) as { idx?: unknown; key?: unknown; };
  return { index: typeof idx === 'number' ? idx : null, key: typeof key === 'string' ? key : null };
};

/**
 * Holds Back and Forward while a guard is registered: the browser has already moved to the other entry, so the guard
 * stops the router hearing of it, returns the address to the entry the app shows, and runs every guard. When they all
 * settle the person's traversal is made again for the router, unless the app went elsewhere meanwhile; when one
 * refuses, the app and its address stay. The history is only traversed, never rewritten, so every entry keeps its
 * address and state. Registered before the router listens (at load), so its listener runs first.
 */
export function installPopGuard(target: Window): () => void {
  const pop = (event: PopStateEvent) => {
    const { index } = entryOf(event.state);
    const next = own[0];
    if (next) {
      own.shift();
      if (next.index === index) {
        // The return to the entry shown is the guard's own: the router never hears of it.
        if (next.kind === 'return') {
          event.stopImmediatePropagation();
          if (!own.some(entry => entry.kind === 'return')) land();
        }
        return;
      }
      // Not the traversal the guard made: the ones it waits for are out of date, and this one is the person's.
      own.length = 0;
      land();
    }
    if (!guards.size || index === null || shown.index === null || index === shown.index) return;
    event.stopImmediatePropagation();
    // Another Back or Forward while the guards run is put back too; the first one is made once they settle.
    if (busy) return goBack(target, index, shown.index);
    const origin = { ...shown }, delta = index - shown.index;
    busy = true;
    goBack(target, index, shown.index);
    void (async () => {
      let settled = true;
      for (const guard of guards) {
        settled = await guard().catch(() => false);
        if (!settled) break;
      }
      await Promise.race([landed, new Promise(resolve => setTimeout(resolve, LANDING))]);
      busy = false;
      // A refused save keeps the app where it is; an app that went elsewhere meanwhile (a link, the top bar) makes the traversal out of date.
      if (!settled || shown.index !== origin.index || shown.key !== origin.key) return;
      own.push({ kind: 'replay', index: origin.index! + delta });
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
    shown = entryOf(window.history.state);
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
