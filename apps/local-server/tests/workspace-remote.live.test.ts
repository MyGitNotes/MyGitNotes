import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, gitBlobId, type LiveContext, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { decodeWorkspaceRevision, encodeWorkspaceRevision, type LiveRevisionEntry } from '@mygitnotes/mcp-server';
import { createApp } from '../src/app.js';
import type { EditionSources } from '../src/edition-sources.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(edition);
const editor = { origin: 'https://live.example.test', messageType: 'live-status' };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, request: { headers: {} } };
const gitA = '---\ntitle: Git title\n---\nGit body.\n';
const identity: IdentityService = { router: Router(), signedIn: async req => req.headers['x-person'] ? { person: { realm: 'edition', userId: 'p1' }, login: 'pat', owner: 'edition:p1' } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
/** The edition repository alone, on a GitHub site: an edition source has no site of its own. */
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, edition]);
    return { ...settings, members: [{ ...settings.members[1], default: true }] };
  },
};

let root: string, server: Server, base: string, store: RecordStore, files: MemoryFiles, liveNotes: MemoryLiveNotes;

const start = async (services: Record<string, unknown>) => {
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }), ...services }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, person = true) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(person ? { 'x-person': 'p1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const grant = async (write = true) => {
  const made = await call('POST', '/api/auth/agent-token', { name: 'client', write });
  if (made.status !== 200) throw new Error(`agent-token: ${made.status} ${JSON.stringify(made.body)}`);
  return made.body.token as string;
};
/** One MCP tool call: its structured result, or its error object when the call failed. */
const tool = async (token: string, name: string, args: object) => {
  const response = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const answer = await response.json();
  if (!answer.result) throw new Error(`MCP call ${name} failed: ${response.status} ${JSON.stringify(answer)}`);
  const { result } = answer;
  return result.isError ? { error: JSON.parse(result.content[0].text) as { error: string; code?: string; paths?: string[]; } } : { result: result.structuredContent as Record<string, unknown> };
};
const checkout = async (file: string) => {
  const content = files.get(file)!;
  const { checkout: row } = await liveNotes.person(pat).checkout(repository, { notebook: 'notes~life', path: file, base: { commit: 'a'.repeat(40), blob: gitBlobId(Buffer.from(content), 40), content } });
  return row.id;
};
const liveText = async (id: string) => (await liveNotes.person(pat).read(repository, id)).content;
const head = () =>
  new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => {
    throw new Error('unused');
  }).getSnapshot().then(snapshot => snapshot.sha);
