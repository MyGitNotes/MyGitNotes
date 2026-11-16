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
