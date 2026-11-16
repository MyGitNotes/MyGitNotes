import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { sweepIdleLive, textEdits } from '@mygitnotes/core';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { githubFixture } from '../../../packages/core/tests/fixtures/github.js';
import { credentialIdFor, CredentialRejected } from './auth.js';
import { providerIdentity, providerLiveIdentity } from './identity.js';
import { liveEditorSetting } from './live-env.js';
import { redisTestTurn } from './live-builtin/redis-test-turn.js';
import { createRecordStore } from './record-store/index.js';
import { storedSessions } from './browser-sessions.js';
import { type RunningServer, startServer } from './server.js';

/*
 * The built-in live editor as the environment turns it on (docs/specs/2026-11-16-collab-first-self-host A8, A6; slice
 * S4): the server entry a Docker self-host runs, against a stand-in for GitHub behind `fetch`. The end-to-end cases need
 * a real Redis, which MYGITNOTES_TEST_REDIS_URL names; the refusals and the unset case need none.
 */

const url = process.env.MYGITNOTES_TEST_REDIS_URL;
const nativeFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const freePort = async () => {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address() as { port: number; };
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
};
const until = async (what: string, check: () => unknown, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`Still not so after ${ms} ms: ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

/** What a remote GitHub deployment's environment holds, with everything this suite must not inherit emptied. */
const environment = (port: number, extra: Record<string, string> = {}) => ({
  MYGITNOTES_SOURCE: 'github',
  MYGITNOTES_REPOSITORY: 'owner/repo',
  MYGITNOTES_BRANCH: 'main',
  MYGITNOTES_GITHUB_URL: '',
  MYGITNOTES_LOCAL_PATH: '',
  GITHUB_NOTES_SOURCE: '',
  GITHUB_NOTES_REPOSITORY: '',
  GITHUB_NOTES_BRANCH: '',
  GITHUB_NOTES_LOCAL_PATH: '',
  REPO_ROOT: '',
  GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'secret',
  GITHUB_APP_TYPE: '',
  SESSION_SECRET: 's'.repeat(64),
  VERCEL: '',
  REDIS_URL: '',
  UPSTASH_REDIS_REST_URL: '',
  UPSTASH_REDIS_REST_TOKEN: '',
  KV_REST_API_URL: '',
  KV_REST_API_TOKEN: '',
  MYGITNOTES_STORAGE: '',
  MYGITNOTES_PRODUCT_REPOSITORY: '',
  MYGITNOTES_SESSION_NAMESPACE: '',
  MYGITNOTES_LIVE_EDITOR: '',
  MYGITNOTES_LIVE_REDIS_URL: '',
  MYGITNOTES_CACHE_REDIS_URL: '',
  MYGITNOTES_LIVE_CHECKIN_AT: 'off',
  MYGITNOTES_LIVE_IDLE_CHECKIN: 'off',
  MYGITNOTES_LIVE_SWEEP_SECRET: '',
  MYGITNOTES_TIMEZONE: '',
  MYGITNOTES_EXTERNAL_PI_URL: '',
  MYGITNOTES_EXTERNAL_PI_PAIRING: '',
  HOST: '127.0.0.1',
  PORT: String(port),
  APP_URL: `http://localhost:${port}`,
  ...extra,
});

let running: RunningServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const boot = async (extra: Record<string, string>, options: Parameters<typeof startServer>[0] = {}) => {
  const port = await freePort();
  for (const [key, value] of Object.entries(environment(port, extra))) vi.stubEnv(key, value);
  running = await startServer({ log: () => {}, ...options });
  return running;
};

