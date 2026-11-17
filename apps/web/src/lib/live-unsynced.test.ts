// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { forgetNoteDrafts } from './storage.js';
import { unsyncedKey, unsyncedLiveStore, type UnsyncedLiveText } from './live-unsynced.js';

/*
 * cf16-F012: the typing editors kept for a note follows it when it is moved or renamed, so none is left under a path no
 * note has, to be merged into a note later made there.
 */
const store = unsyncedLiveStore();
const entry = (path: string, owner: string, text: string): UnsyncedLiveText => ({ key: unsyncedKey('repo:main', 'notes~life', path, owner), owner, scope: 'repo:main', notebookId: 'notes~life', path, document: 'abc.1', update: new Uint8Array([0, 0]), text, baseText: '', mergeId: `merge-${owner}`, savedAt: 1 });
afterEach(async () => {
  for (const kept of await store.list()) await store.delete(kept.key);
});

it('moves the typing kept for a note to where it was moved, and leaves other notes’ alone', async () => {
  await store.put(entry('notes/life/a.md', 'one', '# A\none\n'));
  await store.put(entry('notes/life/a.md', 'two', '# A\ntwo\n'));
  await store.put(entry('notes/life/b.md', 'one', '# B\n'));
  await forgetNoteDrafts('repo:main', 'notes~life', 'notes/life/a.md', 'notes/life/trips/a2.md');
  const kept = (await store.list()).map(item => [item.path, item.text, item.key]).sort();
  expect(kept).toEqual([['notes/life/b.md', '# B\n', unsyncedKey('repo:main', 'notes~life', 'notes/life/b.md', 'one')], ['notes/life/trips/a2.md', '# A\none\n', unsyncedKey('repo:main', 'notes~life', 'notes/life/trips/a2.md', 'one')], ['notes/life/trips/a2.md', '# A\ntwo\n', unsyncedKey('repo:main', 'notes~life', 'notes/life/trips/a2.md', 'two')]]);
});

/** An IndexedDB of one object store that records each transaction's writes and applies them only when it completes. */
function recordingIndexedDb() {
  const rows = new Map<string, UnsyncedLiveText>();
  const transactions: { mode: IDBTransactionMode; writes: string[]; }[] = [];
  const db = {
    transaction: (_store: string, mode: IDBTransactionMode) => {
      const pending: (() => void)[] = [], writes: string[] = [];
      transactions.push({ mode, writes });
      const transaction = { oncomplete: null as null | (() => void), onerror: null, onabort: null, error: null, objectStore: () => store };
      const request = (result: unknown) => ({ result });
      const store = { put: (entry: UnsyncedLiveText) => (writes.push(`put ${entry.key}`), pending.push(() => rows.set(entry.key, entry)), request(entry.key)), delete: (key: string) => (writes.push(`delete ${key}`), pending.push(() => rows.delete(key)), request(undefined)), get: (key: string) => request(rows.get(key)), getAll: () => request([...rows.values()]) };
      queueMicrotask(() => {
        for (const write of pending) write();
        transaction.oncomplete?.();
      });
      return transaction;
    },
  };
  const factory = {
    open: () => {
      const request = { result: db, onsuccess: null as null | (() => void), onerror: null, onblocked: null, onupgradeneeded: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
  return { factory, rows, transactions };
}

it('moves a session’s kept typing to its new key in one transaction, so a crash leaves it under one key only (review6 F001)', async () => {
  const { indexedDbUnsyncedStore, memoryUnsyncedStore } = await import('./live-unsynced.js');
  const idb = recordingIndexedDb();
  const kept = indexedDbUnsyncedStore(idb.factory, memoryUnsyncedStore());
  const from = entry('notes/life/a.md', 'one', '# A\n');
  await kept.put(from);
  const to = { ...from, path: 'notes/life/trips/a.md', key: unsyncedKey('repo:main', 'notes~life', 'notes/life/trips/a.md', 'one') };
  idb.transactions.length = 0;
  await kept.move(to, from.key);
  expect(idb.transactions).toEqual([{ mode: 'readwrite', writes: [`delete ${from.key}`, `put ${to.key}`] }]);
  expect([...idb.rows.keys()]).toEqual([to.key]);
});
