import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, repositoryRef, type WorkspaceConfigSource, type WorkspaceSettings } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import type { EditionSources } from '../src/edition-sources.js';
import { type IdentityService } from '../src/identity.js';
import { MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Demo\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const edition: EditionSourceConfig = { type: 'edition', platform: 'demo', repository: 'scenarios', branch: 'main', label: 'Demo' };
const REPOSITORY = 'edition:demo:scenarios@main';

let root: string, server: Server, base: string, store: RecordStore, files: MemoryFiles, providerRequests: string[];
const identity: IdentityService = { router: Router(), signedIn: async () => null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'Sign in.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const settings = (demo: boolean): WorkspaceSettings => ({ site: { type: 'github' }, members: [{ ref: repositoryRef(edition), alias: 'demo', default: true, hidden: false, editable: 'none', ...(demo ? { demo: true as const } : {}) }], manifest: (_member, inRepository) => inRepository() });
const configSource = (demo: boolean): WorkspaceConfigSource => ({ mode: 'remote', ...(demo ? { demo: true } : {}), settings: async () => settings(demo) });
/** A repository that opens for a signed-out request; `writable` is what the source itself would allow. */
const editionSources = (writable: boolean): EditionSources => ({ open: (source, _context, cache, scope) => new MemoryEditionSource(source, files, writable, { count: 0 }, cache, scope) });

const start = async (demo: boolean, writable: boolean) => {
  server = createServer(createApp(root, { configSource: configSource(demo), recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources: editionSources(writable) }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown) => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
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

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-demo-')));
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

describe('a demo member', () => {
  it('reports itself to the browser, read-only, to a signed-out request', async () => {
    await start(true, false);
    const { status, body } = await call('GET', '/api/workspace');
    expect(status).toBe(200);
    expect(body.repositories).toHaveLength(1);
    expect(body.repositories[0]).toMatchObject({ id: REPOSITORY, demo: true, write: false, defaultNotebook: expect.stringContaining('life') });
    expect(providerRequests).toEqual([]);
  });

  it('serves its notes to a signed-out request', async () => {
    await start(true, false);
    const workspace = await call('GET', '/api/workspace');
    const notebookId = workspace.body.repositories[0].notebooks[0];
    const notes = await call('GET', `/api/notes?notebookId=${encodeURIComponent(notebookId)}`);
    expect(notes.status).toBe(200);
    expect(JSON.stringify(notes.body)).toContain('notes/life/a.md');
  });

  it('refuses every write of a signed-out request, even when the repository itself would take it, and changes nothing', async () => {
    await start(true, true);
    const workspace = await call('GET', '/api/workspace');
    const { revision, notebooks } = workspace.body.repositories[0];
    const before = JSON.stringify([...files]);
    const attempts = [call('POST', '/api/notes/commit', { repository: REPOSITORY, revision, message: 'edit', notes: [{ path: 'notes/life/a.md', content: '# Changed\n', metadata: {} }] }), call('POST', '/api/notes', { notebookId: notebooks[0], title: 'New', content: 'x' }), call('POST', '/api/tags/apply', { notebookId: notebooks[0], operation: { kind: 'rename', from: 'a', to: 'b' } }), call('PUT', '/api/workspace/config', { repository: REPOSITORY, configYaml: manifest, configRevision: '' }), call('PUT', '/api/focus-page', { repository: REPOSITORY, page: { version: 2, focuses: [] }, revision }), call('POST', '/api/agent-resources/save', { repository: REPOSITORY, path: 'x', content: 'x' })];
    const results = await Promise.all(attempts);
    expect(results.map(result => result.status), JSON.stringify(results.map(result => result.body))).toEqual(results.map(() => expect.toSatisfy((status: number) => [401, 403].includes(status))));
    expect(JSON.stringify([...files])).toBe(before);
    expect(providerRequests).toEqual([]);
  });

  it('refuses file moves and version records because the demo repository allows no write', async () => {
    await start(true, false);
    const workspace = await call('GET', '/api/workspace');
    const { revision, notebooks } = workspace.body.repositories[0];
    const before = JSON.stringify([...files]);
    const moved = await call('POST', '/api/files', { revision, command: { kind: 'move', notebookId: notebooks[0], path: 'notes/life/a.md', destination: 'notes/life/b.md' } });
    const version = await call('POST', '/api/versions', { notebookId: notebooks[0], path: 'notes/life/a.md', action: 'create', commit: revision, name: 'v1' });
    expect(moved.status).toBe(403);
    expect(version.status).toBe(403);
    expect(JSON.stringify([...files])).toBe(before);
  });

  it('offers a demo in the session probe only when the configuration source does', async () => {
    await start(true, false);
    expect((await call('GET', '/api/auth/session')).body).toMatchObject({ authenticated: false, demo: true });
    await new Promise<void>(resolve => server.close(() => resolve()));
    await start(false, false);
    expect((await call('GET', '/api/auth/session')).body).not.toHaveProperty('demo');
  });

  it('leaves a member without the demo flag unmarked', async () => {
    await start(false, false);
    const { body } = await call('GET', '/api/workspace');
    expect(body.repositories[0]).not.toHaveProperty('demo');
  });
});
