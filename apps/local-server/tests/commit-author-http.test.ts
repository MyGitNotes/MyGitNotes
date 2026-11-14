import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { repositoryRef, type SourceConfig, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import type { BearerGrant, IdentityService, SignedIn } from '../src/identity.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { githubFixture } from '../../../packages/core/tests/fixtures/github.js';
import { workspaceSettings } from './workspace-settings.js';

/**
 * A deployment that pushes with one server credential: everyone signs in with the identity below, and every provider
 * call carries `bot-token`. The commits must still name the person who made them.
 */
const pat = { realm: 'edition', userId: 'p1' }, sam = { realm: 'edition', userId: 'p2' }, mal = { realm: 'edition', userId: 'p3' };
const patAuthor = { name: 'Pat Example', email: 'pat@example.test' };
const people: Record<string, SignedIn> = { pat: { person: pat, login: 'pat', owner: 'edition:p1', author: patAuthor }, sam: { person: sam, login: 'sam', owner: 'edition:p2' }, mal: { person: mal, login: 'mal', owner: 'edition:p3', author: { name: 'Mal\nCo-authored-by: Root <root@example.test>', email: 'mal@example.test' } } };
/** Outside bearers, as an OIDC access token looks. */
const patBearer = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJwMSJ9.c2lnbmF0dXJlLW9mLXBhdA', samBearer = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJwMiJ9.c2lnbmF0dXJlLW9mLXNhbQ', malBearer = 'eyJhbGciOiJSUzI1NiJ9.eyJvaWQiOiJwMyJ9.c2lnbmF0dXJlLW9mLW1hbA';
const bearers: Record<string, BearerGrant> = { [patBearer]: { person: pat, owner: 'edition:p1', author: patAuthor, write: true, site: 'github' }, [samBearer]: { person: sam, owner: 'edition:p2', write: true, site: 'github' }, [malBearer]: { person: mal, owner: 'edition:p3', author: { name: 'Mal <root@example.test>', email: 'mal@example.test' }, write: true, site: 'github' } };

const who = (cookie: string | undefined) => people[/(?:^|;\s*)who=(\w+)/.exec(cookie ?? '')?.[1] ?? ''] ?? null;
const identity: IdentityService = { router: Router(), signedIn: async req => who(req.headers.cookie), token: async req => who(req.headers.cookie) ? 'bot-token' : undefined, grantCredential: async () => undefined, grantToken: async () => 'bot-token', bearerGrant: async (_req, bearer) => bearers[bearer] ?? null, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const source: SourceConfig = { type: 'github', repository: 'owner/repo', branch: 'main' };
const configSource: WorkspaceConfigSource = { mode: 'remote', settings: async () => workspaceSettings([source]) };

let root: string, server: Server, base: string, store: RecordStore, fixture: ReturnType<typeof githubFixture>, authorizations: Set<string | null>;
/** What `POST /git/commits` was sent, in order. */
const commits = () => fixture.calls.filter(call => call.endpoint === '/git/commits').map(call => call.body as { message: string; author?: unknown; });

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-commit-author-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  // Git-shaped object ids, which a workspace revision token requires.
  fixture = githubFixture({}, { hexIds: true });
  authorizations = new Set();
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.github.com/')) return nativeFetch(input, init);
    authorizations.add(new Headers(init?.headers).get('authorization'));
    return fixture.request(url, init);
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const save = (person: string, file: string, content: string) => fetch(`${base}/api/notes`, { method: 'POST', headers: { Connection: 'close', Cookie: `who=${person}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file, content, metadata: {}, revision: fixture.head() }) });
const tool = async (bearer: string, name: string, args: object) => {
  const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { Connection: 'close', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return { status: response.status, body: await response.json() };
};
/** Writes a note over `/mcp` with the revision the grant reads first, as an agent does. */
const write = async (bearer: string, content: string) => {
  const revision = (await tool(bearer, 'read', { path: 'notes/ex/a.md' })).body.result.structuredContent.revision as string;
  return tool(bearer, 'write', { path: 'notes/ex/a.md', content, revision });
};

describe('a save in the web app with the server credential', () => {
  it('commits as the signed-in person the identity gives an author, and as before for one it gives none', async () => {
    const saved = await save('pat', 'notes/ex/a.md', '# Alpha\nby Pat\n');
    expect(saved.status, await saved.clone().text()).toBe(200);
    const other = await save('sam', 'notes/ex/a.md', '# Alpha\nby Sam\n');
    expect(other.status, await other.clone().text()).toBe(200);
    expect(commits()).toEqual([{ message: 'docs(notes): write a.md', tree: expect.any(String), parents: [expect.any(String)], author: patAuthor }, { message: 'docs(notes): write a.md', tree: expect.any(String), parents: [expect.any(String)] }]);
    expect(Object.keys(commits()[1])).toEqual(['message', 'tree', 'parents']);
    // Both were pushed with the one credential.
    expect([...authorizations]).toEqual(['Bearer bot-token']);
  });

  it('commits a batch of working notes as the person too', async () => {
    const committed = await fetch(`${base}/api/notes/commit`, { method: 'POST', headers: { Connection: 'close', Cookie: 'who=pat', 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: repositoryRef(source).id, notes: [{ path: 'notes/ex/a.md', content: '# Alpha\nbatch\n', metadata: {} }], revision: fixture.head(), message: 'docs: batch' }) });
    expect(committed.status, await committed.clone().text()).toBe(200);
    expect(commits()).toEqual([expect.objectContaining({ message: 'docs: batch', author: patAuthor })]);
  });

  it('lets a person whose author cannot be written into a commit read, and refuses their save', async () => {
    const listed = await fetch(`${base}/api/notes`, { headers: { Connection: 'close', Cookie: 'who=mal' } });
    expect(listed.status).toBe(200);
    const refused = await save('mal', 'notes/ex/a.md', '# Alpha\nby Mal\n');
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "The commit author's name or email cannot be written into a commit." });
    expect(commits()).toEqual([]);
    expect(fixture.text('notes/ex/a.md')).toContain('hello world');
  });
});

describe('a write over /mcp with the server credential', () => {
  it("commits as the author an outside bearer's grant carries, and as before for a grant without one", async () => {
    const written = await write(patBearer, '# Alpha\nby Pat\n');
    expect(written.body.result.isError, JSON.stringify(written.body.result)).toBeUndefined();
    const other = await write(samBearer, '# Alpha\nby Sam\n');
    expect(other.body.result.isError, JSON.stringify(other.body.result)).toBeUndefined();
    expect(commits().map(commit => commit.author)).toEqual([patAuthor, undefined]);
    expect(Object.keys(commits()[1])).toEqual(['message', 'tree', 'parents']);
    // The agent's trailer stays where it was.
    expect(commits()[0].message).toMatch(/^docs\(notes\): write a\.md \(Agent, \d{4}-\d\d-\d\d\)\n\nAgent-Edit: \d{4}-\d\d-\d\d$/);
    expect([...authorizations]).toEqual(['Bearer bot-token']);
  });

  it('refuses the write of a grant whose author cannot be written into a commit', async () => {
    const refused = await write(malBearer, '# Alpha\nby Mal\n');
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toContain("The commit author's name or email cannot be written into a commit.");
    expect(commits()).toEqual([]);
  });

  it('uses the author a stored grant records, and none for a stored grant without one', async () => {
    const withAuthor = 'g'.repeat(43), without = 'h'.repeat(43);
    const grant = { kind: 'agent', ownerId: 'edition:p1', name: 'Stored', createdAt: Date.now(), site: 'github', person: pat, audience: `${base}/mcp`, write: true };
    await store.set(withAuthor, { ...grant, author: patAuthor }, null);
    await store.set(without, grant, null);
    const first = await write(withAuthor, '# Alpha\nstored\n');
    expect(first.body.result.isError, JSON.stringify(first.body.result)).toBeUndefined();
    const second = await write(without, '# Alpha\nstored again\n');
    expect(second.body.result.isError, JSON.stringify(second.body.result)).toBeUndefined();
    expect(commits().map(commit => commit.author)).toEqual([patAuthor, undefined]);
  });
});
