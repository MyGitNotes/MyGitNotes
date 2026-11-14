import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { type Request, Router } from 'express';
import type { EditionSourceConfig, SourceConfig, WorkspaceConfigSource, WorkspaceRequest } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import type { IdentityService } from '../src/identity.js';
import { dropHeaders } from '../src/request-headers.js';
import { memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { createRecordStore, type RecordStore, type StoredRecord } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = (id: string) => `schema_version: 4\nworkspace:\n  title: ${id}\n  default_notebook: ${id}\nnotebooks:\n  - id: ${id}\n    title: ${id}\n    root: notes/${id}\n`;
const github: SourceConfig = { type: 'github', repository: 'owner/repo', branch: 'main' };
const hosted: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main' };
const githubFiles: Record<string, string> = { '.mygitnotes.yaml': manifest('ex'), 'notes/ex/a.md': '# A\n' };

/** Outside bearers, as an OIDC access token looks: three dotted parts, never the 43 characters of a stored grant. */
const patToken = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJwMSJ9.c2lnbmF0dXJlLW9mLXBhdA';
const samToken = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJwMiJ9.c2lnbmF0dXJlLW9mLXNhbQ';
const unknownToken = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJub2JvZHkifQ.bm9ib2R5';
const pat = { realm: 'edition', userId: 'p1' }, sam = { realm: 'edition', userId: 'p2' };

type Resolved = Awaited<ReturnType<NonNullable<IdentityService['bearerGrant']>>>;
let root: string, server: Server, base: string, store: RecordStore, files: MemoryFiles;
/** What the identity answers for each outside bearer; a function throws or answers as a test needs. */
let answers: Map<string, Resolved | (() => Resolved)>;
let bearersAsked: string[], grantTokens: { grant: StoredRecord; person: unknown; }[], providerAuthorizations: string[], seen: WorkspaceRequest[];
let output: ReturnType<typeof vi.spyOn>[];

const identity = (): IdentityService => ({
  router: Router(),
  signedIn: async () => null,
  token: async () => undefined,
  grantCredential: async () => undefined,
  // The server's own credential, whoever the grant is for.
  grantToken: async (grant, person) => {
    grantTokens.push({ grant, person });
    return 'server-credential';
  },
  noCredentialMessage: () => 'No credential.',
  signInOptions: async () => [],
  configured: async () => true,
  signOut: async () => {},
  bearerGrant: async (_req, bearer) => {
    bearersAsked.push(bearer);
    const answer = answers.get(bearer) ?? null;
    return typeof answer === 'function' ? answer() : answer;
  },
});
/** Pat has the GitHub repository and their hosted one; Sam has the GitHub repository only. */
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  async settings(request) {
    seen.push(request);
    return request.person?.userId === 'p2' ? workspaceSettings([github]) : workspaceSettings([github, hosted]);
  },
};

