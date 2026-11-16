import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInLink, createLiveIdleBackoff, type EditionSourceConfig, gitBlobId, type LiveContext, LiveCredentialError, normalizeLiveText, parseWorkspaceConfig, sourceIdentity, sweepIdleLive } from '@mygitnotes/core';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveClock, memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';

/*
 * The idle check-in (docs/specs/2026-11-16-collab-first-self-host A5, slice S1): a link is due once nobody is active on
 * it and 5 minutes passed since its last edit, or since its checkout when nobody typed.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(edition);
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const person = (n: number): LiveContext => ({ person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` }, request: { headers: {} } });
const file = 'notes/life/a.md';
const A = '---\ntitle: A\n---\none\ntwo\n';
const MINUTE = 60_000;

let files: MemoryFiles, clock: MemoryLiveClock, liveNotes: MemoryLiveNotes;

const git = () => new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => parseWorkspaceConfig(manifest));
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const checkout = async () => {
  const snapshot = await git().getSnapshot(true);
  const { checkout: row } = await liveNotes.person(person(1)).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(A), 40), content: normalizeLiveText(A) } });
  return row.id;
};
const sweep = (backoff?: ReturnType<typeof createLiveIdleBackoff>) => sweepIdleLive(liveNotes, { now: clock.now, idleMs: 5 * MINUTE, timeZone: 'Asia/Taipei', sleep: async () => {}, ...(backoff ? { backoff } : {}) });
const gitCommit = async (path: string, content: string | null) => {
  const source = git();
  const snapshot = await source.getSnapshot(true);
  await source.commitChanges([content === null ? { path, sha: null } : { path, content }], snapshot.sha, 'write', 'notes', undefined, snapshot);
};

beforeEach(() => {
  files = new Map([['.mygitnotes.yaml', manifest], [file, A]]);
  clock = memoryLiveClock(Date.parse('2026-11-16T02:00:00.000Z'));
  liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }], clock, discard: true });
});
afterEach(() => vi.restoreAllMocks());

describe('the idle check-in', () => {
  it('checks in a link nobody is active on once 5 minutes passed since its last edit, and not a second before', async () => {
    const id = await checkout();
    clock.advance(MINUTE);
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    clock.advance(5 * MINUTE - 1000);
    expect(await sweep()).toEqual({ due: 0, results: [], failed: [] });
    expect(commits()).toEqual([]);
    clock.advance(1000);
    const report = await sweep();
    expect(report).toEqual({ due: 1, results: [{ id, path: file, committed: true, commit: expect.stringMatching(/^[0-9a-f]{40}$/), released: true }], failed: [] });
    expect(files.get(file)).toBe(`${A}three\n`);
    expect(commits().map(commit => commit.author)).toEqual([{ name: 'Person 1', email: 'p1@example.test' }]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
    // Nothing is left to check in: the next tick finds no link.
    expect(await sweep()).toEqual({ due: 0, results: [], failed: [] });
  });

  it('leaves a link someone is active on however long ago its last edit was, and takes it once they left', async () => {
    const id = await checkout();
    liveNotes.setActive(repository, id, 1);
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    clock.advance(30 * MINUTE);
    expect(await sweep()).toEqual({ due: 0, results: [], failed: [] });
    expect(commits()).toEqual([]);
    expect((await liveNotes.service.checkouts(repository)).map(row => row.id)).toEqual([id]);
    liveNotes.setActive(repository, id, 0);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, committed: true, released: true }] });
    expect(commits()).toHaveLength(1);
  });

  it('counts from the checkout for a note nobody typed in, and releases it without a commit', async () => {
    const id = await checkout();
    clock.advance(5 * MINUTE - 1000);
    expect(await sweep()).toMatchObject({ due: 0 });
    clock.advance(1000);
    expect(await sweep()).toEqual({ due: 1, results: [{ id, path: file, committed: false, released: true }], failed: [] });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('discards a pending note nobody typed in, and files one someone typed content in', async () => {
    const untyped = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '---\ntitle: Kept\n---\n\nA body the template gave it.\n' });
    const typed = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: 'inbox/{{title}}.md', content: '---\ntitle: Typed\n---\n' });
    liveNotes.type(repository, typed.id, '---\ntitle: Typed\n---\nWords.\n', person(2));
    clock.advance(5 * MINUTE);
    const report = await sweep();
    expect(report).toMatchObject({ due: 2, failed: [] });
    expect(report.results).toContainEqual({ id: untyped.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(report.results).toContainEqual(expect.objectContaining({ id: typed.id, path: 'notes/life/inbox/Typed.md', committed: true, released: true, filed: true }));
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/inbox/Typed.md']]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('leaves a note whose release is refused because someone came back, and takes it at a later tick', async () => {
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    clock.advance(5 * MINUTE);
    // Someone opens the note between the listing and the release.
    const release = liveNotes.service.release.bind(liveNotes.service);
    const refused = vi.spyOn(liveNotes.service, 'release').mockImplementationOnce(async (...args) => {
      liveNotes.setActive(repository, id, 1);
      return release(...args);
    });
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, committed: true, released: false, reason: 'active', activeEditors: 1 }], failed: [] });
    expect(refused).toHaveBeenCalledTimes(1);
    liveNotes.setActive(repository, id, 0);
    // This adapter has no `unlease`: the next tick finds the first check-in's lease, and one after it ran out takes the note.
    clock.advance(MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, committed: false, released: false, reason: 'leased' }] });
    clock.advance(5 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, committed: false, released: true }] });
    expect(commits()).toHaveLength(1);
  });

  it('waits longer each time before trying a link again that it could not check in, notifies once per text, and starts afresh once it is typed in (cf14-F002)', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: '{{kind}}/{{title}}.md', content: '# Untitled\n' });
    liveNotes.type(repository, pending.id, '# Untitled\nWords.\n', person(1));
    clock.advance(5 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id: pending.id, reason: 'unfiled' }] });
    expect(liveNotes.notices).toHaveLength(1);
    // Not tried again within a minute.
    clock.advance(30_000);
    expect(await sweep()).toMatchObject({ due: 0 });
    // Past its lease it is tried again, and no second notice goes out for the same text.
    clock.advance(6 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id: pending.id, reason: 'unfiled' }] });
    expect(liveNotes.notices).toHaveLength(1);
    // The wait doubled.
    clock.advance(MINUTE);
    expect(await sweep()).toMatchObject({ due: 0 });
    // Typed in: its next idle tick tries it, and tells again.
    liveNotes.type(repository, pending.id, '# Untitled\nMore words.\n', person(1));
    clock.advance(5 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id: pending.id, reason: 'unfiled' }] });
    expect(liveNotes.notices).toHaveLength(2);
  });

  it('sends the notice of a text whose earlier try failed without one (cf15-F002)', async () => {
    const pending = await liveNotes.person(person(1)).createPending(repository, { notebook: 'notes~life', pathRule: '{{kind}}/{{title}}.md', content: '# Untitled\n' });
    liveNotes.type(repository, pending.id, '# Untitled\nWords.\n', person(1));
    clock.advance(5 * MINUTE);
    vi.spyOn(liveNotes.service, 'detail').mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sweep()).toMatchObject({ due: 1, results: [], failed: [{ id: pending.id }] });
    expect(liveNotes.notices).toEqual([]);
    // Past its lease and the wait, the same text is tried again: nothing was told of it yet, so its notice goes out.
    clock.advance(6 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id: pending.id, reason: 'unfiled' }] });
    expect(liveNotes.notices).toEqual([expect.objectContaining({ kind: 'unfiled', id: pending.id })]);
  });

  it('holds back only a repeated uncommittable or unfiled notice: a deletion found at a later try of the same text is told (cf15-F002)', async () => {
    liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }], clock, discard: true, persons: true });
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    clock.advance(5 * MINUTE);
    const open = vi.spyOn(liveNotes.service, 'open').mockRejectedValue(new LiveCredentialError());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, reason: 'uncommittable' }] });
    expect(liveNotes.notices.map(notice => notice.kind)).toEqual(['uncommittable']);
    open.mockRestore();
    await gitCommit(file, null);
    clock.advance(6 * MINUTE);
    expect(await sweep()).toMatchObject({ due: 1, results: [{ id, committed: true, conflict: { kind: 'deleted' } }] });
    expect(liveNotes.notices.map(notice => notice.kind)).toEqual(['uncommittable', 'deleted']);
  });

  it('forgets a link it could not check in once the link is gone, whoever checked it in (cf15-F002)', async () => {
    const backoff = createLiveIdleBackoff();
    const id = await checkout();
    liveNotes.type(repository, id, `${A}three\n`, person(1));
    clock.advance(5 * MINUTE);
    vi.spyOn(liveNotes.service, 'detail').mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sweep(backoff)).toMatchObject({ failed: [{ id }] });
    expect([...backoff.links.keys()]).toEqual([id]);
    // Checked in by hand past its lease: the link is gone, and the next tick drops what it held of it.
    clock.advance(6 * MINUTE);
    expect(await checkInLink(liveNotes, repository, id, { mode: 'manual', now: clock.now, sleep: async () => {} })).toMatchObject({ committed: true, released: true });
    expect(await sweep(backoff)).toMatchObject({ due: 0 });
    expect(backoff.links.size).toBe(0);
  });
});
