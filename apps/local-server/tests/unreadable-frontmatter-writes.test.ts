import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { deriveAlias, type EditionSourceConfig, type LiveEditorInfo, notebookKey, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { shutdownFixtures } from '../src/live-builtin/test-fixture.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * A note whose frontmatter cannot be read keeps it as body. No write over HTTP puts a second block in front of it: a save
 * of its text, or a move without a title, keeps the text as it is; a save that sets metadata, or a rename that writes a
 * title, in Git or live, is refused as a conflict with the code the browser translates, and nothing is written or moved.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(notes);
const builtin: LiveEditorInfo = { kind: 'builtin' };
const broken = 'notes/life/broken.md';
const raw = '---\nnot: [yaml\n---\n# Old\n';
const refused = { status: 409, body: { code: 'frontmatter-invalid', error: 'The frontmatter cannot be read: fix it in the YAML view or the editor.' } };

const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes]);
    return { ...settings, members: [{ ...settings.members[1], default: true }] };
  },
};

let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, liveNotes: MemoryLiveNotes;
const start = async () => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files]]), mayWrite: () => true });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'x-person': 'p1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text && (response.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : null };
};
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const revision = async () => (await call('GET', '/api/files?notebookId=notes~life')).body.revision as string;
const save = async (content: string, metadata: Record<string, unknown>) => call('POST', '/api/notes', { notebookId: 'notes~life', path: broken, content, metadata, revision: await revision() });
const move = async (destination: string, title?: string) => call('POST', '/api/files', { command: { kind: 'move', notebookId: 'notes~life', path: broken, destination, ...(title ? { title } : {}) }, revision: await revision() });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-unreadable-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], [broken, raw]]);
  liveNotes = memoryLiveNotes({ editor: builtin, repositories: [{ source: notes, files }], clock: memoryLiveClock(), discard: true, retarget: true });
  server = undefined;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await shutdownFixtures();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a note whose frontmatter cannot be read', () => {
  it('refuses a save that sets metadata, and writes a save of its text as it is', async () => {
    await start();
    expect(await save(raw, { status: 'done' })).toMatchObject(refused);
    expect(files.get(broken)).toBe(raw);
    expect(commits()).toEqual([]);
    expect(await save(`${raw}More\n`, {})).toMatchObject({ status: 200, body: { note: { frontmatterInvalid: true } } });
    expect(files.get(broken)).toBe(`${raw}More\n`);
  });

  it('refuses a rename that writes a title, and moves the file as it is without one', async () => {
    await start();
    expect(await move('notes/life/new.md', 'New')).toMatchObject(refused);
    expect(files.get(broken)).toBe(raw);
    expect(files.has('notes/life/new.md')).toBe(false);
    expect(await move('notes/life/moved.md')).toMatchObject({ status: 200 });
    expect(files.get('notes/life/moved.md')).toBe(raw);
  });

  it('refuses a live rename that writes a title before anything moves', async () => {
    await start();
    const id = (await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: broken })).body.checkout.id as string;
    liveNotes.setActive(repository, id, 1);
    expect(await move('notes/life/new.md', 'New')).toMatchObject(refused);
    const [row] = await liveNotes.service.checkouts(repository);
    expect(row).toMatchObject({ id, path: broken });
    expect(row.target ?? null).toBeNull();
    expect((await call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(broken)}`)).body.note).toMatchObject({ path: broken, content: raw, frontmatterInvalid: true });
  });
});

describe('a note whose frontmatter cannot be read, on a local workspace', () => {
  let local: string, app: Server, url: string;
  beforeEach(async () => {
    local = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-unreadable-local-'));
    vi.stubEnv('MYGITNOTES_SOURCE', 'local');
    vi.stubEnv('MYGITNOTES_LOCAL_PATH', local);
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('APP_URL', '');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: local, stdio: 'pipe' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    fs.writeFileSync(path.join(local, '.mygitnotes.yaml'), 'schema_version: 4\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: docs\n');
    fs.mkdirSync(path.join(local, 'docs'));
    fs.writeFileSync(path.join(local, 'docs/broken.md'), raw);
    git('add', '.');
    git('commit', '-m', 'fixture');
    app = createServer(createApp(local));
    await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(app.address() as { port: number; }).port}`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => app.close(() => resolve()));
    fs.rmSync(local, { recursive: true, force: true });
  });

  it('refuses a save that sets metadata as a conflict, and writes a save of its text as it is', async () => {
    const post = async (body: unknown) => {
      const response = await fetch(`${url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const notebookId = notebookKey(deriveAlias(local, new Set()), 'a');
    expect(await post({ notebookId, path: 'docs/broken.md', content: raw, metadata: { status: 'done' }, noCommit: true })).toMatchObject(refused);
    expect(fs.readFileSync(path.join(local, 'docs/broken.md'), 'utf8')).toBe(raw);
    expect(await post({ notebookId, path: 'docs/broken.md', content: `${raw}More\n`, metadata: {}, noCommit: true })).toMatchObject({ status: 200 });
    expect(fs.readFileSync(path.join(local, 'docs/broken.md'), 'utf8')).toBe(`${raw}More\n`);
  });
});
