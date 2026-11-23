import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { type CommitRenames, type EditDateHistory, type LastCommit, RemoteEditDates } from '../src/remote-edit-dates.js';
import { MemoryRemoteCache } from '../src/remote-cache.js';
import { SourceError } from '../src/github-api.js';

/**
 * A history of three commits: `start` added a.md and old.md, `edit` changed a.md, `move` moved old.md to new.md
 * unchanged. Each call is recorded.
 */
function history(options: { slow?: Set<string>; fail?: Error; } = {}) {
  const asked: string[][] = [], renamesAsked: string[] = [], tries: string[][] = [];
  const last: Record<string, LastCommit> = { 'head:a.md': { sha: 'edit', date: '2026-03-01T08:00:00+08:00' }, 'head:new.md': { sha: 'move', date: '2026-04-01T00:00:00Z' }, 'start:old.md': { sha: 'start', date: '2026-01-01T00:00:00Z' }, 'head:edited-move.md': { sha: 'move', date: '2026-04-01T00:00:00Z' } };
  const renames: Record<string, CommitRenames> = { move: { parent: 'start', renames: new Map([['new.md', 'old.md']]) }, edit: { parent: 'start', renames: new Map() }, start: { parent: null, renames: new Map() } };
  const source: EditDateHistory = {
    async lastCommits(head, paths) {
      tries.push(paths);
      if (options.fail) throw options.fail;
      asked.push(paths.map(path => `${head}:${path}`));
      if (paths.some(path => options.slow?.has(path))) await new Promise(resolve => setTimeout(resolve, 200));
      return new Map(paths.map(path => [path, last[`${head}:${path}`] ?? null]));
    },
    async pureRenames(commit) {
      renamesAsked.push(commit);
      return renames[commit];
    },
  };
  return { source, asked, renamesAsked, tries };
}
const files = [{ path: 'a.md', blob: 'blob-a2' }, { path: 'new.md', blob: 'blob-old' }, { path: 'edited-move.md', blob: 'blob-x' }];
const signed = () => Object.assign(new MemoryRemoteCache(), { sign: (text: string) => createHmac('sha256', 'secret').update(text).digest('hex') });

it('dates each file by the last commit that changed its text, following a move that kept it, in one batch per step', async () => {
  const { source, asked, renamesAsked } = history();
  const dates = await new RemoteEditDates('repo', source, undefined, {}).dates('head', files);
  expect(Object.fromEntries(dates)).toEqual({ 'a.md': '2026-03-01T00:00:00.000Z', 'new.md': '2026-01-01T00:00:00.000Z', 'edited-move.md': '2026-04-01T00:00:00.000Z' });
  expect(asked).toEqual([['head:a.md', 'head:new.md', 'head:edited-move.md'], ['start:old.md']]);
  expect(renamesAsked.sort()).toEqual(['edit', 'move', 'start']);
});

it('remembers a date per path and text, in the process and sealed in the shared cache, and asks again only for new text', async () => {
  const { source, asked } = history();
  const owner = {}, cache = signed();
  await new RemoteEditDates('repo', source, cache, owner).dates('head', files);
  const before = asked.length;
  // Another reader of the same backend, at a later head where the files are unchanged, asks nothing.
  expect((await new RemoteEditDates('repo', source, cache, owner).dates('later', files)).get('new.md')).toBe('2026-01-01T00:00:00.000Z');
  expect(asked.length).toBe(before);
  // Another process reads the sealed facts from the shared cache.
  const other = history();
  expect((await new RemoteEditDates('repo', other.source, cache, {}).dates('head', files)).size).toBe(3);
  expect(other.asked).toEqual([]);
  // The same values under another secret's seal are not trusted.
  const keys = files.map(file => `mgn:edit-date:v1:${JSON.stringify(['repo', file.path, file.blob])}`);
  const values = await cache.get(keys);
  expect(values.every(value => value !== null)).toBe(true);
  const forged = Object.assign(new MemoryRemoteCache(), { sign: (text: string) => createHmac('sha256', 'other').update(text).digest('hex') });
  await forged.set(keys.map((key, index) => [key, values[index]!]), 60);
  const third = history();
  await new RemoteEditDates('repo', third.source, forged, {}).dates('head', files);
  expect(third.asked.length).toBeGreaterThan(0);
  // New text at a path is dated again.
  const fourth = history();
  await new RemoteEditDates('repo', fourth.source, cache, owner).dates('head', [{ path: 'a.md', blob: 'blob-a3' }]);
  expect(fourth.asked).toEqual([['head:a.md']]);
});

