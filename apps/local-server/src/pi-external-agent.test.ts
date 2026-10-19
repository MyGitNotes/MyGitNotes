import express from 'express';
import type { AddressInfo } from 'node:net';
import type { WorkspaceConfigSource } from '@mygitnotes/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserSessions } from './browser-sessions.js';
import { providerIdentity } from './identity.js';
import { verifyBridgeToken } from './pi-bridge-token.js';
import { externalPiAgent, externalPiEnvironment } from './pi-external-agent.js';

const secret = 'shared-secret-0123456789';
const servers: { close: () => void; }[] = [];
afterEach(() => servers.splice(0).forEach(server => server.close()));

const listen = (app: express.Express) => new Promise<string>(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  servers.push(server);
});

/** Signed-in people by cookie value, standing in for BrowserSessions under the default (provider) identity. */
const sessionsOf = (people: Record<string, Record<string, unknown>>): BrowserSessions => ({ kind: 'stored', read: async (req: { headers: { cookie?: string; }; }) => people[String(req.headers.cookie)] as never ?? null } as unknown as BrowserSessions);
const identityOver = (people: Record<string, Record<string, unknown>>) => providerIdentity({ store: {} as never, sessions: sessionsOf(people), configSource });
const configSource = { mode: 'remote', settings: async () => ({ site: { type: 'github' } }) } as unknown as WorkspaceConfigSource;

async function setup(owners = ['octocat', 'id:42']) {
  const seen: { method?: string; auth?: string; body?: unknown; }[] = [];
  const bridge = express();
  bridge.use(express.json());
  bridge.all('/session', (req, res) => {
    seen.push({ method: req.method, auth: req.headers.authorization, body: req.body });
    if (req.headers['x-fail']) return res.status(500).json({ error: 'boom' });
    res.json({ session: req.method === 'DELETE' ? null : { id: 's1', location: req.body?.location, socket: { url: 'wss://pi.example.com/ws', protocols: ['mygitnotes-bridge.signed'] } } });
  });
  const bridgeUrl = await listen(bridge);
  const identity = identityOver({
    owner: { kind: 'session', login: 'OctoCat', userId: 7 },
    byId: { kind: 'session', login: 'renamed', userId: 42 },
    other: { kind: 'session', login: 'mallory', userId: 9 },
    wrongRealm: { kind: 'session', login: 'octocat', userId: 7, realm: 'gitlab:https://gitlab.com:x' },
    expired: { kind: 'session', login: 'octocat', userId: 7, upstreamExpiresAt: Date.now() - 1000 },
    renewable: { kind: 'session', login: 'octocat', userId: 7, upstreamExpiresAt: Date.now() - 1000, refreshToken: 'r' },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/pi', externalPiAgent({ bridgeUrl, secret, owners, identity }).router);
  return { url: await listen(app), seen };
}
const request = (url: string, method: string, cookie?: string, body?: unknown) => fetch(`${url}/api/pi/session`, { method, headers: { 'content-type': 'application/json', ...cookie ? { cookie } : {} }, body: body === undefined || method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body) });

describe('external Pi agent routes', () => {
  it('shows no agent to anyone who is not an allowed owner', async () => {
    const { url, seen } = await setup();
    for (const cookie of [undefined, 'other', 'unknown']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) expect((await request(url, method, cookie, { location: { repository: 'r', folder: '' } })).status).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  it('refuses a session of another provider realm or one past its expiry, as the main site does', async () => {
    const { url, seen } = await setup();
    for (const cookie of ['wrongRealm', 'expired']) expect((await request(url, 'GET', cookie)).status).toBe(404);
    expect((await request(url, 'GET', 'renewable')).status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('lets an owner by login or by user id read, start, restart and end the session through the bridge', async () => {
    const { url, seen } = await setup();
    for (const cookie of ['owner', 'byId']) {
      const read = await request(url, 'GET', cookie);
      expect(read.status).toBe(200);
      expect((await read.json()).piAvailable).toBe(true);
    }
    const started = await (await request(url, 'POST', 'owner', { repository: 'github:o/n@main', folder: 'a', sessionFile: '/x.jsonl' })).json();
    expect(started.session).toMatchObject({ id: 's1', location: { repository: 'github:o/n@main', folder: 'a' }, socket: { url: 'wss://pi.example.com/ws' } });
    expect((await request(url, 'PUT', 'owner', { repository: 'r', folder: '' })).status).toBe(200);
    expect((await (await request(url, 'DELETE', 'owner')).json()).session).toBeNull();
    expect(seen.map(call => call.method)).toEqual(['GET', 'GET', 'POST', 'PUT', 'DELETE']);
    expect(seen[2].body).toEqual({ location: { repository: 'github:o/n@main', folder: 'a' }, sessionFile: '/x.jsonl' });
    // The bridge sees a short-lived signed token, never the secret.
    for (const call of seen) {
      const bearer = call.auth!.replace('Bearer ', '');
      expect(bearer).not.toContain(secret);
      expect(verifyBridgeToken(secret, bearer, 'http', new Date())).toBe(true);
      expect(verifyBridgeToken(secret, bearer, 'http', new Date(Date.now() + 5 * 60_000))).toBe(false);
    }
  });

  it('reports a bridge that is down or failing as a bad gateway', async () => {
    const down = express();
    down.use('/api/pi', externalPiAgent({ bridgeUrl: 'http://127.0.0.1:1', secret, owners: ['octocat'], identity: identityOver({ owner: { kind: 'session', login: 'octocat', userId: 7 } }) }).router);
    const url = await listen(down);
    expect((await request(url, 'GET', 'owner')).status).toBe(502);
  });
});

describe('externalPiEnvironment', () => {
  it('is off without a URL, and refuses a partial setting', () => {
    expect(externalPiEnvironment({})).toBeUndefined();
    expect(() => externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com', MYGITNOTES_EXTERNAL_PI_OWNERS: 'a' })).toThrow('SECRET');
    expect(() => externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com', MYGITNOTES_EXTERNAL_PI_SECRET: 's' })).toThrow('OWNERS');
    expect(externalPiEnvironment({ MYGITNOTES_EXTERNAL_PI_URL: 'https://pi.example.com', MYGITNOTES_EXTERNAL_PI_SECRET: 's', MYGITNOTES_EXTERNAL_PI_OWNERS: ' a, id:3 ' })).toEqual({ bridgeUrl: 'https://pi.example.com', secret: 's', owners: ['a', 'id:3'] });
  });
});
