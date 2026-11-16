import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, liveCheckoutOf, type LiveContext, liveEditorOf, liveSocketTicketOf, sourceIdentity, validateLiveEditorInfo, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { liveNotesContract } from '../src/live-notes-contract.js';
import { memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * The built-in live editor on the seam (docs/specs/2026-11-15-builtin-live-editor §1, slice N1). The golden tests pin
 * what a framed editor answers byte for byte, as 0.19 did; the rest covers the built-in kind.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const repository = sourceIdentity(notes);
const frame = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, otherFiles: MemoryFiles, liveNotes: MemoryLiveNotes;

const start = async (services: Record<string, unknown> = {}) => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', otherFiles]]), mayWrite: person => person.userId === 'p1' });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes, ...services }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, person: string | null = 'p1', headers: Record<string, string> = {}) => {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(person ? { 'x-person': person } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const json = (response.headers.get('content-type') ?? '').includes('application/json');
  return { status: response.status, body: json && text ? JSON.parse(text) : null, text };
};
const grant = async (write = true) => {
  const made = await call('POST', '/api/auth/agent-token', { name: 'client', write });
  if (made.status !== 200) throw new Error(`agent-token: ${made.status} ${JSON.stringify(made.body)}`);
  return made.body.token as string;
};
const tool = async (token: string, name: string, args: object) => {
  const answer = await (await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
  if (!answer.result || answer.result.isError) throw new Error(`MCP ${name}: ${JSON.stringify(answer)}`);
  return answer.result.structuredContent as Record<string, unknown>;
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-builtin-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\nGit body.\n']]);
  otherFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']]);
  liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], clock: memoryLiveClock() });
  server = undefined;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('golden: a framed editor answers as 0.19 did', () => {
  it("keeps the workspace's live field, the checkout view and the MCP read's live field byte-identical", async () => {
    await start();
    const workspace = await call('GET', '/api/workspace');
    expect(JSON.stringify(workspace.body.repositories.map((entry: { live: unknown; }) => entry.live))).toMatchInlineSnapshot(`"[{"origin":"https://live.example.test","messageType":"live-status","themeParam":"theme"},null]"`);
    const checkout = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(checkout.text).toMatchInlineSnapshot(`"{"checkout":{"id":"live-1","notebookId":"notes~life","path":"notes/life/a.md","pending":false,"editorUrl":"https://live.example.test/n/live-1","embedUrl":"https://live.example.test/n/live-1?embed=1","since":"2026-11-15T00:00:00.000Z","activeEditors":0,"conflict":null},"outcome":"created"}"`);
    const pending = await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' });
    expect(pending.text).toMatchInlineSnapshot(`"{"checkout":{"id":"live-2","notebookId":"notes~life","path":"notes/life/.live/live-2.md","pending":true,"editorUrl":"https://live.example.test/n/live-2","embedUrl":"https://live.example.test/n/live-2?embed=1","since":"2026-11-15T00:00:00.000Z","activeEditors":0,"conflict":null}}"`);
    const token = await grant();
    const read = await tool(token, 'read', { path: 'notes/life/a.md', notebookId: 'notes~life' });
    expect(JSON.stringify(read.live)).toMatchInlineSnapshot(`"{"since":"2026-11-15T00:00:00.000Z","activeEditors":0,"editorUrl":"https://live.example.test/n/live-1"}"`);
    const readNote = await tool(token, 'read_note', { path: 'notes/life/a.md', notebookId: 'notes~life' });
    expect(JSON.stringify(readNote.live)).toMatchInlineSnapshot(`undefined`);
  });

  it('keeps liveCheckoutOf byte-identical for a framed row, and still drops one without URLs', () => {
    const row = { id: 'live-1', notebook: 'notes~life', path: 'notes/life/a.md', since: '2026-11-15T00:00:00.000Z', editorUrl: 'https://live.example.test/n/live-1', embedUrl: 'https://live.example.test/n/live-1?embed=1', contentHash: 'a'.repeat(64), activeEditors: 1, lastEditAt: null, syncedAt: null, base: { commit: 'c'.repeat(40), blob: 'b'.repeat(40), contentHash: 'a'.repeat(64) }, conflict: null, extra: 'dropped' };
    const context = { editor: frame, notebook: (key: string) => key === 'notes~life' ? { id: 'life', title: 'Life', root: 'notes/life' } : undefined };
    expect(JSON.stringify(liveCheckoutOf(row, context))).toMatchInlineSnapshot(`"{"id":"live-1","notebook":"notes~life","path":"notes/life/a.md","since":"2026-11-15T00:00:00.000Z","editorUrl":"https://live.example.test/n/live-1","embedUrl":"https://live.example.test/n/live-1?embed=1","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","activeEditors":1,"lastEditAt":null,"syncedAt":null,"base":{"commit":"cccccccccccccccccccccccccccccccccccccccc","blob":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"conflict":null}"`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { editorUrl: _e, embedUrl: _u, ...bare } = row;
    expect(liveCheckoutOf(bare, context)).toBeNull();
    expect(liveCheckoutOf({ ...row, embedUrl: undefined }, context)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

const builtin = { kind: 'builtin' as const };
const builtinNotes = (clock = memoryLiveClock()) => memoryLiveNotes({ editor: builtin, repositories: [{ source: notes, files }], clock });

describe('the editor union', () => {
  it('accepts a builtin editor alone, refuses other kinds and extra keys, and round-trips a framed one as written', () => {
    expect(validateLiveEditorInfo({ kind: 'builtin' })).toEqual({ kind: 'builtin' });
    expect(Object.keys(validateLiveEditorInfo({ kind: 'builtin' }))).toEqual(['kind']);
    for (const value of [{ kind: 'builtin', origin: 'https://live.example.test' }, { kind: 'builtin', extra: 1 }, { kind: 'yjs' }, { kind: 'Builtin' }, { ...frame, kind: 'other' }, { ...frame, kind: null }]) expect(() => validateLiveEditorInfo(value), JSON.stringify(value)).toThrow(/Invalid live editor configuration/);
    expect(JSON.stringify(validateLiveEditorInfo(frame))).toBe(JSON.stringify(frame));
    expect(validateLiveEditorInfo({ kind: 'frame', ...frame })).toEqual({ kind: 'frame', ...frame });
  });

  it('matches a builtin answer to the declared builtin editor, beside framed ones', () => {
    const declared = { editors: [frame, builtin], editor: (repository: string) => repository === 'a' ? builtin : repository === 'b' ? frame : null };
    expect(liveEditorOf(declared, 'a')).toBe(declared.editors[1]);
    expect(liveEditorOf(declared, 'b')).toBe(declared.editors[0]);
    expect(liveEditorOf(declared, 'c')).toBeNull();
    expect(() => liveEditorOf({ editors: [frame], editor: () => builtin }, 'a')).toThrow(/not one the adapter declared/);
    expect(() => liveEditorOf({ editors: [builtin], editor: () => frame }, 'a')).toThrow(/not one the adapter declared/);
  });

  it('keeps a builtin row without URLs and drops any URL one carries', () => {
    const row = { id: 'live-1', notebook: 'notes~life', path: 'notes/life/a.md', since: '2026-11-15T00:00:00.000Z', contentHash: 'a'.repeat(64), activeEditors: 0, lastEditAt: null, syncedAt: null, base: null, conflict: null };
    const context = { editor: builtin, notebook: (key: string) => key === 'notes~life' ? { id: 'life', title: 'Life', root: 'notes/life' } : undefined };
    expect(liveCheckoutOf(row, context)).toEqual(row);
    expect(liveCheckoutOf({ ...row, editorUrl: 'https://evil.example/x', embedUrl: 'javascript:alert(1)' }, context)).toEqual(row);
  });

  it('checks a socket ticket for its shape', () => {
    expect(liveSocketTicketOf({ ticket: 'a'.repeat(32), document: 'live-1.1', extra: true })).toEqual({ ticket: 'a'.repeat(32), document: 'live-1.1' });
    for (const value of [null, { ticket: 'a'.repeat(31), document: 'live-1.1' }, { ticket: 'a'.repeat(129), document: 'live-1.1' }, { ticket: `${'a'.repeat(32)}=`, document: 'live-1.1' }, { ticket: 'a'.repeat(32), document: 'live-1.0' }, { ticket: 'a'.repeat(32), document: 'live-1' }, { ticket: 'a'.repeat(32), document: 'live/1.1' }, { ticket: 'a'.repeat(32), document: 'live-1.12345678901' }]) expect(liveSocketTicketOf(value), JSON.stringify(value)).toBeNull();
  });
});

describe('createApp with a built-in editor', () => {
  const make = (liveNotesValue: unknown) => () => createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, liveNotes: liveNotesValue as MemoryLiveNotes });

  it('starts on a long-running server with a bare APP_URL origin and socket tickets', () => {
    for (const appUrl of ['http://localhost', 'http://127.0.0.1:8080', 'https://notes.example.com']) {
      vi.stubEnv('APP_URL', appUrl);
      expect(make(builtinNotes()), appUrl).not.toThrow();
    }
  });

  it('refuses Vercel, a missing or unsafe APP_URL, and an adapter without socketTicket', () => {
    vi.stubEnv('VERCEL', '1');
    expect(make(builtinNotes())).toThrow(/Vercel cannot host it/);
    vi.stubEnv('VERCEL', '');
    for (const appUrl of ['', 'not a url', 'http://notes.example.com', 'https://notes.example.com/', 'https://notes.example.com/app', 'ftp://localhost']) {
      vi.stubEnv('APP_URL', appUrl);
      expect(make(builtinNotes()), appUrl).toThrow(/needs APP_URL/);
    }
    vi.stubEnv('APP_URL', 'https://notes.example.com');
    const { socketTicket: _ticket, ...without } = builtinNotes();
    expect(make(without)).toThrow(/has no socketTicket/);
    // A framed editor alone needs none of it, as in 0.19.
    vi.stubEnv('APP_URL', '');
    expect(make(liveNotes)).not.toThrow();
  });
});

describe('a built-in editor through the routes', () => {
  beforeEach(() => {
    liveNotes = builtinNotes();
  });

  it('says builtin in the workspace, and points editorUrl at the note page in the app', async () => {
    await start();
    expect((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([builtin, null]);
    const checkout = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(checkout.body).toEqual({ outcome: 'created', checkout: { id: 'live-1', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md', since: '2026-11-15T00:00:00.000Z', activeEditors: 0, conflict: null } });
    const pending = await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' });
    expect(pending.body.checkout).toMatchObject({ path: 'notes/life/.live/live-2.md', pending: true, editorUrl: 'http://localhost/notebooks/notes~life/notes/.live/live-2.md' });
    expect(pending.body.checkout).not.toHaveProperty('embedUrl');
    const token = await grant();
    expect((await tool(token, 'read', { path: 'notes/life/a.md', notebookId: 'notes~life' })).live).toEqual({ since: '2026-11-15T00:00:00.000Z', activeEditors: 0, editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md' });
    expect((await tool(token, 'read', { path: 'notes/life/.live/live-2.md', notebookId: 'notes~life' })).live).toEqual({ since: '2026-11-15T00:00:00.000Z', activeEditors: 0, pending: true, editorUrl: 'http://localhost/notebooks/notes~life/notes/.live/live-2.md' });
    const read = await call('GET', '/api/notes/read?notebookId=notes~life&path=notes/life/a.md');
    expect(read.body.note.live.editorUrl).toBe('http://localhost/notebooks/notes~life/notes/a.md');
  });

  it('gives a socket ticket only to a signed-in writer of a live note in a covered repository', async () => {
    await start();
    const note = { notebookId: 'notes~life', path: 'notes/life/a.md' };
    expect(await call('POST', '/api/live/socket-ticket', note)).toMatchObject({ status: 409, body: { code: 'not-live' } });
    await call('POST', '/api/live/checkout', note);
    expect((await call('POST', '/api/live/socket-ticket', note, null)).status).toBe(403);
    expect((await call('POST', '/api/live/socket-ticket', note, 'p2')).status).toBe(403);
    expect(await call('POST', '/api/live/socket-ticket', { notebookId: 'other~life', path: 'notes/life/z.md' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    const given = await call('POST', '/api/live/socket-ticket', note);
    expect(given).toMatchObject({ status: 200, body: { ticket: expect.stringMatching(/^[A-Za-z0-9_-]{32,128}$/), document: 'live-1.1' } });
    expect(Object.keys(given.body).sort()).toEqual(['document', 'ticket']);
    const redeemed = liveNotes.redeemTicket(given.body.ticket);
    expect(redeemed).toMatchObject({ repository, id: 'live-1', document: 'live-1.1', context: { person: { realm: 'edition', userId: 'p1' }, author: { email: 'pat@example.test' } } });
    expect(liveNotes.redeemTicket(given.body.ticket)).toBeNull();
    const pending = (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' })).body.checkout;
    expect(await call('POST', '/api/live/socket-ticket', { notebookId: 'notes~life', path: pending.path })).toMatchObject({ status: 200, body: { document: `${pending.id}.1` } });
  });

  it('refuses a socket ticket for a framed editor', async () => {
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] });
    await start();
    await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(await call('POST', '/api/live/socket-ticket', { notebookId: 'notes~life', path: 'notes/life/a.md' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
  });
});

describe('POST /api/live/sweep?mode=all', () => {
  it('checks in a link checked out after the last 03:00, which the plain sweep leaves', async () => {
    const secret = 'x'.repeat(40);
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] });
    await start();
    vi.stubEnv('MYGITNOTES_LIVE_SWEEP_SECRET', secret);
    vi.stubEnv('MYGITNOTES_LIVE_CHECKIN_AT', '03:00');
    vi.stubEnv('MYGITNOTES_TIMEZONE', 'UTC');
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    liveNotes.type(repository, body.checkout.id, '# Swept all\n', pat);
    const sweep = (query: string) => call('POST', `/api/live/sweep${query}`, undefined, null, { authorization: `Bearer ${secret}` });
    expect((await sweep('?wait=1')).body).toMatchObject({ due: 0 });
    expect((await sweep('?wait=1&mode=nightly')).status).toBe(400);
    expect(await sweep('?wait=1&mode=all')).toMatchObject({ status: 200, body: { due: 1, results: [{ committed: true, released: true }], failed: [] } });
    expect(files.get('notes/life/a.md')).toBe('# Swept all\n');
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });
});

liveNotesContract('memory (builtin)', () => {
  const clock = memoryLiveClock();
  const adapter = memoryLiveNotes({ editor: builtin, repositories: [{ source: notes, files: new Map([['.mygitnotes.yaml', manifest]]) }], clock });
  return { liveNotes: adapter, repository, notebook: 'notes~life', root: 'notes/life', person: n => ({ ...pat, person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` } }), type: (id, text, who) => adapter.type(repository, id, text, who), setActive: (id, n) => adapter.setActive(repository, id, n), advance: ms => clock.advance(ms) };
});
