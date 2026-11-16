import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { type BuiltinFixture, builtinFixture, edition, manifest, person, repository, shutdownFixtures } from '../src/live-builtin/test-fixture.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * The app over the built-in adapter itself (docs/specs/2026-11-15-builtin-live-editor, slice N3): what the seam tests
 * check against the memory adapter's built-in mode, through the real routes and MCP tools, down to the live store.
 */

const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const gitA = '---\ntitle: A\n---\nGit body.\n';
const note = { notebookId: 'notes~life', path: 'notes/life/a.md' };
/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, edition, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

let root: string, server: Server | undefined, base: string, records: RecordStore, files: MemoryFiles, live: BuiltinFixture;

const start = async () => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']])]]), mayWrite: who => who.userId === 'p1' });
  server = createServer(createApp(root, { configSource, recordStore: records, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes: live.liveNotes }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, who: string | null = 'p1') => {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: (response.headers.get('content-type') ?? '').includes('application/json') && text ? JSON.parse(text) : null };
};
const grant = async () => {
  const made = await call('POST', '/api/auth/agent-token', { name: 'client', write: true });
  if (made.status !== 200) throw new Error(`agent-token: ${made.status} ${JSON.stringify(made.body)}`);
  return made.body.token as string;
};
const tool = async (token: string, name: string, args: object) => {
  const answer = await (await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  if (!answer.result || answer.result.isError) throw new Error(`MCP ${name}: ${JSON.stringify(answer)}`);
  return answer.result.structuredContent as Record<string, unknown>;
};
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const readNote = (file: string, who: string | null = 'p1') => call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(file)}`, undefined, who);
const ticketHash = (ticket: string) => createHash('sha256').update(ticket, 'utf8').digest('hex');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-builtin-adapter-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  records = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', gitA]]);
  live = builtinFixture({ files });
  server = undefined;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await shutdownFixtures();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the edition surface', () => {
  it('exports the factory and both stores from the package, and the store kit and the test hooks from its testing entries', async () => {
    const surface: Record<string, unknown> = await import('../src/edition.js');
    expect(['builtinLiveNotes', 'memoryLiveStore', 'redisLiveStore'].map(name => typeof surface[name])).toEqual(['function', 'function', 'function']);
    const { exports: entries } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { exports: Record<string, string>; };
    expect(entries['./testing/live-store-contract']).toBe('./src/live-builtin/store-contract.ts');
    expect(entries['./testing/builtin-live-notes']).toBe('./src/live-builtin/testing.ts');
    for (const [entry, target] of Object.entries(entries)) expect(fs.existsSync(new URL(`../${target}`, import.meta.url)), entry).toBe(true);
    const kit: Record<string, unknown> = await import('../src/live-builtin/store-contract.js'), hooks: Record<string, unknown> = await import('../src/live-builtin/testing.js');
    expect([typeof kit.liveStoreContract, typeof hooks.builtinLiveNotesWithHooks]).toEqual(['function', 'function']);
  });
});

describe('the app over the built-in live adapter', () => {
  it('says builtin with discard and retarget, and creates, reads and tickets a pending note by its virtual path', async () => {
    await start();
    expect((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([{ kind: 'builtin', discard: true, retarget: true }, null]);
    const made = await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' });
    const pending = made.body.checkout;
    expect(made).toEqual({ status: 200, body: { checkout: { id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), notebookId: 'notes~life', path: `notes/life/.live/${pending.id}.md`, pending: true, editorUrl: `http://localhost/notebooks/notes~life/notes/.live/${pending.id}.md`, since: '2026-11-15T00:00:00.000Z', activeEditors: 0, conflict: null } } });
    expect((await readNote(pending.path)).body.note).toMatchObject({ title: 'Idea', live: { pending: true, editorUrl: pending.editorUrl } });
    // The socket ticket takes the virtual path, and is the signed-in writer's alone.
    const asked = { notebookId: 'notes~life', path: pending.path };
    expect((await call('POST', '/api/live/socket-ticket', asked, null)).status).toBe(403);
    expect((await call('POST', '/api/live/socket-ticket', asked, 'p2')).status).toBe(403);
    const given = await call('POST', '/api/live/socket-ticket', asked);
    expect(given).toEqual({ status: 200, body: { ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), document: `${pending.id}.1` } });
    expect(await live.store.takeTicket(ticketHash(given.body.ticket), live.time.now())).toEqual({ repository, id: pending.id, epoch: 1, document: `${pending.id}.1`, editor: { key: 'person:pat@example.test', name: 'Pat', email: 'pat@example.test', agent: false, person: { realm: 'edition', userId: 'p1' } }, display: 'Pat' });
    // Nobody typed in it yet: nothing was committed, and nothing names an editor.
    expect(commits()).toEqual([]);
    expect(await live.store.link(pending.id)).toMatchObject({ path: null, pathRule: '{{title}}.md', lastEditAt: null, seq: 0 });
  });

  it("lands an agent's write in the live document over the typing since, keeps Git as it was, and checks it in by the typist", async () => {
    await start();
    expect(await call('POST', '/api/live/socket-ticket', note)).toMatchObject({ status: 409, body: { code: 'not-live' } });
    const opened = await call('POST', '/api/live/checkout', note);
    const { id } = opened.body.checkout;
    expect(opened.body).toEqual({ outcome: 'created', checkout: { id, notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md', since: '2026-11-15T00:00:00.000Z', activeEditors: 0, conflict: null } });
    expect((await call('POST', '/api/live/socket-ticket', note)).body.document).toBe(`${id}.1`);
    const token = await grant();
    const read = await tool(token, 'read', note);
    expect(read).toMatchObject({ content: gitA, live: { since: '2026-11-15T00:00:00.000Z', activeEditors: 0, editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md' } });
    // Someone types after the agent read.
    await live.liveNotes.type(repository, id, `${gitA}typed\n`, person(2));
    const written = await tool(token, 'write', { ...note, content: gitA.replace('Git body.', 'Agent body.'), revision: read.revision });
    expect(written).toMatchObject({ committed: false, live: true, changedPaths: ['notes/life/a.md'] });
    const text = '---\ntitle: A\n---\nAgent body.\ntyped\n';
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(text);
    expect((await readNote('notes/life/a.md')).body.note).toMatchObject({ content: 'Agent body.\ntyped\n', live: { editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md' } });
    expect((await tool(token, 'read', note)).content).toBe(text);
    // A person who may only read sees the live text too, through the read overlay, and gets no ticket to type in it.
    expect((await readNote('notes/life/a.md', 'p2')).body.note.content).toBe('Agent body.\ntyped\n');
    expect((await call('POST', '/api/live/socket-ticket', note, 'p2')).status).toBe(403);
    expect(files.get('notes/life/a.md')).toBe(gitA);
    expect(commits()).toEqual([]);
    const done = await call('POST', '/api/live/checkin', note);
    expect(done).toMatchObject({ status: 200, body: { id, path: 'notes/life/a.md', committed: true, released: true } });
    expect(files.get('notes/life/a.md')).toBe(text);
    expect(commits()).toHaveLength(1);
    expect(commits()[0].author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
    expect(commits()[0].message).toContain(`Live-Link: ${id}`);
    expect(commits()[0].message).toMatch(/\nAgent-Edit: \d{4}-\d{2}-\d{2}/);
    // Checked in, it is no longer live: no ticket, and the next checkout reopens it as the next epoch.
    expect(await call('POST', '/api/live/socket-ticket', note)).toMatchObject({ status: 409, body: { code: 'not-live' } });
    expect((await call('POST', '/api/live/checkout', note)).body).toMatchObject({ outcome: 'reopened', checkout: { id } });
    expect((await call('POST', '/api/live/socket-ticket', note)).body.document).toBe(`${id}.2`);
  });

  it('moves a pending note to where its check-in then files it, and discards an untouched new note', async () => {
    await start();
    const pending = (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' })).body.checkout;
    const moved = await call('POST', '/api/live/retarget', { notebookId: 'notes~life', path: pending.path, folder: 'archive/2026' });
    expect(moved).toMatchObject({ status: 200, body: { checkout: { id: pending.id, path: pending.path, pending: true, pathRule: 'archive/2026/{{title}}.md' }, destination: { folder: 'archive/2026', name: '{{title}}.md' } } });
    expect(commits()).toEqual([]);
    const draft = (await live.liveNotes.person(person(1)).read(repository, pending.id)).content;
    await live.liveNotes.type(repository, pending.id, `${draft}More.\n`, person(2));
    // The move ended its lease: the check-in takes the note at once.
    expect(await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: pending.path })).toMatchObject({ status: 200, body: { path: 'notes/life/archive/2026/Idea.md', committed: true, released: true, filed: true } });
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/archive/2026/Idea.md']]);
    expect(files.get('notes/life/archive/2026/Idea.md')).toBe(`${draft}More.\n`);
    expect(await readNote(pending.path)).toMatchObject({ status: 404, body: { movedTo: 'notes/life/archive/2026/Idea.md' } });
    const empty = (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: '未命名', content: '# 未命名\n\n在這裡寫下筆記。\n' })).body.checkout;
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: empty.path })).toEqual({ status: 200, body: { discarded: true } });
    expect(await live.store.link(empty.id)).toBeNull();
    expect(await readNote(empty.path)).toMatchObject({ status: 404, body: { movedTo: null } });
    expect(commits()).toHaveLength(1);
    expect(await live.liveNotes.service.checkouts(repository)).toEqual([]);
  });
});
