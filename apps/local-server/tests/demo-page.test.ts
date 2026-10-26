import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import express, { Router } from 'express';
import { type EditionSourceConfig, repositoryRef, type WorkspaceConfigSource, type WorkspaceMember, type WorkspaceRequest, type WorkspaceSettings } from '@mygitnotes/core';
import { demoLanguage } from '@mygitnotes/core/demo';
import { createApp } from '../src/app.js';
import { demoPageCredentials, isDemoPage } from '../src/demo-page.js';
import type { EditionSources } from '../src/edition-sources.js';
import type { IdentityService } from '../src/identity.js';
import { MemoryEditionSource, type MemoryFiles } from '../src/memory-edition-source.js';
import { requestCookies, sessionCookie, storedSessions } from '../src/browser-sessions.js';
import { createRecordStore, random, type RecordStore } from '../src/record-store/index.js';

const manifest = (title: string) => `schema_version: 4\nworkspace:\n  title: ${title}\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const demoEdition: EditionSourceConfig = { type: 'edition', platform: 'demo', repository: 'scenarios', branch: 'main', label: 'Demo' };
const mineEdition: EditionSourceConfig = { type: 'edition', platform: 'mine', repository: 'notes', branch: 'main', label: 'Mine' };
const DEMO_REPOSITORY = 'edition:demo:scenarios@main';
const MINE_REPOSITORY = 'edition:mine:notes@main';
const PAGE = 'https://app.example/demo/trpg';
const BEARER = 'Bearer grant-alice';

let root: string, server: Server, base: string, store: RecordStore, demoFiles: MemoryFiles, mineFiles: MemoryFiles, commits: { count: number; }, providerRequests: string[];
const sessions = () => storedSessions(store);
const member = (edition: EditionSourceConfig, alias: string, demo: boolean): WorkspaceMember => ({ ref: repositoryRef(edition), alias, default: true, hidden: false, editable: 'none', ...(demo ? { demo: true as const } : {}) });

/** The person a request acts for: the session its cookie names, or the grant its Authorization header carries. */
const personOf = async (req: WorkspaceRequest) => {
  const session = await sessions().read(req);
  if (session?.kind === 'session') return { person: { realm: 'test', userId: session.userId as number }, login: session.login as string, owner: session.userId as number };
  return req.headers.authorization === BEARER ? { person: { realm: 'test', userId: 7 }, login: 'alice', owner: 7 } : null;
};

/** The edition's rule: a person gets their own repository and never the demo; a visitor with the demo cookie gets the demo; anyone else nothing. */
const settingsFor = async (req: WorkspaceRequest): Promise<WorkspaceSettings> => {
  const members = (await personOf(req)) ? [member(mineEdition, 'mine', false)] : demoLanguage(req) ? [member(demoEdition, 'demo', true)] : [];
  return { site: { type: 'github' }, members, manifest: (_member, inRepository) => inRepository() };
};
const configSource = (demo: boolean): WorkspaceConfigSource => ({ mode: 'remote', ...(demo ? { demo: true } : {}), settings: settingsFor });

const signInRoutes = Router();
// Starting a sign-in sets a cookie, as an OAuth start does.
signInRoutes.get('/start', async (_req, res) => {
  await sessions().beginSignIn(res, { realm: 'test', verifier: 'v' });
  res.redirect('/provider');
});
const identity: IdentityService = {
  router: signInRoutes,
  signedIn: async (req: WorkspaceRequest) => personOf(req),
  // A signed-in request's answer renews the session cookie, as a cookie session does when it refreshes.
  token: async (req, res) => {
    const id = requestCookies(req)[sessionCookie];
    if (id && await sessions().read(req)) res.cookie(sessionCookie, id, { path: '/', httpOnly: true });
    return undefined;
  },
  grantCredential: async () => undefined,
  grantToken: async () => undefined,
  noCredentialMessage: () => 'Sign in.',
  signInOptions: async () => [{ id: 'test', label: 'Test', url: '/api/auth/test' }],
  configured: async () => true,
  signOut: async (req, res) => sessions().clear(req, res),
};
/** Opens each edition repository for any request: the person's is writable, the demo's is not, as the edition's own rule would have it. */
const editionSources: EditionSources = { open: (source, _context, cache, scope) => new MemoryEditionSource(source, source.repository === 'scenarios' ? demoFiles : mineFiles, source.repository !== 'scenarios', commits, cache, scope) };

const cookieRoutes = (app: express.Express) => {
  app.get('/api/edition/echo', (req, res) => res.json({ cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null, rawHeaders: req.rawHeaders, demoPage: isDemoPage(req) }));
  app.get('/api/edition/set-cookie', (_req, res) => {
    res.cookie('edition', '1');
    res.json({});
  });
};

const start = async (demo: boolean) => {
  server = createServer(createApp(root, { configSource: configSource(demo), recordStore: store, sessions: sessions(), remoteCache: undefined, workspaceChoices: null, identity, editionSources, routes: cookieRoutes }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
interface Call {
  headers?: Record<string, string>;
  body?: unknown;
}
const call = async (method: string, url: string, { headers = {}, body }: Call = {}) => {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed, setCookie: response.headers.getSetCookie() };
};

/** A signed-in person's cookies, with the demo cookie the browser also holds. */
let signedIn: string;
const person = (extra = '') => `${signedIn}; mygitnotes_demo=en${extra}`;
const fromDemoPage = (cookie: string) => ({ headers: { Cookie: cookie, Referer: PAGE } });
const fromNotes = (cookie: string) => ({ headers: { Cookie: cookie, Referer: 'https://app.example/notes' } });

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-demo-page-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  demoFiles = new Map([['.mygitnotes.yaml', manifest('Demo')], ['notes/life/a.md', '# Demo note\n'], ['notes/life/pic.png', 'png']]);
  mineFiles = new Map([['.mygitnotes.yaml', manifest('Mine')], ['notes/life/a.md', '# My note\n'], ['notes/life/pic.png', 'png']]);
  commits = { count: 0 };
  providerRequests = [];
  const id = random();
  await store.set(id, { kind: 'session', realm: 'test', login: 'alice', userId: 7 }, 3600);
  signedIn = `${sessionCookie}=${id}`;
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

describe('a signed-in browser on a demo page', () => {
  it('is answered the demo repository only, and the probe says it is no one, on a demo page', async () => {
    await start(true);
    const workspace = await call('GET', '/api/workspace', fromDemoPage(person()));
    expect(workspace.status).toBe(200);
    expect(workspace.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([DEMO_REPOSITORY]);
    expect(workspace.body.repositories[0]).toMatchObject({ demo: true, write: false });
    const probe = await call('GET', '/api/auth/session', fromDemoPage(person()));
    expect(probe.body).toMatchObject({ authenticated: false, demo: true, demoPage: true });
    expect(probe.body).not.toHaveProperty('login');
    expect(providerRequests).toEqual([]);
  });

  it('is answered its own repository without the Referer, or from any other page of the app', async () => {
    await start(true);
    for (const options of [{ headers: { Cookie: person() } }, fromNotes(person()), { headers: { Cookie: person(), Referer: 'https://app.example/' } }, { headers: { Cookie: person(), Referer: 'https://app.example/demonstration' } }]) {
      const workspace = await call('GET', '/api/workspace', options);
      expect(workspace.body.repositories.map((repository: { id: string; }) => repository.id), JSON.stringify(options.headers)).toEqual([MINE_REPOSITORY]);
      const probe = await call('GET', '/api/auth/session', options);
      expect(probe.body).toMatchObject({ authenticated: true, login: 'alice', demo: true });
      expect(probe.body).not.toHaveProperty('demoPage');
    }
  });

  it('reads the demo notes and no note of the person', async () => {
    await start(true);
    const workspace = await call('GET', '/api/workspace', fromDemoPage(person()));
    const notebook = workspace.body.repositories[0].notebooks[0];
    const notes = await call('GET', `/api/notes?notebookId=${encodeURIComponent(notebook)}`, fromDemoPage(person()));
    expect(notes.status).toBe(200);
    expect(JSON.stringify(notes.body)).toContain('notes/life/a.md');
    const query = await call('GET', `/api/notes/query?notebookId=${encodeURIComponent(notebook)}&content=1`, fromDemoPage(person()));
    expect(JSON.stringify(query.body)).toContain('Demo note');
    expect(JSON.stringify(query.body)).not.toContain('My note');
  });

  it('is refused every write, and nothing is written', async () => {
    await start(true);
    // The control: the same request without the Referer is the person's own, and commits.
    const own = await call('GET', '/api/workspace', { headers: { Cookie: person() } });
    const mine = own.body.repositories[0];
    const committed = await call('POST', '/api/notes/commit', { headers: { Cookie: person() }, body: { repository: MINE_REPOSITORY, revision: mine.revision, message: 'edit', notes: [{ path: 'notes/life/a.md', content: '# Mine, changed\n', metadata: {} }] } });
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(commits.count).toBe(1);

    const demo = await call('GET', '/api/workspace', fromDemoPage(person()));
    const { revision, notebooks } = demo.body.repositories[0];
    const before = JSON.stringify([[...demoFiles], [...mineFiles]]);
    expect(before).toContain('# Mine, changed');
    const as = (extra: Call) => ({ ...fromDemoPage(person()), ...extra });
    const attempts = [call('POST', '/api/notes/commit', as({ body: { repository: DEMO_REPOSITORY, revision, message: 'edit', notes: [{ path: 'notes/life/a.md', content: '# Changed\n', metadata: {} }] } })), call('POST', '/api/notes/commit', as({ body: { repository: MINE_REPOSITORY, revision: mine.revision, message: 'edit', notes: [{ path: 'notes/life/a.md', content: '# Mine, changed again\n', metadata: {} }] } })), call('POST', '/api/notes', as({ body: { notebookId: notebooks[0], title: 'New', content: 'x' } })), call('POST', '/api/tags/apply', as({ body: { notebookId: notebooks[0], operation: { kind: 'rename', from: 'a', to: 'b' } } })), call('PUT', '/api/workspace/config', as({ body: { repository: DEMO_REPOSITORY, configYaml: manifest('Hacked'), configRevision: '' } })), call('PUT', '/api/workspace/config', as({ body: { repository: MINE_REPOSITORY, configYaml: manifest('Hacked'), configRevision: '' } })), call('PUT', '/api/focus-page', as({ body: { repository: DEMO_REPOSITORY, page: { version: 2, focuses: [] }, revision } })), call('POST', '/api/agent-resources/save', as({ body: { repository: DEMO_REPOSITORY, path: 'x', content: 'x' } })), call('POST', '/api/files', as({ body: { revision, command: { kind: 'move', notebookId: notebooks[0], path: 'notes/life/a.md', destination: 'notes/life/b.md' } } })), call('POST', '/api/versions', as({ body: { notebookId: notebooks[0], path: 'notes/life/a.md', action: 'create', commit: revision, name: 'v1' } })), call('POST', '/api/workspace/members', as({ body: { repository: MINE_REPOSITORY } }))];
    const results = await Promise.all(attempts);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBeGreaterThanOrEqual(400);
    for (const result of results) expect(result.status, JSON.stringify(result.body)).toBeLessThan(500);
    expect(JSON.stringify([[...demoFiles], [...mineFiles]])).toBe(before);
    expect(commits.count).toBe(1);
    expect(providerRequests).toEqual([]);
  });

  it('is sent no Set-Cookie by any answer, where the same request from another page is', async () => {
    await start(true);
    const asks: [string, string][] = [['GET', '/api/auth/session'], ['GET', '/api/workspace'], ['GET', '/api/notes/query?limit=5'], ['GET', '/raw-assets/notes/life/pic.png?notebook=demo~life'], ['GET', '/api/edition/set-cookie'], ['GET', '/api/nothing-here'], ['GET', '/']];
    for (const [method, url] of asks) {
      const demoPage = await call(method, url, fromDemoPage(person()));
      expect(demoPage.setCookie, `${url} from a demo page`).toEqual([]);
    }
    // The controls: the session probe renews the cookie and the edition route sets one, when the page is not a demo page.
    expect((await call('GET', '/api/auth/session', fromNotes(person()))).setCookie.join('\n')).toContain(sessionCookie);
    expect((await call('GET', '/api/edition/set-cookie', fromNotes(person()))).setCookie.join('\n')).toContain('edition=1');
  });

  it('serves an asset of the demo repository to the demo page', async () => {
    await start(true);
    const asset = await call('GET', '/raw-assets/notes/life/pic.png?notebook=demo~life', fromDemoPage(person()));
    expect(asset.status).toBe(200);
    expect(asset.body).toEqual({ text: 'png' });
  });

  it('cannot sign in or out from a demo page, and the session still stands afterwards', async () => {
    await start(true);
    const refused = await Promise.all([call('POST', '/api/auth/logout', fromDemoPage(person())), call('GET', '/api/auth/start', fromDemoPage(person())), call('GET', '/api/auth/test', fromDemoPage(person())), call('POST', '/api/auth/agent-token', fromDemoPage(person())), call('GET', '/api/auth/agent-tokens', fromDemoPage(person())), call('POST', '/API/AUTH/LOGOUT', fromDemoPage(person())), call('DELETE', '/api/auth/session', fromDemoPage(person())), call('POST', '/api/auth/session', fromDemoPage(person())), call('POST', '/api/auth/logout', fromDemoPage(''))]);
    for (const result of refused) {
      expect(result.status).toBe(403);
      expect(result.body).toMatchObject({ code: 'demo-page' });
      expect(result.setCookie).toEqual([]);
    }
    // The control: from the app itself, logout clears the cookie.
    const stillSignedIn = await call('GET', '/api/auth/session', { headers: { Cookie: signedIn } });
    expect(stillSignedIn.body).toMatchObject({ authenticated: true, login: 'alice' });
    const own = await call('POST', '/api/auth/logout', fromNotes(person()));
    expect(own.status).toBe(200);
    expect(own.setCookie.join('\n')).toContain(`${sessionCookie}=;`);
    expect((await call('GET', '/api/auth/session', { headers: { Cookie: signedIn } })).body).toMatchObject({ authenticated: false });
  });

  it('starts an OAuth sign-in from the app, which a demo page cannot', async () => {
    await start(true);
    const own = await call('GET', '/api/auth/start', fromNotes(person()));
    expect(own.status).toBe(302);
    expect(own.setCookie.length).toBeGreaterThan(0);
    const demoPage = await call('GET', '/api/auth/start', fromDemoPage(person()));
    expect(demoPage.status).toBe(403);
    expect(demoPage.setCookie).toEqual([]);
  });

  it('has its Authorization header and every cookie but the demo cookie removed before any route reads them', async () => {
    await start(true);
    const headers = { Cookie: `other=1; ${signedIn}; mygitnotes_demo=zh-tw; edition_session=secret`, Authorization: BEARER, Referer: PAGE };
    const echoed = (await call('GET', '/api/edition/echo', { headers })).body;
    expect(echoed).toMatchObject({ cookie: 'mygitnotes_demo=zh-tw', authorization: null, demoPage: true });
    expect(JSON.stringify(echoed.rawHeaders)).not.toMatch(/secret|grant-alice|gh_notes_session|other=1/);
    // The control: the same headers from another page arrive whole.
    const whole = (await call('GET', '/api/edition/echo', { headers: { ...headers, Referer: 'https://app.example/notes' } })).body;
    expect(whole).toMatchObject({ cookie: headers.Cookie, authorization: BEARER, demoPage: false });
  });

  it('ignores an Authorization grant on /api from a demo page', async () => {
    await start(true);
    const grant = { Authorization: BEARER, Cookie: 'mygitnotes_demo=en' };
    const own = await call('GET', '/api/workspace', { headers: grant });
    expect(own.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([MINE_REPOSITORY]);
    const demoPage = await call('GET', '/api/workspace', { headers: { ...grant, Referer: PAGE } });
    expect(demoPage.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([DEMO_REPOSITORY]);
    expect((await call('GET', '/api/auth/session', { headers: { ...grant, Referer: PAGE } })).body).toMatchObject({ authenticated: false });
    const noCookie = await call('GET', '/api/workspace', { headers: { Authorization: BEARER, Referer: PAGE } });
    expect(noCookie.body.repositories).toEqual([]);
  });

  it('keeps the demo language the cookie names', async () => {
    await start(true);
    const answer = await call('GET', '/api/edition/echo', { headers: { Cookie: `${signedIn}; mygitnotes_demo=ZH-TW`, Referer: PAGE } });
    expect(answer.body.cookie).toBe('mygitnotes_demo=zh-tw');
  });
});

describe('a visitor who is not signed in on a demo page', () => {
  it('still gets the demo with the demo cookie, and an empty workspace without it', async () => {
    await start(true);
    const withCookie = await call('GET', '/api/workspace', { headers: { Cookie: 'mygitnotes_demo=en', Referer: PAGE } });
    expect(withCookie.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([DEMO_REPOSITORY]);
    expect((await call('GET', '/api/auth/session', { headers: { Cookie: 'mygitnotes_demo=en', Referer: PAGE } })).body).toMatchObject({ authenticated: false, demo: true, demoPage: true });
    const without = await call('GET', '/api/workspace', { headers: { Referer: PAGE } });
    expect(without.status).toBe(200);
    expect(without.body.repositories).toEqual([]);
    const unmarked = await call('GET', '/api/workspace', { headers: { Cookie: 'mygitnotes_demo=en' } });
    expect(unmarked.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([DEMO_REPOSITORY]);
  });
});

describe('a deployment without a demo', () => {
  it('does not look at the Referer at all', async () => {
    await start(false);
    const workspace = await call('GET', '/api/workspace', fromDemoPage(person()));
    expect(workspace.body.repositories.map((repository: { id: string; }) => repository.id)).toEqual([MINE_REPOSITORY]);
    const probe = await call('GET', '/api/auth/session', fromDemoPage(person()));
    expect(probe.body).toMatchObject({ authenticated: true, login: 'alice' });
    expect(probe.body).not.toHaveProperty('demo');
    expect(probe.body).not.toHaveProperty('demoPage');
    expect(probe.setCookie.join('\n')).toContain(sessionCookie);
    const echoed = (await call('GET', '/api/edition/echo', { headers: { Cookie: person(), Authorization: BEARER, Referer: PAGE } })).body;
    expect(echoed).toMatchObject({ cookie: person(), authorization: BEARER, demoPage: false });
    const out = await call('POST', '/api/auth/logout', fromDemoPage(person()));
    expect(out.status).toBe(200);
  });
});

describe('demoPageCredentials', () => {
  let bare: Server, bareBase: string;
  const mount = async (...handlers: express.RequestHandler[]) => {
    const app = express();
    // Node takes a list of pairs only while no header is set yet, and Express sets this one.
    app.disable('x-powered-by');
    app.use(...handlers);
    app.get('/echo', (req, res) => res.json({ cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null, marked: isDemoPage(req) }));
    app.get('/set-header', (_req, res) => {
      res.setHeader('Set-Cookie', ['a=1', 'b=2']);
      res.json({});
    });
    app.get('/append', (_req, res) => {
      res.append('Set-Cookie', 'a=1');
      res.json({});
    });
    app.get('/clear', (_req, res) => {
      res.clearCookie('gh_notes_session');
      res.json({});
    });
    app.get('/redirect', (_req, res) => {
      res.cookie('a', '1');
      res.redirect('/echo');
    });
    app.get('/write-head', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': ['a=1', 'b=2'] });
      res.end('{}');
    });
    app.get('/write-head-message', (_req, res) => {
      res.writeHead(200, 'Fine', { 'Set-Cookie': 'a=1', 'X-Kept': 'yes' });
      res.end('{}');
    });
    app.get('/write-head-flat', (_req, res) => {
      res.writeHead(200, ['Set-Cookie', 'a=1', 'Content-Type', 'application/json', 'SET-COOKIE', 'b=2', 'X-Kept', 'yes']);
      res.end('{}');
    });
    app.get('/write-head-pairs', (_req, res) => {
      res.writeHead(200, [['Set-Cookie', 'a=1'], ['Content-Type', 'application/json'], ['set-cookie', 'b=2'], ['X-Kept', 'yes']] as never);
      res.end('{}');
    });
    app.get('/write-head-after-set', (_req, res) => {
      res.cookie('early', '1');
      res.writeHead(200, { 'Set-Cookie': 'late=1', 'X-Kept': 'yes' });
      res.end('{}');
    });
    app.get('/stream', (_req, res) => {
      res.cookie('a', '1');
      res.flushHeaders();
      res.write('x');
      res.end('y');
    });
    app.get('/send-file', (_req, res) => {
      res.cookie('a', '1');
      res.sendFile(path.join(root, 'file.txt'));
    });
    app.get('/error', () => {
      throw new Error('boom');
    });
    bare = createServer(app);
    await new Promise<void>(resolve => bare.listen(0, '127.0.0.1', resolve));
    bareBase = `http://127.0.0.1:${(bare.address() as { port: number; }).port}`;
  };
  const get = async (url: string, headers: Record<string, string> = {}) => {
    const response = await fetch(bareBase + url, { redirect: 'manual', headers });
    return { response, setCookie: response.headers.getSetCookie(), text: await response.text() };
  };
  beforeEach(() => fs.writeFileSync(path.join(root, 'file.txt'), 'file'));
  afterEach(async () => {
    await new Promise<void>(resolve => bare.close(() => resolve()));
  });

  it('keeps only the demo cookie and drops Authorization from a demo page, and leaves every other request alone', async () => {
    await mount(demoPageCredentials());
    const headers = { Cookie: 'a=1; gh_notes_session=abc; mygitnotes_demo=en; b=2', Authorization: 'Bearer x' };
    expect(JSON.parse((await get('/echo', { ...headers, Referer: PAGE })).text)).toEqual({ cookie: 'mygitnotes_demo=en', authorization: null, marked: true });
    expect(JSON.parse((await get('/echo', { ...headers, Referer: 'https://app.example/' })).text)).toEqual({ cookie: headers.Cookie, authorization: 'Bearer x', marked: false });
    expect(JSON.parse((await get('/echo', headers)).text)).toEqual({ cookie: headers.Cookie, authorization: 'Bearer x', marked: false });
  });

  it('keeps no cookie at all when the demo cookie is missing or not a language', async () => {
    await mount(demoPageCredentials());
    for (const cookie of ['gh_notes_session=abc', 'mygitnotes_demo=fr; gh_notes_session=abc', 'xmygitnotes_demo=en', 'mygitnotes_demo=']) {
      expect(JSON.parse((await get('/echo', { Cookie: cookie, Referer: PAGE })).text).cookie, cookie).toBeNull();
    }
  });

  it('reads the first demo cookie, as the server reads it, and passes only that one on', async () => {
    await mount(demoPageCredentials());
    expect(JSON.parse((await get('/echo', { Cookie: 'mygitnotes_demo=zh-tw; mygitnotes_demo=en', Referer: PAGE })).text).cookie).toBe('mygitnotes_demo=zh-tw');
    expect(JSON.parse((await get('/echo', { Cookie: 'mygitnotes_demo=fr; mygitnotes_demo=en', Referer: PAGE })).text).cookie).toBeNull();
  });

  it('is idempotent when an edition mounts it ahead of the app’s own', async () => {
    await mount(demoPageCredentials(), demoPageCredentials());
    expect(JSON.parse((await get('/echo', { Cookie: 'x=1; mygitnotes_demo=en', Authorization: 'Bearer x', Referer: PAGE })).text)).toEqual({ cookie: 'mygitnotes_demo=en', authorization: null, marked: true });
  });

  it.each(['/echo', '/set-header', '/append', '/clear', '/redirect', '/write-head', '/write-head-message', '/write-head-flat', '/write-head-pairs', '/write-head-after-set', '/stream', '/send-file', '/error', '/missing'])('writes no Set-Cookie on %s, however the route sets it', async url => {
    await mount(demoPageCredentials());
    const demoPage = await get(url, { Referer: PAGE });
    expect(demoPage.setCookie, url).toEqual([]);
    expect(demoPage.response.headers.get('set-cookie')).toBeNull();
    // The control: the same route sets one for any other page, so the test would fail were the routes silent.
    if (!['/echo', '/error', '/missing'].includes(url)) expect((await get(url)).setCookie.length, `${url} sets a cookie`).toBeGreaterThan(0);
  });

  it.each(['/write-head-message', '/write-head-flat', '/write-head-pairs', '/write-head-after-set'])('keeps the status, the body and the other headers of %s', async url => {
    await mount(demoPageCredentials());
    const answer = await get(url, { Referer: PAGE });
    expect(answer.response.status).toBe(200);
    expect(answer.response.headers.get('x-kept')).toBe('yes');
    expect(answer.text).toBe('{}');
  });

  it('answers an error as it does for any other page', async () => {
    await mount(demoPageCredentials());
    expect((await get('/error', { Referer: PAGE })).response.status).toBe(500);
  });
});

describe('the server’s sources', () => {
  it('read no raw header, so the headers the middleware rewrites are the only copy a route can see', () => {
    const sources = fs.readdirSync(path.join(import.meta.dirname, '../src')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    const reading = sources.filter(name => /rawHeaders|headersDistinct/.test(fs.readFileSync(path.join(import.meta.dirname, '../src', name), 'utf8')));
    expect(reading).toEqual(['demo-page.ts']);
  });
});
