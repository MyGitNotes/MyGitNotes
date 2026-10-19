import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { createApp } from '../src/app.js';
import { type IdentityService, providerIdentity } from '../src/identity.js';
import { identityContract } from '../src/identity-contract.js';
import { memoryAccountSource } from '../src/memory-account-source.js';
import { storedSessions } from '../src/browser-sessions.js';
import { createRecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const roots: string[] = [];
const scratch = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-identity-')));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const environment = () => {
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: '', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', GITHUB_APP_TYPE: 'github-app', GITHUB_CLIENT_ID: 'app-client', GITHUB_CLIENT_SECRET: 'app-secret' })) vi.stubEnv(key, value);
};

describe('the provider identity', () => {
  beforeEach(environment);
  identityContract('provider', async () => {
    const store = createRecordStore(scratch());
    const sessions = storedSessions(store);
    await store.set('o'.repeat(43), { kind: 'session', token: 'token-one', login: 'octo', userId: 1 });
    await store.set('p'.repeat(43), { kind: 'session', token: 'token-two', login: 'hubot', userId: 2 });
    const site = { type: 'github' } as const;
    const configSource = { mode: 'remote' as const, settings: async () => workspaceSettings([{ type: 'github', repository: 'owner/notes', branch: 'main' }]) };
    return { identity: providerIdentity({ store, sessions, configSource }), site, visitor: async n => ({ gh_notes_session: n === 1 ? 'o'.repeat(43) : 'p'.repeat(43) }), tokenOf: n => n === 1 ? 'token-one' : 'token-two' };
  });
});

describe('an identity with a person and no token', () => {
  let server: Server | undefined, base = '';
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  });
  const identity: IdentityService = {
    router: Router(),
    signedIn: async req => req.headers['x-person'] ? { person: { realm: 'edition', userId: 'p1' }, login: 'pat', owner: 'edition:p1' } : null,
    token: async () => undefined,
    grantCredential: async () => undefined,
    grantToken: async () => undefined,
    noCredentialMessage: () => 'Link a GitHub account to open this repository.',
    signInOptions: async () => [{ id: 'google', label: 'Google', url: '/api/auth/google' }],
    configured: async () => true,
    signOut: async () => {},
  };
  const start = async () => {
    environment();
    const product = scratch();
    const recordStore = createRecordStore(product);
    const configSource = memoryAccountSource({ personOf: async request => request.person ? String(request.person.userId) : request.headers['x-person'] as string | undefined });
    server = createServer(createApp(product, { configSource, recordStore, workspaceChoices: null, identity }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
    return recordStore;
  };
  const call = async (method: string, url: string, body?: unknown, signedIn = true) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(signedIn ? { 'x-person': 'p1' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };

  it('lists the members, and the session probe says it holds no platform credential', async () => {
    await start();
    expect(await call('GET', '/api/workspace/members')).toMatchObject({ status: 200, body: { members: [], changeable: true } });
    expect((await call('GET', '/api/workspace/members', undefined, false)).status).toBe(401);
    expect(await call('GET', '/api/auth/session')).toMatchObject({ status: 200, body: { authenticated: true, login: 'pat', platformAccess: false, provider: 'google', loginUrl: '/api/auth/google', signInOptions: [{ id: 'google', label: 'Google', url: '/api/auth/google' }], configured: true } });
    expect((await call('GET', '/api/auth/session', undefined, false)).body).toMatchObject({ authenticated: false, platformAccess: false });
  });

  it('keeps an agent grant of the person without a credential, owned by the identity', async () => {
    const store = await start();
    const made = await call('POST', '/api/auth/agent-token', { name: 'client' });
    expect(made.status).toBe(200);
    const grant = await store.get(made.body.token);
    expect(grant).toMatchObject({ kind: 'agent', ownerId: 'edition:p1', person: { realm: 'edition', userId: 'p1' } });
    expect(grant).not.toHaveProperty('credential');
    expect((await call('GET', '/api/auth/agent-tokens')).body.grants).toHaveLength(1);
    expect((await call('DELETE', `/api/auth/agent-tokens/${made.body.id}`)).status).toBe(200);
    expect((await call('POST', '/api/auth/agent-token', {}, false)).status).toBe(401);
  });

  it('refuses an agent grant whose person holds no credential on the site, with the identity\'s message', async () => {
    const store = await start();
    const made = await call('POST', '/api/auth/agent-token', { name: 'client' });
    expect(made.status).toBe(200);
    expect(await store.get(made.body.token)).toMatchObject({ kind: 'agent' });
    const response = await fetch(`${base}/mcp/${made.body.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Link a GitHub account to open this repository.' });
  });
});