it('answers within its wait and leaves the rest to the background, where a later request finds them', async () => {
  const { source } = history({ slow: new Set(['new.md']) });
  const owner = {};
  const quick = await new RemoteEditDates('repo', source, undefined, owner, 50).dates('head', [{ path: 'new.md', blob: 'blob-old' }]);
  expect(quick.size).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 400));
  expect((await new RemoteEditDates('repo', source, undefined, owner, 50).dates('head', [{ path: 'new.md', blob: 'blob-old' }])).get('new.md')).toBe('2026-01-01T00:00:00.000Z');
});

it('waits for a dating another request started only as long as that request waits', async () => {
  const { source } = history({ slow: new Set(['new.md']) });
  const owner = {}, file = [{ path: 'new.md', blob: 'blob-old' }];
  const first = new RemoteEditDates('repo', source, undefined, owner, 100).dates('head', file);
  await new Promise(resolve => setTimeout(resolve, 120));
  expect((await first).size).toBe(0);
  // The dating is still running past the first request's wait: a request joining it answers at once.
  const start = Date.now();
  expect((await new RemoteEditDates('repo', source, undefined, owner, 100).dates('head', file)).size).toBe(0);
  expect(Date.now() - start).toBeLessThan(60);
});

it('leaves notes undated, without failing, when the provider refuses or has no history', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect((await new RemoteEditDates('repo', history({ fail: new SourceError('GitLab rate limit reached. Retry later.', 429) }).source, undefined, {}).dates('head', files)).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await new RemoteEditDates('repo', history({ fail: new SourceError('History is unavailable for this source.', 501) }).source, undefined, {}).dates('head', files)).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});

it('pauses dating after a failure for the time the provider asks, else a minute, and resumes after it', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const now = vi.spyOn(Date, 'now');
  try {
    let clock = Date.parse('2026-11-24T00:00:00Z');
    now.mockImplementation(() => clock);
    const limited = history({ fail: new SourceError('GitLab rate limit reached. Retry later.', 429, 120) }), owner = {};
    const dating = () => new RemoteEditDates('repo', limited.source, undefined, owner).dates('head', files);
    await dating();
    expect(limited.tries.length).toBe(1);
    clock += 119_000;
    await dating();
    expect(limited.tries.length).toBe(1);
    clock += 2_000;
    await dating();
    expect(limited.tries.length).toBe(2);
    // A failure that names no wait pauses for a minute.
    const down = history({ fail: new Error('GitLab GraphQL could not be reached.') }), other = {};
    const again = () => new RemoteEditDates('repo', down.source, undefined, other).dates('head', files);
    await again();
    clock += 59_000;
    await again();
    expect(down.tries.length).toBe(1);
    clock += 2_000;
    await again();
    expect(down.tries.length).toBe(2);
  } finally {
    now.mockRestore();
    warn.mockRestore();
  }
});

it('remembers that no commit holds a path and text, and does not ask again', async () => {
  const { source, tries } = history(), owner = {}, cache = signed();
  const file = [{ path: 'untracked.md', blob: 'blob-u' }];
  expect((await new RemoteEditDates('repo', source, cache, owner).dates('head', file)).size).toBe(0);
  expect(tries.length).toBe(1);
  expect((await new RemoteEditDates('repo', source, cache, owner).dates('head', file)).size).toBe(0);
  // Nor does another process sharing the cache.
  const other = history();
  expect((await new RemoteEditDates('repo', other.source, cache, {}).dates('head', file)).size).toBe(0);
  expect([tries.length, other.tries.length]).toEqual([1, 0]);
});
