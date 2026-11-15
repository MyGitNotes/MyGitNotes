import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, type LiveEditorInfo, LiveLeasedError, LiveNotLiveError, retargetLink, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { liveNotesContract } from '../src/live-notes-contract.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * Moving and renaming a pending live note (docs/specs/2026-11-15-builtin-live-editor §20.2, slice N1c): the seam's
 * optional `retarget`, which sets the path rule its check-in files it by, and `POST /api/live/retarget`. Nothing is
 * committed until the filing.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const repository = sourceIdentity(notes);
const frame = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const builtin = { kind: 'builtin' as const };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
const person = (n: number): LiveContext => ({ ...pat, person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` } });

for (const [name, editor] of [['frame', frame], ['builtin', builtin]] as [string, LiveEditorInfo][]) {
  liveNotesContract(`memory (${name}, retarget)`, () => {
    const clock = memoryLiveClock();
    const adapter = memoryLiveNotes({ editor, repositories: [{ source: notes, files: new Map([['.mygitnotes.yaml', manifest]]) }], clock, discard: true, retarget: true });
    return { liveNotes: adapter, repository, notebook: 'notes~life', root: 'notes/life', person, type: (id, text, who) => adapter.type(repository, id, text, who), setActive: (id, n) => adapter.setActive(repository, id, n), advance: ms => clock.advance(ms) };
  });
}

describe('the memory adapter with retarget', () => {
  it('implements retarget only when asked to, as a 0.19 adapter lacks it', () => {
    const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest]]);
    expect(typeof memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], retarget: true }).service.retarget).toBe('function');
    expect(memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] }).service.retarget).toBeUndefined();
  });
});

describe('retargetLink', () => {
  let files: MemoryFiles, liveNotes: MemoryLiveNotes;
  beforeEach(() => {
    files = new Map([['.mygitnotes.yaml', manifest]]);
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], retarget: true });
  });

  it('asks for the lease again while a check-in holds it, three times two seconds apart, then says it is leased', async () => {
    const pending = await liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '{{title}}.md', content: '# P\n' });
    await liveNotes.service.lease(repository, pending.id);
    const sleep = vi.fn(async (_ms: number) => {});
    const lease = vi.spyOn(liveNotes.service, 'lease');
    await expect(retargetLink(liveNotes, repository, pending.id, { pathRule: 'x/{{title}}.md', sleep })).rejects.toBeInstanceOf(LiveLeasedError);
    expect(lease).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[2000], [2000], [2000]]);
    expect((await liveNotes.service.checkouts(repository))[0]).toMatchObject({ pathRule: '{{title}}.md' });
  });

  it('retargets once the lease is free, and refuses a link that is no longer live', async () => {
    const pending = await liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '{{title}}.md', content: '# P\n' });
    const original = liveNotes.service.lease.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'lease').mockRejectedValueOnce(new LiveLeasedError()).mockImplementation(original);
    const sleep = vi.fn(async () => {});
    expect(await retargetLink(liveNotes, repository, pending.id, { pathRule: 'x/{{title}}.md', sleep })).toMatchObject({ id: pending.id, path: null, pathRule: 'x/{{title}}.md' });
    expect(sleep).toHaveBeenCalledTimes(1);
    await expect(retargetLink(liveNotes, repository, 'live-404', { pathRule: 'x/{{title}}.md', sleep })).rejects.toBeInstanceOf(LiveNotLiveError);
  });
});

/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

describe('POST /api/live/retarget', () => {
  let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, otherFiles: MemoryFiles, liveNotes: MemoryLiveNotes;
  const start = async () => {
    const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', otherFiles]]), mayWrite: who => who.userId === 'p1' });
    server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  };
  const restart = async (next: MemoryLiveNotes) => {
    await new Promise<void>(resolve => server!.close(() => resolve()));
    liveNotes = next;
    await start();
  };
  const call = async (method: string, url: string, body?: unknown, who: string | null = 'p1') => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text && (response.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : null };
  };
  const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
  const draft = async (body: Record<string, unknown> = {}) => (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Draft', ...body })).body.checkout as { id: string; path: string; };
  const retarget = (pendingPath: string, change: Record<string, unknown>, who: string | null = 'p1') => call('POST', '/api/live/retarget', { notebookId: 'notes~life', path: pendingPath, ...change }, who);
  const checkIn = (pendingPath: string) => call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: pendingPath });
  const make = (options: { discard?: boolean; retarget?: boolean; editor?: LiveEditorInfo; } = { retarget: true }) => memoryLiveNotes({ editor: options.editor ?? frame, repositories: [{ source: notes, files }], clock: memoryLiveClock(), ...(options.discard ? { discard: true } : {}), ...(options.retarget ? { retarget: true } : {}) });

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-retarget-')));
    for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
    store = createRecordStore(root);
    files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\nGit body.\n']]);
    otherFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']]);
    liveNotes = make();
    server = undefined;
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('says retarget in the workspace only for an adapter that has it, beside discard', async () => {
    const lives = async () => (await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live);
    await start();
    expect(await lives()).toEqual([{ ...frame, retarget: true }, null]);
    await restart(make({ discard: true, retarget: true }));
    expect(await lives()).toEqual([{ ...frame, discard: true, retarget: true }, null]);
    await restart(make({ editor: builtin, retarget: true }));
    expect(await lives()).toEqual([{ kind: 'builtin', retarget: true }, null]);
    await restart(make({}));
    expect(await lives()).toEqual([frame, null]);
  });

  it('moves a draft for a signed-in writer, answers its row and destination, commits nothing, and its check-in files it there', async () => {
    await start();
    const pending = await draft({ content: 'A thought.\n' });
    expect((await retarget(pending.path, { folder: 'projects' }, 'p2')).status).toBe(403);
    expect((await retarget(pending.path, { folder: 'projects' }, null)).status).toBe(403);
    const moved = await retarget(pending.path, { folder: 'projects/2026' });
    expect(moved).toMatchObject({ status: 200, body: { checkout: { id: pending.id, notebookId: 'notes~life', path: pending.path, pending: true, pathRule: 'projects/2026/{{title}}.md' }, destination: { folder: 'projects/2026', name: '{{title}}.md' } } });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toMatchObject([{ id: pending.id, path: null, pathRule: 'projects/2026/{{title}}.md' }]);
    expect(await checkIn(pending.path)).toMatchObject({ status: 200, body: { path: 'notes/life/projects/2026/Draft.md', committed: true, filed: true } });
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/projects/2026/Draft.md']]);
  });

  it("keeps a template's name pattern on a move, and a move to the root drops the folder", async () => {
    await start();
    const pending = await liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '會議/其他/{{date}} {{title}}.md', content: '---\ntitle: 週會\ndate: 2026-11-15\n---\n# 週會\n\n議程\n' });
    const virtual = `notes/life/.live/${pending.id}.md`;
    expect(await retarget(virtual, { folder: 'archive' })).toMatchObject({ status: 200, body: { checkout: { pathRule: 'archive/{{date}} {{title}}.md' }, destination: { folder: 'archive', name: '{{date}} {{title}}.md' } } });
    expect(await retarget(virtual, { folder: '' })).toMatchObject({ status: 200, body: { checkout: { pathRule: '{{date}} {{title}}.md' }, destination: { folder: '', name: '{{date}} {{title}}.md' } } });
    expect(await checkIn(virtual)).toMatchObject({ status: 200, body: { path: 'notes/life/2026-11-15 週會.md', filed: true } });
  });

  it('fixes the file name on a rename, leaves the title, and files a name that is taken with -2', async () => {
    await start();
    const pending = await draft({ content: 'Body.\n' });
    expect(await retarget(pending.path, { name: 'a' })).toMatchObject({ status: 200, body: { checkout: { pathRule: 'a.md' }, destination: { folder: '', name: 'a.md' } } });
    expect(await retarget(pending.path, { folder: '' })).toMatchObject({ status: 200, body: { checkout: { pathRule: 'a.md' } } });
    expect(await checkIn(pending.path)).toMatchObject({ status: 200, body: { path: 'notes/life/a-2.md', committed: true, filed: true } });
    expect(files.get('notes/life/a-2.md')).toContain('title: Draft');
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\nGit body.\n');
  });

  it('tells the web where a draft files, in its live field, only where the adapter can retarget', async () => {
    await start();
    const pending = await draft({ content: 'A thought.\n' });
    await retarget(pending.path, { folder: 'projects' });
    const live = async (file: string) => (await call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(file)}`)).body.note.live;
    expect(await live(pending.path)).toMatchObject({ pending: true, pathRule: 'projects/{{title}}.md' });
    await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(Object.keys(await live('notes/life/a.md'))).not.toContain('pathRule');
    // An adapter without retarget answers as 0.19 did.
    await restart(make({}));
    const plain = await draft();
    expect(Object.keys(await live(plain.path)).sort()).toEqual(['activeEditors', 'editorUrl', 'pending', 'since']);
  });

  it('retargets a draft someone has open in the editor', async () => {
    await start();
    const pending = await draft();
    liveNotes.setActive(repository, pending.id, 2);
    expect(await retarget(pending.path, { folder: 'open' })).toMatchObject({ status: 200, body: { checkout: { pathRule: 'open/{{title}}.md', activeEditors: 2 } } });
  });

  it('refuses a bad folder or name, and a request naming neither, with 400 and the rule as it was', async () => {
    await start();
    const pending = await draft();
    for (const change of [{ folder: '../x' }, { folder: '.hidden' }, { folder: 'a/' }, { folder: 3 }, { name: '...' }, { name: '{{title}}' }, { name: ['x'] }, {}, { folder: null }]) {
      expect(await retarget(pending.path, change)).toMatchObject({ status: 400 });
    }
    expect((await liveNotes.service.checkouts(repository))[0]).toMatchObject({ pathRule: '{{title}}.md' });
  });

  it('refuses a filed note, another repository and an adapter without retarget as not-live, and an unknown draft with 404', async () => {
    await start();
    await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(await retarget('notes/life/a.md', { folder: 'x' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect((await retarget('notes/life/.live/unknown.md', { folder: 'x' })).status).toBe(404);
    expect(await call('POST', '/api/live/retarget', { notebookId: 'other~life', path: 'notes/life/.live/unknown.md', folder: 'x' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    await restart(make({ discard: true }));
    const pending = await draft();
    expect(await retarget(pending.path, { folder: 'x' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect((await liveNotes.service.checkouts(repository)).find(row => row.id === pending.id)).toMatchObject({ pathRule: '{{title}}.md' });
  });

  it('answers 409 leased while a check-in keeps the lease past the retries', async () => {
    await start();
    const pending = await draft();
    await liveNotes.service.lease(repository, pending.id);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let done = false;
    const answer = retarget(pending.path, { folder: 'x' }).finally(() => (done = true));
    // The request crosses a real socket: move the clock on until the retries are spent and it is answered.
    while (!done) {
      await vi.advanceTimersByTimeAsync(2000);
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(await answer).toMatchObject({ status: 409, body: { code: 'leased' } });
    expect((await liveNotes.service.checkouts(repository))[0]).toMatchObject({ pathRule: '{{title}}.md' });
  });
});
