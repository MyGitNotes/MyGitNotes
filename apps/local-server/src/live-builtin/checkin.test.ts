import { checkInLink, gitBlobId, type LiveCheckInOptions, liveContentHash, normalizeLiveText, parseWorkspaceConfig, sweepIdleLive, sweepLive } from '@mygitnotes/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource } from '../memory-edition-source.js';
import { memoryLiveClock } from '../memory-live-notes.js';
import { memoryLiveStore } from './memory-store.js';
import type { LiveStore } from './store.js';
import { type BuiltinFixture, builtinFixture, edition, manifest, notebook, person, redisTestStores, repository, shutdownFixtures } from './test-fixture.js';

/*
 * The 0.19 check-in engine over the built-in adapter (docs/specs/2026-11-15-builtin-live-editor §5, §19; slice N3): the
 * engine is unchanged, so these pin what the adapter owes it: who typed, the text at one instant, merges that land in
 * the document, and drafts it can discard.
 */

const file = 'notes/life/a.md';
const A = '---\ntitle: A\n---\none\ntwo\nthree\nfour\nfive\n';
// 20:00 UTC is 04:00 the next day in Taipei.
const setup = () => builtinFixture({ files: new Map([['.mygitnotes.yaml', manifest], [file, A]]), time: memoryLiveClock(Date.parse('2026-11-14T20:00:00.000Z')) });
const git = (f: BuiltinFixture) => new MemoryEditionSource(edition, f.files, true, memoryCommitCounter(f.files), undefined, async () => parseWorkspaceConfig(manifest));
/** A commit someone makes in Git directly. */
const gitCommit = async (f: BuiltinFixture, content: string) => {
  const source = git(f);
  const snapshot = await source.getSnapshot(true);
  return (await source.commitChanges([{ path: file, content }], snapshot.sha, 'write', 'notes', undefined, snapshot)).revision;
};
const commits = (f: BuiltinFixture) => memoryCommits(f.files).filter(commit => commit.message !== 'Memory state');
const checkout = async (f: BuiltinFixture) => {
  const snapshot = await git(f).getSnapshot(true);
  const content = f.files.get(file)!;
  return (await f.liveNotes.person(person(1)).checkout(repository, { notebook, path: file, base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(content), 40), content: normalizeLiveText(content) } })).checkout.id;
};
const pending = (f: BuiltinFixture, content: string, pathRule = 'inbox/{{title}}.md') => f.liveNotes.person(person(1)).createPending(repository, { notebook, pathRule, content });
const type = (f: BuiltinFixture, id: string, text: string, n: number) => f.liveNotes.type(repository, id, text, person(n));
const liveText = async (f: BuiltinFixture, id: string) => (await f.liveNotes.person(person(1)).read(repository, id)).content;
const run = (f: BuiltinFixture, id: string, options: Partial<LiveCheckInOptions> = {}) => checkInLink(f.liveNotes, repository, id, { mode: 'manual', now: f.time.now, timeZone: 'Asia/Taipei', sleep: async () => {}, ...options });
const sweep = (f: BuiltinFixture) => sweepLive(f.liveNotes, { instant: new Date(f.time.now() + 1000), now: f.time.now, timeZone: 'Asia/Taipei', sleep: async () => {} });

afterEach(async () => {
  await shutdownFixtures();
  vi.restoreAllMocks();
});

