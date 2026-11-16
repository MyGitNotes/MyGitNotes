/*
 * Typing a built-in live editor tab has not stored on the server yet (docs/specs/2026-11-16-collab-first-self-host A3.1).
 * Not implemented yet.
 */

/** One note's unsynced live typing, as this browser keeps it. */
export interface UnsyncedLiveText {
  /** {@link unsyncedKey} of its scope, notebook and path. */
  key: string;
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

export const unsyncedKey = (scope: string, notebookId: string, path: string) => `${scope}\n${notebookId}\n${path}`;

const none: UnsyncedLiveStore = { get: async () => undefined, put: async () => {}, delete: async () => {}, list: async () => [] };

/** The browser's store of unsynced live typing. */
export const unsyncedLiveStore = (): UnsyncedLiveStore => none;
