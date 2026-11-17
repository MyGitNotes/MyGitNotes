import { checkInLink, gitBlobId, LiveNotLiveError, normalizeLiveText, parseWorkspaceConfig } from '@mygitnotes/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource } from '../memory-edition-source.js';
import { memoryLiveStore } from './memory-store.js';
import { type LiveServer, liveServer, stubLiveEnv, until } from './socket-fixture.js';
import type { LiveStore } from './store.js';
import { type BuiltinFixture, builtinFixture, edition, manifest, notebook, person, redisTestStores, repository, sha256, shutdownFixtures, storedText } from './test-fixture.js';

/*
 * Two app processes over one live store, as during a deploy overlap (docs/specs/2026-11-15-builtin-live-editor §7): the
 * store is the authority, so each process serves what the other was acknowledged, a check-in from either commits the
 * union, and neither's compaction drops the other's updates. People on different processes see each other within the
 * catch-up poll, not keystroke by keystroke.
 */

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
const file = 'notes/life/a.md';
const A = 'one\ntwo\nthree\nfour\n';

/** Two processes of one deployment: the same store, Git files and clock. */
const pair = (store: LiveStore) => {
  const one = builtinFixture({ store, files: new Map([['.mygitnotes.yaml', manifest], [file, A]]) });
  return { one, two: builtinFixture({ store, files: one.files, time: one.time }) };
};
const git = (f: BuiltinFixture) => new MemoryEditionSource(edition, f.files, true, memoryCommitCounter(f.files), undefined, async () => parseWorkspaceConfig(manifest));
const commits = (f: BuiltinFixture) => memoryCommits(f.files).filter(commit => commit.message !== 'Memory state');
const checkout = async (f: BuiltinFixture, n = 1) => {
  const snapshot = await git(f).getSnapshot(true);
  const content = f.files.get(file)!;
  return f.liveNotes.person(person(n)).checkout(repository, { notebook, path: file, base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(content), 40), content: normalizeLiveText(content) } });
};
const type = (f: BuiltinFixture, id: string, text: string, n: number) => f.liveNotes.type(repository, id, text, person(n));
const read = (f: BuiltinFixture, id: string) => f.liveNotes.person(person(1)).read(repository, id);
const liveText = async (f: BuiltinFixture, id: string) => (await read(f, id)).content;
const checkIn = (f: BuiltinFixture, id: string) => checkInLink(f.liveNotes, repository, id, { mode: 'manual', now: f.time.now, timeZone: 'Asia/Taipei', sleep: async () => {} });

const servers: LiveServer[] = [];

