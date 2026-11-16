import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EditionSourceConfig, WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
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
});
