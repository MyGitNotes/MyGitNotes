/*
 * Typing a built-in live editor tab has not stored on the server yet (docs/specs/2026-11-16-collab-first-self-host
 * A3.1), kept in this browser so that a reload, a crash or leaving the note loses none of it: the tab's Yjs update for
 * the document it was typed in, its text, and the text it was typed on (the merge base). One entry per editor session
 * (cf16-F004): two tabs, or zoom over a Focus pane, never overwrite each other, and a session takes another's entry only
 * once that session ended ({@link liveOwnerClaim}). IndexedDB where the browser has it, else a store that lasts as long
 * as the page.
 */

/** One note's unsynced live typing, as this browser keeps it. */
export interface UnsyncedLiveText {
  /** {@link unsyncedKey} of its scope, notebook, path and owner. */
  key: string;
  /** The editor session that keeps it: random per session, held as a claim while the session runs. */
  owner: string;
  /** The repository's draft scope, so the offline screen shows only the session's own. */
  scope: string;
  notebookId: string;
  path: string;
  title?: string;
  /** The Yjs document the typing was made in: `<link id>.<epoch>`. */
  document: string;
  /** `Y.encodeStateAsUpdate` of the tab's document. */
  update: Uint8Array;
  /** The text the update holds. */
  text: string;
  /** The text at the tab's last full sync: what a merge takes as its base. */
  baseText: string;
  /** The merge's idempotency key. */
  mergeId: string;
  savedAt: number;
}

export interface UnsyncedLiveStore {
  get(key: string): Promise<UnsyncedLiveText | undefined>;
  put(entry: UnsyncedLiveText): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<UnsyncedLiveText[]>;
}

/** Where one session keeps a note's typing. */
export const unsyncedKey = (scope: string, notebookId: string, path: string, owner: string) => `${scope}\n${notebookId}\n${path}\n${owner}`;
/** The claim a session holds while it runs: its entries are no other session's to take. */
export const liveOwnerClaim = (owner: string) => `mygitnotes-live-owner:${owner}`;
/** The entries every session kept for one note, oldest first. */
export const unsyncedOf = async (store: UnsyncedLiveStore, scope: string, notebookId: string, path: string) => (await store.list()).filter(entry => entry.scope === scope && entry.notebookId === notebookId && entry.path === path).sort((a, b) => a.savedAt - b.savedAt);
/**
 * Moves what sessions kept for a note to its new path after a move or rename, or drops it after a deletion (`to` null),
 * so no typing is left under a path no note has. The sessions that kept it ended: a file action waits until its editor
 * stored everything.
 */
export async function relocateUnsynced(store: UnsyncedLiveStore, scope: string, notebookId: string, path: string, to: string | null): Promise<void> {
  for (const entry of await unsyncedOf(store, scope, notebookId, path)) {
    if (to !== null) await store.put({ ...entry, path: to, key: unsyncedKey(scope, notebookId, to, entry.owner) });
    await store.delete(entry.key);
  }
}

const isEntry = (value: unknown): value is UnsyncedLiveText => {
  const entry = value as UnsyncedLiveText | null;
  return Boolean(entry) && typeof entry!.key === 'string' && typeof entry!.document === 'string' && entry!.update instanceof Uint8Array && typeof entry!.text === 'string' && typeof entry!.baseText === 'string' && typeof entry!.mergeId === 'string' && typeof entry!.owner === 'string' && typeof entry!.scope === 'string' && typeof entry!.notebookId === 'string' && typeof entry!.path === 'string';
};

/** A store that lasts as long as the page: where the browser has no IndexedDB, or it refuses to open. */
export function memoryUnsyncedStore(): UnsyncedLiveStore {
  const entries = new Map<string, UnsyncedLiveText>();
  return { get: async key => entries.get(key), put: async entry => void entries.set(entry.key, entry), delete: async key => void entries.delete(key), list: async () => [...entries.values()] };
}

const DATABASE = 'mygitnotes-live';
const STORE = 'unsynced';

/** IndexedDB's store; every call falls back to `fallback` once the database cannot be opened. */
function indexedDbUnsyncedStore(factory: IDBFactory, fallback: UnsyncedLiveStore): UnsyncedLiveStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const database = () =>
    opened ??= new Promise(resolve => {
      try {
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => void request.result.createObjectStore(STORE, { keyPath: 'key' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest, read: (request: IDBRequest) => T, otherwise: () => Promise<T>): Promise<T> => {
    const db = await database();
    if (!db) return otherwise();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(read(request));
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  };
  return { get: key => run('readonly', store => store.get(key), request => isEntry(request.result) ? request.result : undefined, () => fallback.get(key)), put: entry => run('readwrite', store => store.put(entry), () => undefined, () => fallback.put(entry)), delete: key => run('readwrite', store => store.delete(key), () => undefined, () => fallback.delete(key)), list: () => run('readonly', store => store.getAll(), request => (request.result as unknown[]).filter(isEntry), () => fallback.list()) };
}

let store: UnsyncedLiveStore | null = null;

/** The browser's store of unsynced live typing. */
export function unsyncedLiveStore(): UnsyncedLiveStore {
  if (!store) {
    const fallback = memoryUnsyncedStore();
    store = typeof indexedDB === 'undefined' ? fallback : indexedDbUnsyncedStore(indexedDB, fallback);
  }
  return store;
}
