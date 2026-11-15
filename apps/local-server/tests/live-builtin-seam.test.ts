import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, liveCheckoutOf, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
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
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
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