const decode = (token: string) => JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-mcp-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', gitA], ['notes/life/b.md', '# B\n'], ['notes/life/c.md', '# C\n']]);
  liveNotes = memoryLiveNotes({ editor, repositories: [{ source: edition, files }] });
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('hosted tools on a checked-out note', () => {
  it('reads it with a v2 token, and writes with that token land live', async () => {
    await start({ liveNotes });
    const token = await grant();
    const id = await checkout('notes/life/a.md');
    const read = await tool(token, 'read', { path: 'notes/life/a.md' });
    expect(read.result?.content).toBe(gitA);
    const revision = read.result!.revision as string;
    expect(revision.startsWith('v2.')).toBe(true);
    const payload = decode(revision);
    expect(payload.r).toEqual({ [repository]: await head() });
    expect(payload.l).toEqual([[repository, 'notes/life/a.md', id, expect.any(String), expect.stringMatching(/^[0-9a-f]{64}$/)]]);
    const written = await tool(token, 'write', { path: 'notes/life/a.md', content: '---\ntitle: Agent\n---\nAgent body.\n', revision });
    expect(written.result).toMatchObject({ committed: false, pushed: false, live: true, liveRevision: expect.any(String), changedPaths: ['notes/life/a.md'], path: 'notes/life/a.md' });
    expect(await liveText(id)).toBe('---\ntitle: Agent\n---\nAgent body.\n');
    expect(files.get('notes/life/a.md')).toBe(gitA);
    // The note read again, save_note with its token lands live as well.
    const note = await tool(token, 'read_note', { path: 'notes/life/a.md' });
    expect(note.result?.note).toMatchObject({ title: 'Agent', live: expect.objectContaining({ since: expect.any(String) }) });
    const saved = await tool(token, 'save_note', { path: 'notes/life/a.md', content: 'Saved body.\n', revision: note.result!.revision as string });
    expect(saved.result).toMatchObject({ committed: false, live: true });
    expect(await liveText(id)).toContain('Saved body.');
    expect(await liveText(id)).toContain('title: Agent');
    expect(memoryCommits(files).length).toBe(0);
  });

  it('refuses a Git-only token, refuses an edit after someone typed, and always lands an append', async () => {
    await start({ liveNotes });
    const token = await grant();
    const gitOnly = (await tool(token, 'glob', { pattern: 'notes/**/*.md' })).result!.revision as string;
    expect(gitOnly.startsWith('v1.')).toBe(true);
    const id = await checkout('notes/life/a.md');
    const refused = await tool(token, 'write', { path: 'notes/life/a.md', content: 'x\n', revision: gitOnly });
    expect(refused.error).toMatchObject({ code: 'checked-out', paths: ['notes/life/a.md'] });
    const read = await tool(token, 'read', { path: 'notes/life/a.md' });
    liveNotes.type(repository, id, `${gitA}typed\n`, pat);
    const stale = await tool(token, 'edit', { path: 'notes/life/a.md', startLine: 4, endLine: 4, content: 'Edited.', revision: read.result!.revision as string });
    expect(stale.error?.error).toMatch(/changed in the live editor/i);
    expect(await liveText(id)).toBe(`${gitA}typed\n`);
    const appended = await tool(token, 'append', { path: 'notes/life/a.md', content: 'appended\n', revision: gitOnly });
    expect(appended.result).toMatchObject({ committed: false, live: true });
    expect(await liveText(id)).toBe(`${gitA}typed\nappended\n`);
    // An edit on the current text keeps its line numbers right and lands.
    const fresh = await tool(token, 'read', { path: 'notes/life/a.md' });
    const edited = await tool(token, 'edit', { path: 'notes/life/a.md', startLine: 4, endLine: 4, content: 'Edited.', revision: fresh.result!.revision as string });
    expect(edited.result).toMatchObject({ live: true });
    expect(await liveText(id)).toBe('---\ntitle: Git title\n---\nEdited.\ntyped\nappended\n');
  });

  it('refuses file operations that touch it', async () => {
    await start({ liveNotes });
    const token = await grant();
    await checkout('notes/life/a.md');
    const revision = (await tool(token, 'glob', { pattern: 'notes/**/*.md' })).result!.revision as string;
    const attempts = [['mv', { source: 'notes/life/a.md', destination: 'notes/life/moved.md', revision }], ['cp', { source: 'notes/life/a.md', destination: 'notes/life/copy.md', revision }], ['cp', { source: 'notes/life/b.md', destination: 'notes/life/a.md', revision, overwrite: true }], ['rm', { paths: ['notes/life/a.md'], revision }], ['delete_note', { path: 'notes/life/a.md' }], ['replace_notes', { search: 'body', replace: 'text', notebookId: 'notes~life' }]] as const;
    for (const [name, args] of attempts) {
      const answer = await tool(token, name, args);
      expect(answer.error, name).toMatchObject({ code: 'checked-out', paths: ['notes/life/a.md'] });
    }
    expect(memoryCommits(files).length).toBe(0);
    expect([...files.keys()].sort()).toEqual(['.mygitnotes.yaml', 'notes/life/a.md', 'notes/life/b.md', 'notes/life/c.md']);
  });

  it('gives a read-only grant the live text and no write', async () => {
    await start({ liveNotes });
    const token = await grant(false);
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '# Live\n', pat);
    const read = await tool(token, 'read', { path: 'notes/life/a.md' });
    expect(read.result?.content).toBe('# Live\n');
    for (const name of ['write', 'append', 'save_note'] as const) {
      const answer = await tool(token, name, { path: 'notes/life/a.md', content: 'x\n', revision: read.result!.revision as string });
      expect(answer.error?.error, name).toMatch(/read-only/);
    }
    expect(await liveText(id)).toBe('# Live\n');
  });

  it('keeps v1 tokens byte for byte without live notes, and for notes that are not checked out', async () => {
    const expected = encodeWorkspaceRevision({ [repository]: await head() });
    await start({});
    let token = await grant();
    expect((await tool(token, 'read', { path: 'notes/life/a.md' })).result?.revision).toBe(expected);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await start({ liveNotes });
    token = await grant();
    await checkout('notes/life/a.md');
    expect((await tool(token, 'read', { path: 'notes/life/b.md' })).result?.revision).toBe(expected);
    const written = await tool(token, 'write', { path: 'notes/life/b.md', content: '# B2\n', revision: expected });
    expect(written.result).toMatchObject({ committed: true, pushed: true });
    expect((written.result!.revision as string).startsWith('v1.')).toBe(true);
  });
});

