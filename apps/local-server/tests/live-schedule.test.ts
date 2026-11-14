import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditionSourceConfig, gitBlobId, parseWorkspaceConfig, sourceIdentity, sweepLive } from '@mygitnotes/core';
import { liveDueInstant, liveScheduleSetting, startLiveSchedule } from '../src/live-schedule.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource } from '../src/memory-edition-source.js';
import { memoryLiveClock, memoryLiveNotes } from '../src/memory-live-notes.js';

const taipei = liveScheduleSetting({ MYGITNOTES_LIVE_CHECKIN_AT: '03:00', MYGITNOTES_TIMEZONE: 'Asia/Taipei' })!;
const iso = (value: Date) => value.toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe('the check-in setting', () => {
  it('defaults to 03:00 UTC, is off with off, and refuses a time that is not one', () => {
    expect(liveScheduleSetting({})).toEqual({ at: '03:00', timeZone: 'UTC' });
    expect(liveScheduleSetting({ MYGITNOTES_LIVE_CHECKIN_AT: 'off' })).toBeNull();
    expect(liveScheduleSetting({ MYGITNOTES_LIVE_CHECKIN_AT: ' OFF ' })).toBeNull();
    for (const value of ['25:00', '3', '03:60', 'noon']) expect(() => liveScheduleSetting({ MYGITNOTES_LIVE_CHECKIN_AT: value }), value).toThrow(/MYGITNOTES_LIVE_CHECKIN_AT/);
  });
});

describe('the due instant', () => {
  it('is the latest check-in time at or before now in the time zone, across the day boundary', () => {
    // 02:59:59 on the 16th in Taipei: the last 03:00 was the 15th's.
    expect(iso(liveDueInstant(new Date('2026-11-15T18:59:59.000Z'), taipei))).toBe('2026-11-14T19:00:00.000Z');
    expect(iso(liveDueInstant(new Date('2026-11-15T19:00:00.000Z'), taipei))).toBe('2026-11-15T19:00:00.000Z');
    // 23:00 on the 14th in Los Angeles, before its 23:30: the 13th's.
    const angeles = liveScheduleSetting({ MYGITNOTES_LIVE_CHECKIN_AT: '23:30', MYGITNOTES_TIMEZONE: 'America/Los_Angeles' })!;
    expect(iso(liveDueInstant(new Date('2026-11-15T07:00:00.000Z'), angeles))).toBe('2026-11-14T07:30:00.000Z');
    expect(iso(liveDueInstant(new Date('2026-11-15T08:00:00.000Z'), angeles))).toBe('2026-11-15T07:30:00.000Z');
  });

  it('makes a sweep take only links checked out before it', async () => {
    const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
    const repository = sourceIdentity(edition);
    const manifest = 'schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
    const files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/before.md', '# Before\n'], ['notes/life/after.md', '# After\n']]);
    const clock = memoryLiveClock(Date.parse('2026-11-15T18:59:00.000Z'));
    const liveNotes = memoryLiveNotes({ editor: { origin: 'https://live.example.test', messageType: 'live-status' }, repositories: [{ source: edition, files }], clock });
    const head = (await new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => parseWorkspaceConfig(manifest)).getSnapshot()).sha;
    const context = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'P', email: 'p@example.test' }, request: { headers: {} } };
    for (const file of ['notes/life/before.md', 'notes/life/after.md']) {
      const content = files.get(file)!;
      const { checkout } = await liveNotes.person(context).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: head, blob: gitBlobId(Buffer.from(content), 40), content } });
      liveNotes.type(repository, checkout.id, `${content}typed\n`, context);
      // The second is checked out exactly at the instant, which is not before it.
      clock.advance(60_000);
    }
    const report = await sweepLive(liveNotes, { instant: liveDueInstant(new Date(clock.now()), taipei), now: clock.now });
    expect(report.due).toBe(1);
    expect(memoryCommits(files).filter(commit => commit.message !== 'Memory state').map(commit => commit.paths)).toEqual([['notes/life/before.md']]);
  });
});

describe('the in-process schedule', () => {
  it('catches up once 60 to 120 s after start, then sweeps at the instant and 10, 20 and 30 minutes after it', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T18:00:00.000Z') });
    const sweeps: { at: string; instant: string; }[] = [];
    const schedule = startLiveSchedule({ setting: taipei, random: () => 0.5, sweep: async instant => void sweeps.push({ at: new Date().toISOString(), instant: iso(instant) }) });
    await vi.advanceTimersByTimeAsync(89_000);
    expect(sweeps).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sweeps).toEqual([{ at: '2026-11-15T18:01:30.000Z', instant: '2026-11-14T19:00:00.000Z' }]);
    await vi.advanceTimersByTimeAsync(24 * 3600_000);
    expect(sweeps.slice(1)).toEqual(['19:00:30', '19:10:30', '19:20:30', '19:30:30'].map(time => ({ at: `2026-11-15T${time}.000Z`, instant: '2026-11-15T19:00:00.000Z' })));
    schedule.stop();
    await vi.advanceTimersByTimeAsync(48 * 3600_000);
    expect(sweeps).toHaveLength(5);
  });

  it('skips a tick while the previous sweep still runs', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T18:58:00.000Z') });
    let running = 0;
    const started: string[] = [];
    const schedule = startLiveSchedule({
      setting: taipei,
      random: () => 0,
      sweep: async () => {
        started.push(new Date().toISOString());
        running++;
        // The catch-up sweep runs for 15 minutes, past the 19:00 and 19:10 ticks.
        await new Promise(resolve => setTimeout(resolve, started.length === 1 ? 15 * 60_000 : 1));
        running--;
      },
    });
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(started).toEqual(['2026-11-15T18:59:00.000Z', '2026-11-15T19:20:00.000Z', '2026-11-15T19:30:00.000Z']);
    expect(running).toBe(0);
    schedule.stop();
  });
});