beforeEach(() => stubLiveEnv());
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await shutdownFixtures();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const twoProcesses = (name: string, makeStore: () => LiveStore) =>
  describe(`two processes over one ${name}`, () => {
    it("serve each other's typing as soon as the store has it, and a check-in from one commits both people's typing in both names", async () => {
      const { one, two } = pair(makeStore());
      const { id } = (await checkout(one)).checkout;
      expect((await checkout(two, 2)).outcome).toBe('joined');
      await type(one, id, A.replace('two', 'TWO'), 1);
      await type(two, id, A.replace('two', 'TWO').replace('four', 'FOUR'), 2);
      const both = 'one\nTWO\nthree\nFOUR\n';
      expect(await liveText(one, id)).toBe(both);
      expect(await liveText(two, id)).toBe(both);
      // Each still holds the document. One types again: the other serves it without being told.
      await type(one, id, `${both}from one\n`, 1);
      expect(await liveText(two, id)).toBe(`${both}from one\n`);
      one.time.advance(1000);
      await type(two, id, `${both}from one\nfrom two\n`, 2);
      const full = `${both}from one\nfrom two\n`;
      expect(await read(one, id)).toEqual({ content: full, liveRevision: `t:${sha256(full)}`, contentHash: sha256(full) });
      for (const process of [one, two]) expect((await process.liveNotes.service.checkouts(repository)).map(row => [row.id, row.contentHash])).toEqual([[id, sha256(full)]]);
      // A write on what one process handed out lands in the other's document too.
      const before = await read(one, id);
      await type(two, id, `${full}typed since\n`, 2);
      expect((await one.liveNotes.person(person(3)).write(repository, id, { content: full.replace('three', 'THREE'), baseRevision: before.liveRevision, agent: true })).changed).toBe(true);
      const written = `${full.replace('three', 'THREE')}typed since\n`;
      expect(await liveText(two, id)).toBe(written);
      expect(storedText(await one.store.document(id, 1))).toBe(written);
      const result = await checkIn(two, id);
      expect(result).toMatchObject({ id, path: file, committed: true, released: true });
      expect(one.files.get(file)).toBe(written);
      expect(commits(one)).toHaveLength(1);
      expect(commits(one)[0].author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
      expect(commits(one)[0].message).toContain('Co-authored-by: Person 2 <p2@example.test>');
      expect(commits(one)[0].message).toContain('Co-authored-by: Person 3 <p3@example.test>');
    });

    it('with a tab on each, show each tab what the other typed within six seconds, commit both from one, and tell both tabs when the note is released', async () => {
      const { one, two } = pair(makeStore());
      const first = await liveServer(one), next = await liveServer(two);
      servers.push(first, next);
      const id = await first.checkout();
      const tabOne = await first.tab(1), tabTwo = await next.tab(2);
      await Promise.all([tabOne.synced(), tabTwo.synced()]);
      // Both type at once, each into its own process.
      tabOne.type(A.replace('two', 'TWO'));
      tabTwo.type(A.replace('four', 'FOUR'));
      await Promise.all([tabOne.saved(), tabTwo.saved()]);
      const both = 'one\nTWO\nthree\nFOUR\n';
      // Acknowledged means stored: the store has the union before either tab has seen the other.
      expect(storedText(await one.store.document(id, 1))).toBe(both);
      await until('each tab shows what the other typed', () => tabOne.text() === both && tabTwo.text() === both, 6000);
      for (const process of [one, two]) expect((await process.liveNotes.service.checkouts(repository)).map(row => [row.id, row.contentHash, row.activeEditors])).toEqual([[id, sha256(both), 2]]);
      expect(await checkIn(one, id)).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 2 });
      expect(one.files.get(file)).toBe(both);
      expect(commits(one)).toHaveLength(1);
      expect(commits(one)[0].author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
      expect(commits(one)[0].message).toContain('Co-authored-by: Person 2 <p2@example.test>');
      // Both went idle with their tabs open: the next check-in, through the other process, releases the note under them.
      one.time.advance(10 * 60_000 + 1);
      expect(await checkIn(two, id)).toMatchObject({ committed: false, released: true });
      await until('both tabs were told the note is released', () => tabOne.told.length > 0 && tabTwo.told.length > 0, 6000);
      expect([tabOne.told, tabTwo.told]).toEqual([[{ type: 'released' }], [{ type: 'released' }]]);
    });

    it('tell the tabs on both processes, within the catch-up poll, each time the note is moved elsewhere, and not when it is only typed in', async () => {
      const { one, two } = pair(makeStore());
      const first = await liveServer(one), next = await liveServer(two);
      servers.push(first, next);
      const id = await first.checkout();
      const tabOne = await first.tab(1), tabTwo = await next.tab(2);
      await Promise.all([tabOne.synced(), tabTwo.synced()]);
      const retarget = async (target: string) => {
        const { service } = one.liveNotes;
        await service.retarget(repository, id, await service.lease(repository, id), { target });
      };
      // A rename through process one: the tab there is told at once, the tab on process two by its next catch-up.
      await retarget('notes/life/renamed.md');
      await until('both tabs were told the note moved', () => tabOne.told.length > 0 && tabTwo.told.length > 0, 6000);
      expect([tabOne.told, tabTwo.told]).toEqual([[{ type: 'moved' }], [{ type: 'moved' }]]);
      // Typing moves nothing.
      tabTwo.type(`${A}typed\n`);
      await tabTwo.saved();
      await until('the other tab shows the typing', () => tabOne.text() === `${A}typed\n`, 6000);
      expect([tabOne.told, tabTwo.told]).toEqual([[{ type: 'moved' }], [{ type: 'moved' }]]);
      // Moved again: each tab is told again, so each follows every retarget.
      await retarget('notes/life/archive/renamed.md');
      await until('both tabs were told the second move', () => tabOne.told.length > 1 && tabTwo.told.length > 1, 6000);
      expect([tabOne.told, tabTwo.told]).toEqual([[{ type: 'moved' }, { type: 'moved' }], [{ type: 'moved' }, { type: 'moved' }]]);
    });

    it('compact in turn without losing what the other appended: the stored state and log hold the union', async () => {
      const { one, two } = pair(makeStore());
      const { id } = (await checkout(one)).checkout;
      await type(one, id, `${A}a\n`, 1);
      await type(two, id, `${A}a\nb\n`, 2);
      // One compacts while it has never applied what two appended; then they go on, each on a document the other compacted under.
      await one.liveNotes.setActive(repository, id, 0);
      expect(storedText(await one.store.document(id, 1))).toBe(`${A}a\nb\n`);
      await type(two, id, `${A}a\nb\nc\n`, 2);
      await type(one, id, `${A}a\nb\nc\nd\n`, 1);
      await two.liveNotes.setActive(repository, id, 0);
      await type(two, id, `${A}a\nb\nc\nd\ne\n`, 2);
      await one.liveNotes.setActive(repository, id, 0);
      await two.liveNotes.setActive(repository, id, 0);
      const union = `${A}a\nb\nc\nd\ne\n`;
      const stored = (await one.store.document(id, 1))!;
      expect(stored).toMatchObject({ log: [], seq: 5 });
      expect(storedText(stored)).toBe(union);
      expect(await one.store.link(id)).toMatchObject({ seq: 5, contentSeq: 5, contentHash: sha256(union) });
      expect(await liveText(one, id)).toBe(union);
      expect(await liveText(two, id)).toBe(union);
      expect((await one.store.editors(id)).map(editor => [editor.email, editor.lastSeq])).toEqual([['p1@example.test', 4], ['p2@example.test', 5]]);
    });

    it("count each other's people, and after a release by one both refuse the note and nothing of it enters the reopened one", async () => {
      const { one, two } = pair(makeStore());
      const { id } = (await checkout(one)).checkout;
      await type(one, id, `${A}first epoch, by one\n`, 1);
      await type(two, id, `${A}first epoch, by one\nand by two\n`, 2);
      // Someone is connected to process two: process one counts them, and does not close the note under them.
      await two.liveNotes.setActive(repository, id, 1);
      expect((await one.liveNotes.service.checkouts(repository))[0].activeEditors).toBe(1);
      expect(await checkIn(one, id)).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 1 });
      await two.liveNotes.setActive(repository, id, 0);
      // Process two hands the text out once more, as to an agent that reads it.
      const handed = await read(two, id);
      const old = (await two.store.link(id))!;
      expect(two.documents.recall(old, handed.contentHash)).toBe(handed.content);
      one.time.advance(6 * 60_000);
      expect(await checkIn(one, id)).toMatchObject({ committed: false, released: true });
      // Process two was told nothing: it serves none of the note, takes no typing for it, and forgets the text it handed out.
      await expect(read(two, id)).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(type(two, id, 'late\n', 2)).rejects.toBeInstanceOf(LiveNotLiveError);
      await expect(two.liveNotes.person(person(3)).write(repository, id, { content: 'late\n', baseRevision: handed.liveRevision, agent: true })).rejects.toBeInstanceOf(LiveNotLiveError);
      expect(await two.liveNotes.service.checkouts(repository)).toEqual([]);
      expect(two.documents.recall(old, handed.contentHash)).toBeUndefined();
      expect(await two.liveNotes.person(person(2)).filed(repository, id)).toBe(file);
      // Reopened through process two, it is a new epoch on Git's text in both.
      const committed = one.files.get(file)!;
      const again = await checkout(two, 2);
      expect(again).toMatchObject({ outcome: 'reopened', checkout: { id, contentHash: sha256(committed) } });
      expect(await liveText(one, id)).toBe(committed);
      await type(one, id, `${committed}second epoch\n`, 1);
      expect(await liveText(two, id)).toBe(`${committed}second epoch\n`);
      expect(storedText(await two.store.document(id, 2))).toBe(`${committed}second epoch\n`);
      expect(await two.store.document(id, 1)).toBeNull();
      expect((await one.liveNotes.socketTicket(person(1), repository, id)).document).toBe(`${id}.2`);
    });
  });

twoProcesses('memory store', () => memoryLiveStore());

describe.skipIf(!url)('over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const redis = redisTestStores(url);
  beforeAll(() => redis.begin());
  afterAll(async () => {
    expect(await redis.end()).toBe(0);
  });
  twoProcesses('Redis', () => redis.store());
});