describe('MYGITNOTES_LIVE_EDITOR', () => {
  it('is off when unset, empty or off, turns the built-in editor on with builtin, and refuses any other value', () => {
    expect(liveEditorSetting({})).toBe('off');
    expect(liveEditorSetting({ MYGITNOTES_LIVE_EDITOR: '' })).toBe('off');
    expect(liveEditorSetting({ MYGITNOTES_LIVE_EDITOR: ' Off ' })).toBe('off');
    expect(liveEditorSetting({ MYGITNOTES_LIVE_EDITOR: 'builtin' })).toBe('builtin');
    for (const value of ['on', 'true', 'frame', 'built-in', '1']) expect(() => liveEditorSetting({ MYGITNOTES_LIVE_EDITOR: value }), value).toThrow(/MYGITNOTES_LIVE_EDITOR/);
  });

  it('left unset starts the server without a live editor: no live field, no live route, and no socket', async () => {
    const fixture = githubFixture({}, { hexIds: true });
    const server = await boot({});
    expect(server.live).toBeUndefined();
    const base = `http://127.0.0.1:${server.port}`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const address = String(input);
      if (address.startsWith(base)) return nativeFetch(input, init);
      if (address === 'https://api.github.com/repos/owner/repo') return json({ full_name: 'owner/repo', default_branch: 'main', private: false, permissions: { push: false } });
      if (address.startsWith('https://api.github.com/repos/owner/repo/') || address === 'https://api.github.com/graphql') return fixture.request(input, init);
      throw new Error(`Unexpected outbound request ${address}`);
    });
    const workspace = await (await fetch(`${base}/api/workspace`)).json();
    expect(workspace.repositories).toHaveLength(1);
    expect(workspace.repositories[0]).not.toHaveProperty('live');
    expect((await fetch(`${base}/api/live/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/live/socket`, { origin: `http://localhost:${server.port}` });
    expect(await new Promise(resolve => {
      socket.on('open', () => resolve('open'));
      socket.on('error', () => resolve('refused'));
    })).toBe('refused');
  });

  it('refuses to start with builtin where the editor cannot run, and names what to change', async () => {
    const native = { MYGITNOTES_LIVE_EDITOR: 'builtin', REDIS_URL: 'redis://127.0.0.1:1' };
    const refusals: [Record<string, string>, RegExp][] = [
      [{ MYGITNOTES_LIVE_EDITOR: 'yes' }, /MYGITNOTES_LIVE_EDITOR/],
      // Sign-ins kept in cookies leave no stored credential for a check-in to commit with.
      [{ ...native, MYGITNOTES_STORAGE: 'cookie' }, /MYGITNOTES_STORAGE/],
      // A REST-only Redis cannot hold the live store.
      [{ MYGITNOTES_LIVE_EDITOR: 'builtin', UPSTASH_REDIS_REST_URL: 'https://cache.example.test', UPSTASH_REDIS_REST_TOKEN: 'token' }, /MYGITNOTES_LIVE_REDIS_URL.*redis:\/\//s],
      [{ MYGITNOTES_LIVE_EDITOR: 'builtin' }, /MYGITNOTES_LIVE_REDIS_URL.*redis:\/\//s],
      [{ ...native, MYGITNOTES_LIVE_REDIS_URL: 'https://cache.example.test' }, /MYGITNOTES_LIVE_REDIS_URL.*redis:\/\//s],
      [{ ...native, VERCEL: '1' }, /Vercel/],
      [{ ...native, APP_URL: 'http://notes.example.com' }, /APP_URL/],
      [{ ...native, APP_URL: '' }, /APP_URL/],
    ];
    for (const [extra, message] of refusals) {
      await expect(boot(extra), JSON.stringify(extra)).rejects.toThrow(message);
      vi.unstubAllEnvs();
    }
  });

  it('refuses builtin for a local workspace', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-env-')));
    try {
      fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), 'schema_version: 4\nworkspace:\n  title: Local\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
      await expect(boot({ MYGITNOTES_LIVE_EDITOR: 'builtin', REDIS_URL: 'redis://127.0.0.1:1', MYGITNOTES_SOURCE: 'local', MYGITNOTES_REPOSITORY: '', MYGITNOTES_LOCAL_PATH: root })).rejects.toThrow(/local/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the default identity', () => {
  const session = { userId: 101, login: 'ann' };

  it('shows a github.com person in the live editor by login with their noreply address, and people of other sites by login alone', () => {
    expect(providerLiveIdentity({ type: 'github' }, session)).toEqual({ name: 'ann', email: '101+ann@users.noreply.github.com' });
    expect(providerLiveIdentity({ type: 'github', url: 'https://ghe.example.test' }, session)).toEqual({ name: 'ann' });
    expect(providerLiveIdentity({ type: 'gitlab', url: 'https://gitlab.com' }, session)).toEqual({ name: 'ann' });
  });

  it("answers a person's stored token only for their own realm, and rejects a credential that is gone", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-env-')));
    try {
      for (const [key, value] of Object.entries(environment(0))) vi.stubEnv(key, value);
      const store = createRecordStore(root);
      const identity = providerIdentity({ store, sessions: storedSessions(store), configSource: { mode: 'remote', settings: async () => ({ site: { type: 'github' }, members: [], manifest: (_member, inRepository) => inRepository() }) } });
      const realm = 'github:https://github.com:client';
      await store.set(credentialIdFor({ type: 'github' }, 101), { kind: 'credential', realm, token: 'token-ann' }, null);
      expect(await identity.personToken!({ realm, userId: 101 }, { type: 'github' })).toBe('token-ann');
      // Another OAuth app's person, another site's, and a user id that is no GitHub id name no credential here.
      expect(await identity.personToken!({ realm: 'github:https://github.com:other-client', userId: 101 }, { type: 'github' })).toBeUndefined();
      expect(await identity.personToken!({ realm: 'edition', userId: 'p1' }, { type: 'github' })).toBeUndefined();
      expect(await identity.personToken!({ realm, userId: '101' }, { type: 'github' })).toBeUndefined();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(identity.personToken!({ realm, userId: 102 }, { type: 'github' })).rejects.toBeInstanceOf(CredentialRejected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!url)('the server entry with the built-in editor on, over a real Redis (MYGITNOTES_TEST_REDIS_URL)', () => {
  const turn = redisTestTurn(url);
  beforeAll(() => turn.take());
  afterAll(() => turn.give());

  const database = (n: number) => {
    const address = new URL(url!);
    address.pathname = `/${n}`;
    return address.toString();
  };
  const note = { notebookId: 'repo~ex', path: 'notes/ex/a.md' };
  const gitText = '---\ncustom: retained\n---\n# Alpha\nhello world\n';
  const people: Record<string, { id: number; login: string; }> = { 'token-ann': { id: 101, login: 'ann' }, 'token-ben': { id: 102, login: 'ben' } };
  let namespace: string, fixture: ReturnType<typeof githubFixture>, base: string, now: number;
  /** Provider requests the server made: where to, and with whose token. */
  let outbound: { url: string; method: string; token: string | null; }[];
  /** Tokens the stand-in refuses repository access to, as GitHub refuses a revoked or expired one. */
  let revoked: Set<string>;
  const tabs: { destroy(): void; }[] = [];

  /** Runs `work` over a client of one database of the throwaway Redis. */
  const withDatabase = async <T>(n: number, work: (raw: ReturnType<typeof createClient>) => Promise<T>): Promise<T> => {
    const raw = createClient({ url: database(n), socket: { connectTimeout: 10_000, reconnectStrategy: false } });
    raw.on('error', () => {});
    await raw.connect();
    try {
      return await work(raw);
    } finally {
      raw.destroy();
    }
  };
  const scan = async (raw: ReturnType<typeof createClient>) => {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, page] = await raw.sendCommand(['SCAN', cursor, 'MATCH', `gh-notes:${namespace}:*`, 'COUNT', '1000']) as [string, string[]];
      found.push(...page);
      cursor = next;
    } while (cursor !== '0');
    return found;
  };
  /** Every key of this run in one database. */
  const keys = (n: number) => withDatabase(n, scan);
  /** Deletes every key of this run in both databases; answers how many are left. */
  const dropKeys = async () => {
    let left = 0;
    for (const n of [0, 1]) {
      left += await withDatabase(n, async raw => {
        const found = await scan(raw);
        for (let i = 0; i < found.length; i += 500) await raw.sendCommand(['DEL', ...found.slice(i, i + 500)]);
        return (await scan(raw)).length;
      });
    }
    return left;
  };

  const start = async () => {
    namespace = `live-env-${randomBytes(6).toString('hex')}`;
    fixture = githubFixture({}, { hexIds: true });
    outbound = [];
    revoked = new Set();
    now = Date.now();
    const server = await boot({ MYGITNOTES_LIVE_EDITOR: 'builtin', REDIS_URL: database(0), MYGITNOTES_CACHE_REDIS_URL: database(1), MYGITNOTES_SESSION_NAMESPACE: namespace }, { clock: () => now });
    base = `http://127.0.0.1:${server.port}`;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const address = String(input);
      if (address.startsWith(base)) return nativeFetch(input, init);
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? null;
      outbound.push({ url: address, method: init?.method ?? 'GET', token });
      if (address === 'https://github.com/login/oauth/access_token') return json({ access_token: `token-${JSON.parse(String(init?.body)).code}` });
      if (address === 'https://api.github.com/user') return token && people[token] ? json(people[token]) : json({ message: 'Bad credentials' }, 401);
      if (!token || !people[token] || revoked.has(token)) return json({ message: 'Bad credentials' }, 401);
      if (address === 'https://api.github.com/repos/owner/repo') return json({ full_name: 'owner/repo', default_branch: 'main', private: true, permissions: { push: true } });
      if (address.startsWith('https://api.github.com/repos/owner/repo/') || address === 'https://api.github.com/graphql') return fixture.request(input, init);
      throw new Error(`Unexpected outbound request ${address}`);
    });
    return server;
  };
  /** Signs in as the account the stand-in knows by `login`, and answers the session cookie. */
  const signIn = async (login: string) => {
    const begun = await fetch(`${base}/api/auth/github`, { redirect: 'manual' });
    const target = new URL(begun.headers.get('location')!);
    const pending = begun.headers.getSetCookie().find(line => line.startsWith('gh_notes_oauth='))!.split(';')[0];
    const callback = await fetch(`${base}/api/auth/github/callback?state=${target.searchParams.get('state')}&code=${login}`, { redirect: 'manual', headers: { Cookie: pending } });
    expect(callback.status).toBe(302);
    return callback.headers.getSetCookie().find(line => line.startsWith('gh_notes_session='))!.split(';')[0];
  };
  const post = async (route: string, body: unknown, cookie: string) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  /** A tab of the signed-in person on the live note, as the web opens one: a ticket for each socket, then typing over it. */
  const tab = async (cookie: string) => {
    const document = new Y.Doc(), content = document.getText('content');
    const ticket = async () => {
      const answer = await post('/api/live/socket-ticket', note, cookie);
      if (answer.status !== 200) throw new Error(`socket-ticket: ${answer.status} ${JSON.stringify(answer.body)}`);
      return answer.body as { ticket: string; document: string; };
    };
    let first: { ticket: string; document: string; } | undefined = await ticket();
    const origin = process.env.APP_URL!;
    const websocket = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${running!.port}/live/socket`,
      WebSocketPolyfill: class extends WebSocket {
        constructor(address: string | URL) {
          super(address, { origin });
        }
      },
      delay: 30,
      minDelay: 30,
      maxDelay: 30,
      factor: 1,
      jitter: false,
    });
    const provider = new HocuspocusProvider({
      websocketProvider: websocket,
      name: first.document,
      document,
      token: async () => {
        const given = first ?? await ticket();
        first = undefined;
        return given.ticket;
      },
    });
    provider.attach();
    const opened = {
      text: () => content.toString(),
      type(next: string) {
        const edits = textEdits(content.toString(), next);
        document.transact(() => {
          for (let i = edits.length - 1; i >= 0; i--) {
            if (edits[i].to > edits[i].from) content.delete(edits[i].from, edits[i].to - edits[i].from);
            if (edits[i].text) content.insert(edits[i].from, edits[i].text);
          }
        });
      },
      synced: () => until('the tab synced with the server', () => provider.isSynced),
      saved: () => until('the server acknowledged the typing', () => provider.isSynced && provider.unsyncedChanges === 0),
      destroy() {
        provider.destroy();
        websocket.destroy();
      },
    };
    tabs.push(opened);
    return opened;
  };
  /** Ann and Ben sign in, open the note and type a line each; answers the text they left and the repository's id. */
  const typedByTwo = async () => {
    const [ann, ben] = [await signIn('ann'), await signIn('ben')];
    const opened = await post('/api/live/checkout', note, ann);
    expect(opened).toMatchObject({ status: 200, body: { outcome: 'created', checkout: { path: note.path, pending: false } } });
    const [one, two] = [await tab(ann), await tab(ben)];
    await Promise.all([one.synced(), two.synced()]);
    expect(one.text()).toBe(gitText);
    one.type(`${gitText}ann was here\n`);
    await one.saved();
    now += 1000;
    await until("Ben's tab shows Ann's line", () => two.text() === `${gitText}ann was here\n`);
    two.type(`${gitText}ann was here\nben too\n`);
    await two.saved();
    for (const open of tabs.splice(0)) open.destroy();
    const repository = 'github:owner/repo@main';
    await until('both have left the note', async () => (await running!.live!.service.checkouts(repository))[0]?.activeEditors === 0);
    return { text: `${gitText}ann was here\nben too\n`, repository, ann, ben };
  };
  const commitsMade = () => fixture.calls.filter(call => call.endpoint === '/git/commits');

  beforeEach(() => {
    tabs.length = 0;
  });
  afterEach(async () => {
    for (const open of tabs.splice(0)) open.destroy();
    await running?.close();
    running = undefined;
    expect(await dropKeys()).toBe(0);
  });

  it("lets two signed-in people type over the socket, and the idle check-in commits with the first editor's stored token: they author it, and the second is a co-author by noreply address", async () => {
    const server = await start();
    const { text, repository } = await typedByTwo();
    // Nothing is due while less than 5 minutes passed since Ben's line.
    now += 5 * 60_000 - 2000;
    expect(await sweepIdleLive(server.live!, { now: () => now })).toMatchObject({ due: 0 });
    expect(commitsMade()).toEqual([]);
    now += 2000;
    outbound.length = 0;
    const report = await sweepIdleLive(server.live!, { now: () => now });
    expect(report).toMatchObject({ due: 1, failed: [], results: [{ path: note.path, committed: true, released: true }] });
    expect(fixture.text(note.path)).toBe(text);
    expect(commitsMade()).toHaveLength(1);
    const [{ body: commit }] = commitsMade();
    expect(commit.author).toEqual({ name: 'ann', email: '101+ann@users.noreply.github.com' });
    expect(commit.message.split('\n').filter((line: string) => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: ben <102+ben@users.noreply.github.com>']);
    expect(commit.message).toMatch(/^docs\(notes\): live edit a\.md\n\nLive-Link: /);
    // Every provider request of the check-in carried Ann's own token, the one her sign-in stored.
    expect(outbound.length).toBeGreaterThan(0);
    expect([...new Set(outbound.map(call => call.token))]).toEqual(['token-ann']);
    expect(await server.live!.service.checkouts(repository)).toEqual([]);
    // The remote cache went to its own Redis, and the records and the live store stayed in the other.
    const [main, cache] = [await keys(0), await keys(1)];
    expect(cache.length).toBeGreaterThan(0);
    expect(cache.every(key => key.startsWith(`gh-notes:${namespace}:cache:`))).toBe(true);
    expect(main.some(key => key.startsWith(`gh-notes:${namespace}:live-store:v1:`))).toBe(true);
    expect(main.filter(key => key.startsWith(`gh-notes:${namespace}:cache:`))).toEqual([]);
  }, 30_000);

  it("commits with the second editor's token when the first editor's was revoked, credits both, and leaves the text live when nobody's works", async () => {
    const server = await start();
    const { text, repository } = await typedByTwo();
    now += 5 * 60_000;
    revoked.add('token-ann').add('token-ben');
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await sweepIdleLive(server.live!, { now: () => now })).toMatchObject({ due: 1, failed: [], results: [{ committed: false, released: false, reason: 'uncommittable' }] });
    expect(commitsMade()).toEqual([]);
    expect(warned.mock.calls.flat().join('\n')).toMatch(/committed nothing/);
    expect((await server.live!.service.checkouts(repository)).map(row => row.path)).toEqual([note.path]);
    // Ben may write again: the next tick commits with his token, and Ann is still credited.
    revoked.delete('token-ben');
    now += 60_000;
    outbound.length = 0;
    expect(await sweepIdleLive(server.live!, { now: () => now })).toMatchObject({ due: 1, results: [{ committed: true, released: true }] });
    expect(fixture.text(note.path)).toBe(text);
    const [{ body: commit }] = commitsMade();
    expect(commit.author).toEqual({ name: 'ben', email: '102+ben@users.noreply.github.com' });
    expect(commit.message).toContain('Co-authored-by: ann <101+ann@users.noreply.github.com>');
    expect(outbound.filter(call => call.method !== 'GET').every(call => call.token === 'token-ben')).toBe(true);
  }, 30_000);

  it('closes its sockets and stops answering when it is told to stop', async () => {
    const server = await start();
    const ann = await signIn('ann');
    await post('/api/live/checkout', note, ann);
    const open = await tab(ann);
    await open.synced();
    await server.close();
    running = undefined;
    await expect(nativeFetch(`${base}/api/auth/session`)).rejects.toThrow();
  }, 30_000);
});