const start = async (services: IdentityService) => {
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity: services, editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }) }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
};
const post = (url: string, headers: Record<string, string>, body: unknown) => fetch(base + url, { method: 'POST', headers: { Connection: 'close', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });
const rpc = async (bearer: string, method: string, params?: unknown, headers: Record<string, string> = {}) => {
  const response = await post('/mcp', { Authorization: `Bearer ${bearer}`, ...headers }, { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
};
const tool = (bearer: string, name: string, args: object = {}) => rpc(bearer, 'tools/call', { name, arguments: args });
/** Everything the server printed, as one string. */
const printed = () => output.flatMap(spy => spy.mock.calls).flat().map(String).join('\n');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mcp-bearer-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest('life')], ['notes/life/a.md', '# Life\n']]);
  answers = new Map<string, Resolved | (() => Resolved)>([[patToken, { person: pat, owner: 'edition:p1', author: { name: 'Pat', email: 'pat@example.test' }, write: false, site: 'github' }], [samToken, { person: sam, owner: 'edition:p2', write: true, site: 'github' }]]);
  bearersAsked = [];
  grantTokens = [];
  providerAuthorizations = [];
  seen = [];
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const match = /^https:\/\/api\.github\.com\/repos\/owner\/repo(.*)$/.exec(String(url));
    if (!match) return nativeFetch(url, init);
    const [, endpoint] = match;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    const authorization = new Headers(init?.headers).get('authorization');
    if (!authorization) return json({ message: 'Not Found' }, 404);
    providerAuthorizations.push(authorization);
    if (endpoint === '') return json({ private: true, default_branch: 'main', permissions: { push: true } });
    if (endpoint.startsWith('/commits/')) return json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'tree' } } });
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(githubFiles).map(file => ({ path: file, sha: `blob:${file}`, type: 'blob', mode: '100644', size: 10 })) });
    if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(githubFiles[decodeURIComponent(endpoint.slice('/git/blobs/'.length)).slice('blob:'.length)] ?? '').toString('base64') });
    return json({});
  });
  output = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a bearer that is not a stored grant', () => {
  it('is refused as before by an identity that resolves none', async () => {
    const { bearerGrant: _none, ...plain } = identity();
    await start(plain);
    const refused = await rpc(patToken, 'tools/list');
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: 'Create a MyGitNotes agent token after signing in.' });
    expect(refused.headers.get('www-authenticate')).toBe('Bearer realm="MyGitNotes MCP"');
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: no-token');
    expect(bearersAsked).toEqual([]);
    expect(grantTokens).toEqual([]);
  });

  it('acts as the person the identity resolves it to, with the server credential and never the bearer', async () => {
    await start(identity());
    const listed = await rpc(patToken, 'tools/list', undefined, { Cookie: 'gh_notes_session=' + 'o'.repeat(43) });
    expect(listed.status).toBe(200);
    const names = (listed.body.result.tools as { name: string; }[]).map(entry => entry.name);
    expect(names).toContain('read');
    const notebooks = await tool(patToken, 'list_notebooks');
    expect(notebooks.body.result.isError).toBeUndefined();
    expect((notebooks.body.result.structuredContent.notebooks as { key: string; }[]).map(notebook => notebook.key).sort()).toEqual(['notes~life', 'repo~ex']);
    const read = await tool(patToken, 'read', { path: 'notes/ex/a.md' });
    expect(read.body.result.isError).toBeUndefined();
    expect(JSON.stringify(read.body.result.structuredContent)).toContain('# A');
    // The workspace is the resolved person's, found without the bearer or a browser cookie.
    expect(bearersAsked).toEqual([patToken, patToken, patToken]);
    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.person).toEqual(pat);
      expect(request.headers).not.toHaveProperty('cookie');
      expect(request.headers).not.toHaveProperty('authorization');
    }
    // The provider is called with what the identity gives the grant, and the grant carries the person's author.
    expect(grantTokens.at(-1)).toEqual({ grant: { kind: 'agent', ownerId: 'edition:p1', person: pat, site: 'github', write: false, author: { name: 'Pat', email: 'pat@example.test' } }, person: pat });
    expect(providerAuthorizations.length).toBeGreaterThan(0);
    expect(new Set(providerAuthorizations).size).toBe(1);
    expect(providerAuthorizations[0]).toContain('server-credential');
    expect(providerAuthorizations.join('\n')).not.toContain(patToken);
    // Another person's bearer reaches that person's workspace.
    const others = await tool(samToken, 'list_notebooks');
    expect((others.body.result.structuredContent.notebooks as { key: string; }[]).map(notebook => notebook.key)).toEqual(['repo~ex']);
    expect(grantTokens.at(-1)!.grant).toEqual({ kind: 'agent', ownerId: 'edition:p2', person: sam, site: 'github', write: true });
    expect(printed()).not.toContain(patToken);
    expect(printed()).not.toContain(samToken);
  });

  it('refuses every write tool when the resolved grant does not write, and writes when it does', async () => {
    await start(identity());
    const names = async () => ((await rpc(patToken, 'tools/list')).body.result.tools as { name: string; }[]).map(entry => entry.name);
    expect(await names()).not.toContain('write');
    const revision = (await tool(patToken, 'read', { path: 'notes/life/a.md' })).body.result.structuredContent.revision as string;
    expect(revision).toEqual(expect.any(String));
    const refused = await tool(patToken, 'write', { path: 'notes/life/b.md', content: '# B\n', revision });
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toContain('This agent grant is read-only.');
    expect(files.has('notes/life/b.md')).toBe(false);
    answers.set(patToken, { ...answers.get(patToken) as NonNullable<Resolved>, write: true });
    expect(await names()).toContain('write');
    const written = await tool(patToken, 'write', { path: 'notes/life/b.md', content: '# B\n', revision });
    expect(written.body.result.isError, JSON.stringify(written.body.result)).toBeUndefined();
    expect(files.get('notes/life/b.md')).toContain('# B');
  });

  it.each([['a truthy write that is not true', { person: pat, owner: 'edition:p1', write: 'yes', site: 'github' }], ['no person', { owner: 'edition:p1', write: true, site: 'github' }], ['a person without a realm', { person: { userId: 'p1' }, owner: 'edition:p1', write: true, site: 'github' }], ['no owner', { person: pat, write: true, site: 'github' }], ['no site', { person: pat, owner: 'edition:p1', write: true }], ['an author without an email', { person: pat, owner: 'edition:p1', author: { name: 'Pat' }, write: true, site: 'github' }]])('refuses an answer with %s', async (_what, answer) => {
    await start(identity());
    answers.set(patToken, answer as unknown as Resolved);
    const refused = await tool(patToken, 'write', { path: 'notes/life/b.md', content: '# B\n' });
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: 'Create a MyGitNotes agent token after signing in.' });
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: bearer-invalid');
    expect(files.has('notes/life/b.md')).toBe(false);
    expect(grantTokens).toEqual([]);
  });

  it('is refused when the identity answers null or throws, and neither the answer nor the logs hold the bearer', async () => {
    await start(identity());
    const recorded = vi.spyOn(store, 'recordRejection'), kept = vi.spyOn(store, 'set'), looked = vi.spyOn(store, 'get');
    const nobody = await rpc(unknownToken, 'tools/list');
    class TokenExpired extends Error {
      override name = 'TokenExpired';
    }
    answers.set(patToken, () => {
      throw new TokenExpired(`expired: ${patToken}`);
    });
    const thrown = await rpc(patToken, 'tools/list');
    answers.set(samToken, () => {
      throw `not an error: ${samToken}`;
    });
    const odd = await rpc(samToken, 'tools/list');
    for (const refused of [nobody, thrown, odd]) {
      expect(refused.status).toBe(401);
      expect(refused.body).toEqual({ error: 'Create a MyGitNotes agent token after signing in.' });
      expect(refused.headers.get('www-authenticate')).toBe('Bearer realm="MyGitNotes MCP"');
      expect([...refused.headers].join('\n')).not.toMatch(/eyJ/);
    }
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: bearer-refused');
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: bearer-error (TokenExpired)');
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: bearer-error');
    expect(printed()).not.toMatch(/eyJ/);
    // An outside bearer is never a record id: nothing is read, kept or remembered under it.
    expect(recorded).not.toHaveBeenCalled();
    expect(kept).not.toHaveBeenCalled();
    expect(looked).not.toHaveBeenCalled();
    expect(grantTokens).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('remembers no rejection under the bearer when the credential for its grant fails', async () => {
    const failing = identity();
    failing.grantToken = async () => {
      throw new Error('credential store down');
    };
    await start(failing);
    const recorded = vi.spyOn(store, 'recordRejection');
    const failed = await rpc(patToken, 'tools/list');
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: 'Agent authorization service unavailable. Retry later.' });
    expect(recorded).not.toHaveBeenCalled();
    expect(printed()).not.toMatch(/eyJ/);
  });

  it('is refused when its grant is for another site', async () => {
    await start(identity());
    answers.set(patToken, { ...answers.get(patToken) as NonNullable<Resolved>, site: 'github:https://ghe.example.test' });
    const refused = await rpc(patToken, 'tools/list');
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual({ error: 'Create a MyGitNotes agent token after signing in.' });
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: grant-site');
    expect(grantTokens).toEqual([]);
    expect(providerAuthorizations).toEqual([]);
  });

  it('is read from the Authorization header only, never from the URL', async () => {
    await start(identity());
    const response = await post(`/mcp/${patToken}`, {}, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.status).toBe(401);
    expect(bearersAsked).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: no-token');
    // A header that is not one bearer token is no token either.
    for (const authorization of [`Basic ${patToken}`, `Bearer ${patToken} ${samToken}`, `Bearer ${patToken}, Bearer ${samToken}`, 'Bearer ']) expect((await post('/mcp', { Authorization: authorization }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    expect(bearersAsked).toEqual([]);
  });
});

describe('the headers a grant leaves behind', () => {
  it('are gone from the parsed headers and the raw list, whatever their case', () => {
    const req = { headers: { authorization: 'Bearer a.b.c', cookie: 'x=1', accept: '*/*' }, rawHeaders: ['Authorization', 'Bearer a.b.c', 'Accept', '*/*', 'COOKIE', 'x=1', 'authorization', 'Bearer d.e.f'] } as unknown as Request;
    dropHeaders(req, ['authorization', 'cookie']);
    expect(req.headers).toEqual({ accept: '*/*' });
    expect(req.rawHeaders).toEqual(['Accept', '*/*']);
  });

  it('are gone from headersDistinct of a real request too, read before the drop or after', async () => {
    const seenHere: unknown[] = [];
    const probe = createServer((req, res) => {
      try {
        if (req.url === '/early') void req.headersDistinct;
        dropHeaders(req as Request, ['authorization']);
        seenHere.push({ distinct: req.headersDistinct.authorization, accept: req.headersDistinct.accept });
      } catch (error) {
        seenHere.push((error as Error).name);
      } finally {
        res.end();
      }
    });
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const at = `http://127.0.0.1:${(probe.address() as { port: number; }).port}`;
    try {
      for (const where of ['/early', '/late']) await fetch(at + where, { headers: { Authorization: 'Bearer a.b.c', Accept: '*/*', Connection: 'close' } });
    } finally {
      await new Promise(resolve => probe.close(resolve));
    }
    expect(seenHere).toEqual([{ distinct: undefined, accept: ['*/*'] }, { distinct: undefined, accept: ['*/*'] }]);
  });
});

describe('a bearer shaped like a stored grant, beside an identity that resolves outside bearers', () => {
  const stored = 'g'.repeat(43);
  const keep = (record: object) => store.set(stored, { kind: 'agent', ownerId: 'edition:p1', name: 'Stored', createdAt: Date.now(), site: 'github', person: pat, audience: `${base}/mcp`, write: false, ...record }, null);

  it('is looked up in the store and never shown to the identity, found or not', async () => {
    await start(identity());
    // The identity would accept anything, were it asked.
    answers.set(stored, { person: sam, owner: 'edition:p2', write: true, site: 'github' });
    const missing = await rpc(stored, 'tools/list');
    expect(missing.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: grant-missing');
    await keep({});
    const found = await tool(stored, 'list_notebooks');
    expect(found.status).toBe(200);
    expect((found.body.result.structuredContent.notebooks as { key: string; }[]).map(notebook => notebook.key).sort()).toEqual(['notes~life', 'repo~ex']);
    expect(seen.at(-1)!.person).toEqual(pat);
    const byUrl = await post(`/mcp/${stored}`, { Authorization: `Bearer ${samToken}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(byUrl.status).toBe(200);
    expect(((await byUrl.json()).result.tools as { name: string; }[]).map(entry => entry.name)).not.toContain('write');
    expect(bearersAsked).toEqual([]);
    // The header beside the URL grant is another identity's token: nothing after the grant check sees it.
    expect(seen.at(-1)!.headers).not.toHaveProperty('authorization');
    const byHeader = await rpc(stored, 'tools/list');
    expect(byHeader.status).toBe(200);
    expect(seen.at(-1)!.headers).not.toHaveProperty('authorization');
  });

  it('is still held to its audience', async () => {
    await start(identity());
    answers.set(stored, { person: pat, owner: 'edition:p1', write: true, site: 'github' });
    await keep({ audience: 'https://elsewhere.example.test/mcp' });
    const refused = await rpc(stored, 'tools/list');
    expect(refused.status).toBe(401);
    expect(console.warn).toHaveBeenCalledWith('[mcp] unauthorized: grant-audience');
    expect(bearersAsked).toEqual([]);
  });
});