describe('checkInLink over the built-in adapter', () => {
  it('only acknowledges a note nobody changed, and closes it', async () => {
    const f = setup();
    const id = await checkout(f);
    expect(await run(f, id)).toEqual({ id, path: file, committed: false, released: true });
    expect(commits(f)).toEqual([]);
    expect(await f.liveNotes.service.checkouts(repository)).toEqual([]);
    expect(await f.liveNotes.person(person(1)).filed(repository, id)).toBe(file);
  });

  it("makes one commit: the first person as author, the second as co-author, Agent-Edit for an agent's write, and the live trailers", async () => {
    const f = setup();
    const id = await checkout(f);
    await type(f, id, A.replace('two', 'TWO'), 1);
    f.time.advance(1000);
    await type(f, id, A.replace('two', 'TWO').replace('three', 'THREE'), 2);
    f.time.advance(1000);
    const current = await f.liveNotes.person(person(3)).read(repository, id);
    await f.liveNotes.person(person(3)).write(repository, id, { content: `${current.content}agent line\n`, baseRevision: current.liveRevision, agent: true });
    const text = await liveText(f, id);
    expect(text).toBe('---\ntitle: A\n---\none\nTWO\nTHREE\nfour\nfive\nagent line\n');
    const result = await run(f, id);
    expect(result).toEqual({ id, path: file, committed: true, commit: expect.stringMatching(/^[0-9a-f]{40}$/), released: true });
    expect(f.files.get(file)).toBe(text);
    expect(commits(f)).toHaveLength(1);
    const [commit] = commits(f);
    expect(commit.author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
    expect(commit.message).toBe(`docs(notes): live edit a.md\n\nLive-Link: ${id}\nLive-Content: sha256:${liveContentHash(text)}\nAgent-Edit: 2026-11-14\nCo-authored-by: Person 2 <p2@example.test>\nCo-authored-by: Person 3 <p3@example.test>`);
    // The note left the live editor: its document is gone from the store, and its link says where it is.
    expect(await f.store.link(id)).toMatchObject({ live: false, path: file });
    expect(await f.store.document(id, 1)).toBeNull();
    expect(await f.store.editors(id)).toEqual([]);
  });

  it("lands Git's changes in the document before it commits, so the next check-in keeps them", async () => {
    const f = setup();
    const id = await checkout(f);
    await f.liveNotes.setActive(repository, id, 1);
    await type(f, id, A.replace('five', 'FIVE'), 1);
    await gitCommit(f, A.replace('one', 'ONE'));
    const mergeIn = f.liveNotes.service.mergeIn.bind(f.liveNotes.service);
    const atMerge: { commits: number; text: string; }[] = [];
    vi.spyOn(f.liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
      const answer = await mergeIn(...args);
      atMerge.push({ commits: commits(f).length, text: await liveText(f, id) });
      return answer;
    });
    const merged = A.replace('one', 'ONE').replace('five', 'FIVE');
    expect(await run(f, id, { mode: 'scheduled' })).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 1 });
    // The merge was in the document while Git held only the direct commit.
    expect(atMerge).toEqual([{ commits: 1, text: merged }]);
    expect(await liveText(f, id)).toBe(merged);
    expect(f.files.get(file)).toBe(merged);
    expect(commits(f).at(-1)!.author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
    // The merge was nobody's edit, and the commit cleared who typed before it.
    expect(await f.store.editors(id)).toEqual([]);
    // Typed on after the check-in: the next one starts from the merged text and keeps Git's change.
    await type(f, id, merged.replace('three', 'THREE'), 2);
    f.time.advance(6 * 60_000);
    expect(await run(f, id, { mode: 'scheduled' })).toMatchObject({ committed: true });
    expect(f.files.get(file)).toBe(merged.replace('three', 'THREE'));
    expect(commits(f).at(-1)!.author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
  });

  it('names someone who typed between the merge-in and the text it commits', async () => {
    const f = setup();
    const id = await checkout(f);
    await type(f, id, A.replace('five', 'FIVE'), 1);
    await gitCommit(f, A.replace('one', 'ONE'));
    const merged = A.replace('one', 'ONE').replace('five', 'FIVE');
    const mergeIn = f.liveNotes.service.mergeIn.bind(f.liveNotes.service);
    vi.spyOn(f.liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
      const answer = await mergeIn(...args);
      f.time.advance(1000);
      await type(f, id, `${merged}six\n`, 2);
      return answer;
    });
    expect(await run(f, id)).toMatchObject({ committed: true, released: true });
    expect(f.files.get(file)).toBe(`${merged}six\n`);
    const commit = commits(f).at(-1)!;
    expect(commit.author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
    expect(commit.message).toContain('Co-authored-by: Person 2 <p2@example.test>');
  });

  it('keeps someone who typed after its read for the next check-in: not named in this commit, not lost, and the note stays open', async () => {
    const f = setup();
    const id = await checkout(f);
    const first = A.replace('two', 'TWO');
    await type(f, id, first, 1);
    // The second person types after the check-in read the text and before its commit is acknowledged.
    const open = f.liveNotes.service.open.bind(f.liveNotes.service);
    vi.spyOn(f.liveNotes.service, 'open').mockImplementationOnce(async (...args) => {
      await type(f, id, `${first}late\n`, 2);
      return open(...args);
    });
    expect(await run(f, id)).toMatchObject({ committed: true, released: false, reason: 'changed' });
    expect(f.files.get(file)).toBe(first);
    expect(commits(f)).toHaveLength(1);
    expect(commits(f)[0].author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
    expect(commits(f)[0].message).not.toContain('Person 2');
    expect(await liveText(f, id)).toBe(`${first}late\n`);
    expect((await f.store.editors(id)).map(editor => editor.email)).toEqual(['p2@example.test']);
    // The next check-in, once the lease of this one ran out, commits their typing in their name and closes the note.
    f.time.advance(6 * 60_000);
    expect(await run(f, id)).toMatchObject({ committed: true, released: true });
    expect(f.files.get(file)).toBe(`${first}late\n`);
    expect(commits(f)).toHaveLength(2);
    expect(commits(f)[1].author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
    expect(commits(f)[1].message).not.toContain('Person 1');
  });

  it('lets the live text win a conflict, records what it overwrote on the row and notifies', async () => {
    const f = setup();
    const id = await checkout(f);
    await f.liveNotes.setActive(repository, id, 1);
    await type(f, id, A.replace('two', 'LIVE'), 1);
    const overwritten = await gitCommit(f, A.replace('two', 'GIT'));
    const result = await run(f, id, { mode: 'scheduled' });
    expect(result).toMatchObject({ committed: true, released: false, reason: 'active', conflict: { kind: 'overwrote', overwritten, commit: result.commit } });
    expect(f.files.get(file)).toBe(A.replace('two', 'LIVE'));
    expect(commits(f).at(-1)!.message).toContain(`\nLive-Overwrote: ${overwritten}`);
    expect(f.notices).toEqual([expect.objectContaining({ kind: 'conflict', repository, notebook, path: file, id, commit: result.commit, overwritten, editors: [{ name: 'Person 1' }] })]);
    expect((await f.liveNotes.service.checkouts(repository))[0]).toMatchObject({ id, conflict: result.conflict, base: { commit: result.commit } });
  });

  it('ends its lease when the release is refused, so the next 立即簽回 runs at once instead of answering leased', async () => {
    const f = setup();
    const id = await checkout(f);
    await f.liveNotes.setActive(repository, id, 1);
    await type(f, id, A.replace('two', 'TWO'), 1);
    expect(await run(f, id)).toMatchObject({ committed: true, released: false, reason: 'active', activeEditors: 1 });
    f.time.advance(1000);
    expect(await run(f, id)).toMatchObject({ committed: false, released: false, reason: 'active' });
    await f.liveNotes.setActive(repository, id, 0);
    f.time.advance(1000);
    expect(await run(f, id)).toMatchObject({ released: true });
    expect(commits(f)).toHaveLength(1);
  });

  it('makes one commit when two check-ins of a note run at once: its lease lets one through', async () => {
    const f = setup();
    const id = await checkout(f);
    await type(f, id, A.replace('two', 'TWO'), 1);
    const results = await Promise.all([run(f, id), run(f, id)]);
    expect(results.map(result => result.reason ?? 'done').sort()).toEqual(['done', 'leased']);
    expect(commits(f)).toHaveLength(1);
    expect(await f.liveNotes.service.checkouts(repository)).toEqual([]);
  });
});

describe('pending notes through the check-in', () => {
  it("files a typed pending note by its rule, in the typist's name, and says where it went", async () => {
    const f = setup();
    const draft = await pending(f, '---\ntitle: 一字\n---\n');
    await type(f, draft.id, '---\ntitle: 一字\n---\n字\n', 2);
    expect(await run(f, draft.id)).toMatchObject({ id: draft.id, path: 'notes/life/inbox/一字.md', committed: true, released: true, filed: true });
    expect(f.files.get('notes/life/inbox/一字.md')).toBe('---\ntitle: 一字\n---\n字\n');
    expect(commits(f)).toHaveLength(1);
    expect(commits(f)[0]).toMatchObject({ author: { name: 'Person 2', email: 'p2@example.test' }, paths: ['notes/life/inbox/一字.md'] });
    expect(commits(f)[0].message.split('\n')[0]).toBe('docs(notes): file live note 一字.md');
    expect(await f.liveNotes.person(person(1)).filed(repository, draft.id)).toBe('notes/life/inbox/一字.md');
    expect(await f.store.initialText(draft.id)).toBeNull();
  });

  it('discards an empty draft at 「立即簽回」 whoever typed in it: no commit, and nothing of it is left', async () => {
    const f = setup();
    const template = '---\ntitle: 週會\n---\n# 週會\n\n## 待辦\n- \n';
    const draft = await pending(f, template);
    await type(f, draft.id, `${template}- \n\n  \n`, 2);
    expect(await run(f, draft.id)).toEqual({ id: draft.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(commits(f)).toEqual([]);
    expect(await f.store.link(draft.id)).toBeNull();
    expect(await f.store.document(draft.id, 1)).toBeNull();
    expect(await f.liveNotes.person(person(1)).filed(repository, draft.id)).toBeNull();
    expect(await f.liveNotes.service.repositories()).toEqual([]);
  });

  it('lets the sweep discard a draft nobody typed in, whatever it began with, and file the one someone typed content in', async () => {
    const f = setup();
    const untyped = await pending(f, '---\ntitle: Kept\n---\n\nA body the template gave it.\n');
    const typed = await pending(f, '---\ntitle: Typed\n---\n');
    await type(f, typed.id, '---\ntitle: Typed\n---\nWords.\n', 2);
    const report = await sweep(f);
    expect(report).toMatchObject({ due: 2, failed: [] });
    expect(report.results).toContainEqual({ id: untyped.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(report.results).toContainEqual(expect.objectContaining({ id: typed.id, path: 'notes/life/inbox/Typed.md', committed: true, released: true, filed: true }));
    expect(commits(f).map(commit => commit.paths)).toEqual([['notes/life/inbox/Typed.md']]);
    expect(await f.liveNotes.service.checkouts(repository)).toEqual([]);
    expect(f.notices).toEqual([]);
  });
});

/*
 * The idle check-in (docs/specs/2026-11-16-collab-first-self-host A5, slice S1) over the built-in adapter: its rows say
 * who is active and when the note was last typed in, by the adapter's clock.
 */
const idleCheckIn = (store: () => LiveStore) => () => {
  it('makes one commit 5 minutes after two typists left, and none a second before', async () => {
    const f = builtinFixture({ store: store(), files: new Map([['.mygitnotes.yaml', manifest], [file, A]]), time: memoryLiveClock(Date.parse('2026-11-14T20:00:00.000Z')) });
    const idle = () => sweepIdleLive(f.liveNotes, { now: f.time.now, idleMs: 5 * 60_000, timeZone: 'Asia/Taipei', sleep: async () => {} });
    const id = await checkout(f);
    await f.liveNotes.setActive(repository, id, 2);
    await type(f, id, A.replace('two', 'TWO'), 1);
    f.time.advance(1000);
    await type(f, id, A.replace('two', 'TWO').replace('three', 'THREE'), 2);
    // Both are connected: however long the tick waits, nothing is due.
    expect(await idle()).toEqual({ due: 0, results: [], failed: [] });
    await f.liveNotes.setActive(repository, id, 0);
    f.time.advance(5 * 60_000 - 1000);
    expect(await idle()).toEqual({ due: 0, results: [], failed: [] });
    expect(commits(f)).toEqual([]);
    f.time.advance(1000);
    expect(await idle()).toEqual({ due: 1, results: [{ id, path: file, committed: true, commit: expect.stringMatching(/^[0-9a-f]{40}$/), released: true }], failed: [] });
    const text = A.replace('two', 'TWO').replace('three', 'THREE');
    expect(f.files.get(file)).toBe(text);
    expect(commits(f)).toHaveLength(1);
    expect(commits(f)[0].author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
    expect(commits(f)[0].message).toBe(`docs(notes): live edit a.md\n\nLive-Link: ${id}\nLive-Content: sha256:${liveContentHash(text)}\nCo-authored-by: Person 2 <p2@example.test>`);
    expect(await f.liveNotes.service.checkouts(repository)).toEqual([]);
    expect(await f.store.link(id)).toMatchObject({ live: false, path: file });
    f.time.advance(60_000);
    expect(await idle()).toEqual({ due: 0, results: [], failed: [] });
    expect(commits(f)).toHaveLength(1);
  });

  it('waits for an open tab that went idle: at most 10 minutes after its last activity', async () => {
    const f = builtinFixture({ store: store(), files: new Map([['.mygitnotes.yaml', manifest], [file, A]]), time: memoryLiveClock(Date.parse('2026-11-14T20:00:00.000Z')) });
    const idle = () => sweepIdleLive(f.liveNotes, { now: f.time.now, idleMs: 5 * 60_000, timeZone: 'Asia/Taipei', sleep: async () => {} });
    const id = await checkout(f);
    const opened = f.time.now();
    await type(f, id, A.replace('two', 'TWO'), 1);
    // The tab stays connected and does nothing more: its process keeps writing a presence entry that names its last activity.
    const present = () => f.store.presence(id, 'tab-process', { 'person:p1@example.test': opened }, f.time.now());
    await present();
    f.time.advance(9 * 60_000 + 59_000);
    await present();
    expect(await idle()).toEqual({ due: 0, results: [], failed: [] });
    f.time.advance(2000);
    await present();
    expect(await idle()).toMatchObject({ due: 1, results: [{ id, committed: true, released: true }] });
    expect(commits(f)).toHaveLength(1);
  });
};

describe('the idle check-in over the built-in adapter (memory store)', idleCheckIn(() => memoryLiveStore()));

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
describe.skipIf(!url)('the idle check-in over the built-in adapter and a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const redis = redisTestStores(url);
  beforeAll(() => redis.begin());
  afterAll(async () => {
    expect(await redis.end()).toBe(0);
  });
  idleCheckIn(() => redis.store())();
});
