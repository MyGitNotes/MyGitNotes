import { createHash, randomBytes } from 'node:crypto';
import { type CommitAuthor, type EditionSourceConfig, type LiveContext, type LiveNotice, parseWorkspaceConfig, sourceIdentity } from '@mygitnotes/core';
import { createClient } from 'redis';
import * as Y from 'yjs';
import { memoryCommitCounter, MemoryEditionSource, type MemoryFiles } from '../memory-edition-source.js';
import { type MemoryLiveClock, memoryLiveClock } from '../memory-live-notes.js';
import { type BuiltinLiveLimits, type BuiltinLiveParts, createBuiltinLiveNotes } from './adapter.js';
import { memoryLiveStore } from './memory-store.js';
import { redisLiveStore } from './redis-store.js';
import { redisTestTurn } from './redis-test-turn.js';
import type { LiveStore, StoredDocument } from './store.js';
import { type BuiltinLiveNotesWithHooks, withLiveHooks } from './testing.js';

/* What the tests of the built-in live editor share: one covered repository over memory Git files, people, and stores to break. */

export const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
export const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
export const repository = sourceIdentity(edition);
export const notebook = 'notes~life';
/** The n-th person, with a verified author. */
export const person = (n: number): LiveContext => ({ person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` }, request: { headers: {} } });
export const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text.replace(/[\r\0]/g, ''), 'utf8')).digest('hex');

/** The text an epoch's stored document holds: its state, then its log in order, as any process loads it. */
export function storedText(stored: StoredDocument | null): string | null {
  if (!stored) return null;
  const document = new Y.Doc();
  Y.applyUpdate(document, stored.state);
  for (const update of stored.log) Y.applyUpdate(document, update);
  return document.getText('content').toString();
}

/** `store` with some of its calls replaced; a replacement reaches the real call through `store`. */
export const wrapStore = (store: LiveStore, calls: Partial<LiveStore>): LiveStore => ({ ...store, ...calls });

/** Something that waits until it is opened. */
export function gate(): { opened: Promise<void>; open(): void; } {
  let open!: () => void;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  return { opened, open };
}

/** Lets everything already scheduled run. */
export const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise(resolve => setImmediate(resolve));
};

export interface BuiltinFixture extends BuiltinLiveParts {
  liveNotes: BuiltinLiveNotesWithHooks;
  files: MemoryFiles;
  time: MemoryLiveClock;
  notices: LiveNotice[];
}

const made: BuiltinLiveNotesWithHooks[] = [];

/**
 * A built-in adapter over the one covered repository. Two fixtures given the same `store`, `files` and `time` are two
 * processes of one deployment.
 */
export function builtinFixture(options: { store?: LiveStore; files?: MemoryFiles; time?: MemoryLiveClock; limits?: Partial<BuiltinLiveLimits>; appUrl?: string; } = {}): BuiltinFixture {
  const files: MemoryFiles = options.files ?? new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
  const time = options.time ?? memoryLiveClock();
  const notices: LiveNotice[] = [];
  const scope = async () => parseWorkspaceConfig(manifest);
  const parts = createBuiltinLiveNotes({ covers: id => id === repository, open: async (_repository, author?: CommitAuthor) => new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, scope, author), store: options.store ?? memoryLiveStore(), notify: async notice => void notices.push(notice), clock: time.now, ...(options.limits ? { limits: options.limits } : {}), ...(options.appUrl !== undefined ? { appUrl: options.appUrl } : {}) });
  const liveNotes = withLiveHooks(parts);
  made.push(liveNotes);
  return { ...parts, liveNotes, files, time, notices };
}

/** Stops every fixture made since the last call: their documents are compacted and let go, and no timer is left. */
export async function shutdownFixtures(): Promise<void> {
  await Promise.all(made.splice(0).map(liveNotes => liveNotes.shutdown()));
}

/**
 * Live stores on a throwaway Redis, each under its own random prefix. `begin` (in `beforeAll`) waits for this file's
 * turn on the server; `end` (in `afterAll`) deletes every key the stores made, answers how many are left, and gives the
 * turn back.
 */
export function redisTestStores(url: string | undefined) {
  const run = `mgn-test:${randomBytes(8).toString('hex')}`;
  const turn = redisTestTurn(url);
  let prefixes = 0;
  return {
    store: (): LiveStore => redisLiveStore({ url: url!, prefix: `${run}:${++prefixes}` }),
    begin: () => turn.take(),
    async end(): Promise<number> {
      const raw = createClient({ url, socket: { connectTimeout: 10_000, reconnectStrategy: false } });
      raw.on('error', () => {});
      await raw.connect();
      try {
        const scan = async () => {
          const keys: string[] = [];
          let cursor = '0';
          do {
            const [next, found] = await raw.sendCommand(['SCAN', cursor, 'MATCH', `${run}:*`, 'COUNT', '1000']) as [string, string[]];
            keys.push(...found);
            cursor = next;
          } while (cursor !== '0');
          return keys;
        };
        const keys = await scan();
        for (let i = 0; i < keys.length; i += 500) await raw.sendCommand(['DEL', ...keys.slice(i, i + 500)]);
        return (await scan()).length;
      } finally {
        raw.destroy();
        await turn.give();
      }
    },
  };
}
