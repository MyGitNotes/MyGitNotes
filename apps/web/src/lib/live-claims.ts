/*
 * Claims across the tabs of this browser (cf16-F004, cf16-F005), over the Web Locks API, which every browser the app
 * supports has: a lock is held while its tab lives and let go when the tab closes or crashes. This page also keeps
 * what it holds itself, which is all there is where the API is missing (a test's DOM).
 */

/** The names this page holds. */
const held = new Set<string>();

type Locks = { request(name: string, options: { ifAvailable: true; }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>; request(name: string, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>; };
const locks = (): Locks | undefined => (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: Locks; }).locks : undefined);

/**
 * Holds `name` until the answer is called: for the life of an editor session, so that no other tab or editor takes what
 * it keeps for its own.
 */
export function holdClaim(name: string): () => void {
  held.add(name);
  let release = () => {};
  const api = locks();
  if (api) {
    const done = new Promise<void>(resolve => {
      release = resolve;
    });
    void api.request(name, () => done).catch(() => {});
  }
  return () => {
    held.delete(name);
    release();
  };
}

/**
 * Takes `name` when no tab holds it now, and holds it until the answer is called; null when it is held. What a session
 * that ended (a closed or crashed tab, an editor that unmounted) left is taken this way.
 */
export function takeClaim(name: string): Promise<(() => void) | null> {
  if (held.has(name)) return Promise.resolve(null);
  const api = locks();
  if (!api) return Promise.resolve(holdClaim(name));
  // Held in this page from the moment it is asked for, so that two of its own sessions cannot both take it.
  held.add(name);
  return new Promise(resolve => {
    void api.request(name, { ifAvailable: true }, lock => {
      if (!lock) {
        held.delete(name);
        resolve(null);
        return undefined;
      }
      return new Promise<void>(done => {
        resolve(() => {
          held.delete(name);
          done();
        });
      });
    }).catch(() => {
      held.delete(name);
      resolve(null);
    });
  });
}

/** Runs `work` while this tab alone holds `name`; null, without running it, while another holds it. */
export async function withClaim<T>(name: string, work: () => Promise<T>): Promise<T | null> {
  const release = await takeClaim(name);
  if (!release) return null;
  try {
    return await work();
  } finally {
    release();
  }
}
