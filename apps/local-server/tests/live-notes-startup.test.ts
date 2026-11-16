import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type EditionSourceConfig, gitBlobId, parseWorkspaceConfig, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource } from '../src/memory-edition-source.js';
import { memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' };
const remote: WorkspaceConfigSource = { mode: 'remote', settings: async () => workspaceSettings([edition]) };
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const liveNotes = (info: Record<string, unknown> = editor) => ({ ...memoryLiveNotes({ editor, repositories: [{ source: edition, files: new Map() }] }), editors: [info as typeof editor] });

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-start-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const start = (overrides: Record<string, unknown>) => () => createApp(root, { configSource: remote, recordStore: createRecordStore(root), remoteCache: undefined, workspaceChoices: null, ...overrides });

describe('starting with live notes', () => {
  it('starts a remote deployment with a valid editor, and one without live notes as before', () => {
    expect(start({ liveNotes: liveNotes() })).not.toThrow();
    expect(start({})).not.toThrow();
  });

  it('refuses live notes for a local workspace', () => {
    const local: WorkspaceConfigSource = { mode: 'local', settings: async () => workspaceSettings([{ type: 'local', path: root }]) };
    expect(start({ configSource: local, liveNotes: liveNotes() })).toThrow(/local workspace/i);
  });

  it('refuses an editor origin it could not frame safely, and an adapter that declares no editor', () => {
    for (const origin of ['http://live.example.test', 'https://live.example.test/path', 'https://user:pw@live.example.test', 'not a url']) {
      expect(start({ liveNotes: liveNotes({ ...editor, origin }) }), origin).toThrow(/live editor/i);
    }
    expect(start({ liveNotes: liveNotes({ ...editor, messageType: 'a:b' }) })).toThrow(/live editor/i);
    expect(start({ liveNotes: { ...liveNotes(), editors: [] } })).toThrow(/live editor/i);
  });

  it('refuses an idle check-in setting that is no number of minutes, and only where live notes are attached', () => {
    vi.stubEnv('MYGITNOTES_LIVE_IDLE_CHECKIN', '2h');
    expect(start({ liveNotes: liveNotes() })).toThrow(/MYGITNOTES_LIVE_IDLE_CHECKIN/);
    expect(start({})).not.toThrow();
    for (const value of ['off', '1m', '60m', '']) {
      vi.stubEnv('MYGITNOTES_LIVE_IDLE_CHECKIN', value);
      expect(start({ liveNotes: liveNotes() }), value).not.toThrow();
    }
  });

  it.each([['', 5], ['1m', 1]])("checks a live note in by itself from the running app's own tick ('%s': %i minutes after everyone left it)", async (setting, minutes) => {
    vi.stubEnv('MYGITNOTES_LIVE_IDLE_CHECKIN', setting);
    vi.stubEnv('MYGITNOTES_LIVE_CHECKIN_AT', 'off');
    vi.useFakeTimers({ now: new Date('2026-11-16T02:00:00.000Z') });
    try {
      const manifest = 'schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
      const files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
      const repository = 'edition:hosted:p1/notes@main';
      // The memory adapter reads the same clock the app's tick does.
      const live = memoryLiveNotes({ editor, repositories: [{ source: edition, files }] });
      start({ liveNotes: live })();
      const context = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'P', email: 'p@example.test' }, request: { headers: {} } };
      const head = (await new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => parseWorkspaceConfig(manifest)).getSnapshot()).sha;
      const { checkout } = await live.person(context).checkout(repository, { notebook: 'notes~life', path: 'notes/life/a.md', base: { commit: head, blob: gitBlobId(Buffer.from('# A\n'), 40), content: '# A\n' } });
      live.type(repository, checkout.id, '# A\ntyped\n', context);
      const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
      await vi.advanceTimersByTimeAsync(minutes * 60_000 - 15_000);
      expect(commits()).toEqual([]);
      // A tick falls 50 to 70 s after the last one: within two of them the note is checked in.
      await vi.advanceTimersByTimeAsync(155_000);
      expect(commits().map(commit => commit.paths)).toEqual([['notes/life/a.md']]);
      expect(files.get('notes/life/a.md')).toBe('# A\ntyped\n');
      expect(await live.service.checkouts(repository)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs no idle check-in where it is off, or on Vercel', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T02:00:00.000Z') });
    try {
      for (const variables of [{ MYGITNOTES_LIVE_IDLE_CHECKIN: 'off' }, { VERCEL: '1', UPSTASH_REDIS_REST_URL: 'https://cache.example.test', UPSTASH_REDIS_REST_TOKEN: 'token' }]) {
        for (const [key, value] of Object.entries(variables)) vi.stubEnv(key, value);
        vi.stubEnv('MYGITNOTES_LIVE_CHECKIN_AT', 'off');
        const live = memoryLiveNotes({ editor, repositories: [{ source: edition, files: new Map() }] });
        const asked = vi.spyOn(live.service, 'repositories');
        start({ liveNotes: live })();
        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(asked, JSON.stringify(variables)).not.toHaveBeenCalled();
        for (const key of Object.keys(variables)) vi.stubEnv(key, '');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
