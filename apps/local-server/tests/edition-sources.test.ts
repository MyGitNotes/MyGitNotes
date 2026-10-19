import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import type { EditionSourceConfig, SourceConfig, WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'My notes' };
const github: SourceConfig = { type: 'github', repository: 'owner/repo', branch: 'main' };

let root: string, server: Server, base: string, store: RecordStore, files: MemoryFiles, providerRequests: string[];
const identity: IdentityService = { router: Router(), signedIn: async req => req.headers['x-person'] ? { person: { realm: 'edition', userId: 'p1' }, login: 'pat', owner: 'edition:p1' } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'Link a GitHub account to open this repository.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => ({ ...workspaceSettings([github, edition]) }) };

const start = async (services: Record<string, unknown>) => {
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, ...services }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, person = true) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(person ? { 'x-person': 'p1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return {
    status: response.status,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    })(),
  };
};
const tool = async (token: string, name: string, args: object) => {
  const response = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-edition-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
  providerRequests = [];
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('https://api.github.com/')) {
      providerRequests.push(String(url));
      return new Response('{}', { status: 500 });
    }
    return nativeFetch(url, init);
  });
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('edition sources', () => {
  it('opens an edition member without a provider token and leaves a GitHub member no-credential, with no provider request', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }) });
    const workspace = await call('GET', '/api/workspace');
    expect(workspace.body).toMatchObject({});
    expect(workspace.status, JSON.stringify(workspace.body)).toBe(200);
    const [provider, hosted] = workspace.body.repositories;
    expect(hosted).toMatchObject({ id: 'edition:hosted:p1/notes@main', write: true, defaultNotebook: expect.stringContaining('life') });
    expect(hosted.unavailable).toBeUndefined();
    expect(provider).toMatchObject({ unavailable: { reason: 'no-credential', message: 'Link a GitHub account to open this repository.' } });
    expect(providerRequests).toEqual([]);
  });

  it('names an edition member by its label in the members list', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }) });
    const { body } = await call('GET', '/api/workspace/members');
    expect(body.members[1]).toMatchObject({ type: 'edition', repository: 'p1/notes', label: 'My notes' });
  });

  it('writes to the edition member for a signed-in person without a token, and refuses a person the edition refuses', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]), mayWrite: () => false }) });
    const workspace = await call('GET', '/api/workspace');
    expect(workspace.body.repositories[1].write).toBe(false);
    const saved = await call('POST', '/api/notes/commit', { repository: 'edition:hosted:p1/notes@main', revision: workspace.body.repositories[1].revision, message: 'docs: update', notes: [{ path: 'notes/life/a.md', content: '# Changed\n', metadata: {} }] });
    expect(saved.status).toBe(403);
    expect(files.get('notes/life/a.md')).toBe('# A\n');
  });

  it('commits through the edition member', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }) });
    const workspace = await call('GET', '/api/workspace');
    const saved = await call('POST', '/api/notes/commit', { repository: 'edition:hosted:p1/notes@main', revision: workspace.body.repositories[1].revision, message: 'docs: update', notes: [{ path: 'notes/life/a.md', content: '# Changed\n', metadata: {} }] });
    expect(saved.status).toBe(200);
    expect(files.get('notes/life/a.md')).toContain('# Changed');
    expect(providerRequests).toEqual([]);
  });

  it('marks the edition member unavailable when the edition refuses the person, and unsupported without editionSources', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]), mayRead: () => false }) });
    const w = await call('GET', '/api/workspace');
    expect(w.body.repositories[1]).toMatchObject({ unavailable: { reason: 'no-access' } });
    await new Promise<void>(resolve => server.close(() => resolve()));
    await start({});
    const w2 = await call('GET', '/api/workspace');
    console.log(JSON.stringify(w2).slice(0, 600));
    expect(w2.body.repositories[1]).toMatchObject({ unavailable: { reason: 'unsupported-platform' } });
  });

  it('lists and edits the edition member over /mcp for a grant without a credential', async () => {
    await start({ editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }) });
    const made = await call('POST', '/api/auth/agent-token', { name: 'client', write: true });
    expect(made.status).toBe(200);
    expect(await store.get(made.body.token)).not.toHaveProperty('credential');
    const listed = await tool(made.body.token, 'list_notebooks', {});
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body.result.structuredContent)).toContain('life');
    const read = await tool(made.body.token, 'read', { path: 'notes/life/a.md' });
    expect(read.body.result.isError).not.toBe(true);
    const written = await tool(made.body.token, 'write', { path: 'notes/life/b.md', content: '# B\n', revision: read.body.result.structuredContent?.revision });
    expect(written.body.result.isError).not.toBe(true);
    expect(files.get('notes/life/b.md')).toContain('# B');
    expect(providerRequests).toEqual([]);
  });

  it('still refuses a grant without a credential when no edition source is supplied', async () => {
    await start({});
    const made = await call('POST', '/api/auth/agent-token', { name: 'client' });
    const response = await fetch(`${base}/mcp/${made.body.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Link a GitHub account to open this repository.' });
  });
});