describe('the web routes on a checked-out note', () => {
  it('reads and queries the live text, and refuses a browser commit with code and paths', async () => {
    await start({ liveNotes });
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: Live title\n---\nzebra\n', pat);
    const read = await call('GET', '/api/notes/read?path=notes/life/a.md');
    expect(read.body.note).toMatchObject({ title: 'Live title', content: 'zebra\n', live: expect.objectContaining({ since: expect.any(String) }) });
    const query = await call('GET', '/api/notes/query?notebookId=notes~life&q=zebra');
    expect(query.body.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/life/a.md']);
    expect(query.body.notes[0]).toMatchObject({ title: 'Live title', live: expect.any(Object) });
    const workspace = await call('GET', '/api/workspace');
    const saved = await call('POST', '/api/notes/commit', { repository, revision: workspace.body.repositories[0].revision, message: 'docs: update', notes: [{ path: 'notes/life/a.md', content: 'x\n', metadata: {} }] });
    expect(saved.status).toBe(409);
    expect(saved.body).toMatchObject({ code: 'checked-out', paths: ['notes/life/a.md'] });
    const single = await call('POST', '/api/notes', { path: 'notes/life/a.md', content: 'x\n', metadata: {}, revision: workspace.body.repositories[0].revision });
    expect(single.status).toBe(409);
    expect(single.body).toMatchObject({ code: 'checked-out', paths: ['notes/life/a.md'], error: expect.stringMatching(/edited live/) });
    expect(memoryCommits(files).length).toBe(0);
  });

  it('gives a signed-out reader Git text and makes no adapter call', async () => {
    // An edition that lets anyone read, so a signed-out request reaches the repository.
    const open: EditionSources = { open: (source, { person }, cache, scope) => new MemoryEditionSource(source, files, Boolean(person), memoryCommitCounter(files), cache, scope) };
    const spy = vi.spyOn(liveNotes, 'person');
    await start({ liveNotes, editionSources: open });
    const id = await checkout('notes/life/a.md');
    liveNotes.type(repository, id, '---\ntitle: Live title\n---\nzebra\n', pat);
    spy.mockClear();
    const read = await call('GET', '/api/notes/read?path=notes/life/a.md', undefined, false);
    expect(read.status).toBe(200);
    expect(read.body.note.title).toBe('Git title');
    expect(read.body.note.live).toBeUndefined();
    const query = await call('GET', '/api/notes/query?notebookId=notes~life', undefined, false);
    expect(query.body.notes.find((note: { path: string; }) => note.path === 'notes/life/a.md').title).toBe('Git title');
    expect(spy).not.toHaveBeenCalled();
    // Signed in, the same note reads live.
    expect((await call('GET', '/api/notes/read?path=notes/life/a.md')).body.note.title).toBe('Live title');
    expect(spy).toHaveBeenCalled();
  });
});

describe('the hosted revision token', () => {
  const sha = 'b'.repeat(40);
  const entry = (n: number): LiveRevisionEntry => [repository, `notes/life/n${n}.md`, `live-${n}`, `e1:${n}`, 'c'.repeat(64)];
  const v2 = (payload: unknown) => `v2.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

  it('round-trips v2, keeps the newest 32 live entries and stays within 8192 characters', () => {
    const token = encodeWorkspaceRevision({ [repository]: sha }, [entry(1)]);
    expect(token.startsWith('v2.')).toBe(true);
    expect(decodeWorkspaceRevision(token, repository, 1)).toBe(sha);
    const many = decode(encodeWorkspaceRevision({ [repository]: sha }, Array.from({ length: 40 }, (_, n) => entry(n))));
    expect(many.l.length).toBe(32);
    expect(many.l[0][2]).toBe('live-8');
    const long = (n: number): LiveRevisionEntry => [repository, `notes/life/${'x'.repeat(900)}${n}.md`, `live-${n}`, `e1:${n}`, 'c'.repeat(64)];
    const capped = encodeWorkspaceRevision({ [repository]: sha }, Array.from({ length: 20 }, (_, n) => long(n)));
    expect(capped.length).toBeLessThanOrEqual(8192);
    expect(decode(capped).l.at(-1)[2]).toBe('live-19');
  });

  it('refuses a v2 token with an invalid field, an unknown key or a noncanonical encoding', () => {
    const bad = [v2({ r: { [repository]: sha }, l: [[repository, 'notes/life/a.md', 'bad id', 'e1:1', 'c'.repeat(64)]] }), v2({ r: { [repository]: sha }, l: [[repository, '../a.md', 'live-1', 'e1:1', 'c'.repeat(64)]] }), v2({ r: { [repository]: sha }, l: [[repository, 'notes/life/a.md', 'live-1', 'é', 'c'.repeat(64)]] }), v2({ r: { [repository]: sha }, l: [[repository, 'notes/life/a.md', 'live-1', 'e1:1', 'C'.repeat(64)]] }), v2({ r: { [repository]: sha }, l: Array.from({ length: 33 }, (_, n) => entry(n)) }), v2({ r: { [repository]: sha }, l: [], x: 1 }), v2({ r: { [repository]: 'nope' }, l: [] }), `${v2({ r: { [repository]: sha }, l: [] })}A`];
    for (const token of bad) expect(() => decodeWorkspaceRevision(token, repository, 1), token).toThrow(/Invalid workspace revision token/);
  });
});
