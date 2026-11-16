import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import type { CommittedNotes, PublishingRequest, PublishingService, PublishSync } from '../src/publishing.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * Publication after the commits no commit route of the app makes (docs/specs/2026-11-16-sharing-public-collab S0): a
 * live check-in, a hosted MCP write and a tag commit. Each is published without holding its answer, so the tests wait
 * for the work the app handed to `defer`.
 */

let root: string, server: Server, base: string;
/** The work the app started without awaiting it. */
let deferred: Promise<unknown>[];
/** What the edition's publishing service heard: `sync` from a commit route, `syncCommitted` from every other commit. */
let synced: PublishingRequest[], committed: CommittedNotes[];
const service = (): PublishingService => ({ sync: async request => (synced.push(request), []), syncCommitted: async notes => (committed.push(notes), notes.notes.filter(note => note.metadata.publish).map((note): PublishSync => ({ path: note.path, url: `https://pages.example/${String(note.metadata.publish)}` }))) });
const settled = async () => {
  // Work may defer more work; wait until none is left.
  for (let seen = -1; seen !== deferred.length;) {
    seen = deferred.length;
    await Promise.all(deferred);
  }
};
const listen = async (app: ReturnType<typeof createApp>) => {
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
/** One MCP tool call with a grant: its structured result. */
const tool = async (token: string, name: string, args: object) => {
  const response = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const answer = await response.json();
  if (!answer.result || answer.result.isError) throw new Error(`MCP call ${name} failed: ${response.status} ${JSON.stringify(answer)}`);
  return answer.result.structuredContent as Record<string, unknown>;
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-publish-committed-')));
  deferred = [];
  synced = [];
  committed = [];
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a live check-in', () => {
  const manifest = 'schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
  const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
  const repository = sourceIdentity(notes);
  const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
  const secret = 'x'.repeat(40);
  const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
  const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
  const configSource: WorkspaceConfigSource = {
    mode: 'remote',
    settings: async () => {
      const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes]);
      return { ...settings, members: [{ ...settings.members[1], default: true }] };
    },
  };
  const published = '---\ntitle: A\npublish: a-page\n---\nGit body.\n';
  const typed = '---\ntitle: A\npublish: a-page\n---\nTyped live.\n';
  let store: RecordStore, files: MemoryFiles, liveNotes: MemoryLiveNotes;

  const start = (services: Record<string, unknown> = {}) => listen(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources: memoryEditionSources({ repositories: new Map([['p1/notes', files]]) }), liveNotes, defer: (work: Promise<unknown>) => void deferred.push(work), ...services }));
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = { 'x-person': 'p1' }) => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  /** Checks `notes/life/a.md` out and types `text` into it. */
  const edit = async (text: string) => {
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    liveNotes.type(repository, body.checkout.id, text, pat);
  };
  const checkIn = () => call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: 'notes/life/a.md' });

  beforeEach(() => {
    for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: secret, MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
    store = createRecordStore(root);
    files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', published], ['notes/life/b.md', '# B\n']]);
    liveNotes = memoryLiveNotes({ editor, repositories: [{ source: notes, files }] });
  });

  it('hands the committed text of a note marked publish: to syncCommitted, once', async () => {
    await start({ publishing: service() });
    await edit(typed);
    const answer = await checkIn();
    expect(answer).toMatchObject({ status: 200, body: { committed: true, released: true, path: 'notes/life/a.md' } });
    await settled();
    expect(committed).toHaveLength(1);
    expect(committed[0].notes).toEqual([{ path: 'notes/life/a.md', content: 'Typed live.\n', metadata: { title: 'A', publish: 'a-page' } }]);
    expect(committed[0].repository).toMatchObject({ kind: 'remote', id: repository, authenticated: true });
    // The service reads the repository as the commit left it.
    expect((await committed[0].repository.reader.readFile('notes/life/a.md')).toString('utf8')).toBe(typed);
    // A check-in is no commit route: `sync` hears nothing, and the answer carries nothing of the publication.
    expect(synced).toEqual([]);
    expect(answer.body.published).toBeUndefined();
    // The adapter the edition supplied is left as it was given.
    expect(Object.hasOwn(liveNotes, 'committed')).toBe(false);
  });

  it('publishes after a sweep too, which no request of a person stands behind', async () => {
    await start({ publishing: service() });
    await edit(typed);
    const swept = await call('POST', '/api/live/sweep?wait=1', undefined, { authorization: `Bearer ${secret}` });
    expect(swept).toMatchObject({ status: 200, body: { due: 1, failed: [] } });
    await settled();
    expect(committed.map(heard => heard.notes.map(note => [note.path, note.content]))).toEqual([[['notes/life/a.md', 'Typed live.\n']]]);
    expect(committed[0].person).toBeUndefined();
  });

  it('publishes nothing for a check-in that makes no commit', async () => {
    await start({ publishing: service() });
    await edit(published);
    expect(await checkIn()).toMatchObject({ status: 200, body: { committed: false, released: true } });
    await settled();
    expect(committed).toEqual([]);
  });

  it('calls nothing without a publishing service, or with one that has no syncCommitted', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start({ publishing: { sync: service().sync } });
    await edit(typed);
    expect(await checkIn()).toMatchObject({ status: 200, body: { committed: true, released: true } });
    await settled();
    expect(deferred).toEqual([]);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the check-in when the service fails, and logs the path without the note text', async () => {
    const logged: string[] = [];
    for (const level of ['warn', 'error', 'info', 'log'] as const) vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => void logged.push(parts.join(' ')));
    await start({
      publishing: {
        sync: service().sync,
        syncCommitted: async () => {
          throw new Error('could not render: Typed live.');
        },
      },
    });
    await edit(typed);
    expect(await checkIn()).toMatchObject({ status: 200, body: { committed: true, released: true } });
    await settled();
    expect(files.get('notes/life/a.md')).toBe(typed);
    expect(logged.filter(line => line.includes('notes/life/a.md'))).toHaveLength(1);
    expect(logged.join('\n')).not.toContain('Typed live');
  });

  it('logs a failure the service reports for a note, by its path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start({ publishing: { sync: service().sync, syncCommitted: async ({ notes }: CommittedNotes) => notes.map((note): PublishSync => ({ path: note.path, error: 'The address is already used.' })) } });
    await edit(typed);
    await checkIn();
    await settled();
    expect(warn.mock.calls.map(parts => parts.join(' '))).toEqual([`[publishing] ${repository}/notes/life/a.md: The address is already used.`]);
  });

  it('says in the log that the Gist of a checked-in note waits for the next commit in the app, as a check-in holds no GitHub token of a person', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const fetched = vi.spyOn(globalThis, 'fetch');
    files.set('notes/life/a.md', '---\ntitle: A\ngist: abc123\n---\nGit body.\n');
    await start();
    await edit('---\ntitle: A\ngist: abc123\n---\nTyped live.\n');
    fetched.mockClear();
    expect(await checkIn()).toMatchObject({ status: 200, body: { committed: true } });
    await settled();
    expect(info.mock.calls.map(parts => parts.join(' ')).filter(line => line.startsWith('[publishing]'))).toEqual([expect.stringContaining(`${repository}/notes/life/a.md`)]);
    expect(fetched.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/gists'))).toEqual([]);
  });

  it('hands a hosted MCP write to syncCommitted with the person of the grant, and a live write to nobody', async () => {
    await start({ publishing: service() });
    const token = (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;
    const read = await tool(token, 'read', { path: 'notes/life/b.md' });
    const written = await tool(token, 'write', { path: 'notes/life/b.md', content: '---\npublish: b-page\n---\nBy the agent.\n', revision: read.revision });
    expect(written).toMatchObject({ committed: true });
    expect(written.published).toBeUndefined();
    await settled();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ person: { realm: 'edition', userId: 'p1' }, repository: { kind: 'remote', id: repository }, notes: [{ path: 'notes/life/b.md', content: 'By the agent.\n', metadata: { publish: 'b-page' } }] });
    // A write to a checked-out note goes to the live editor: nothing is committed, so nothing is published until its check-in.
    await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    const live = await tool(token, 'read', { path: 'notes/life/a.md' });
    expect(await tool(token, 'write', { path: 'notes/life/a.md', content: typed, revision: live.revision })).toMatchObject({ committed: false, live: true });
    await settled();
    expect(committed).toHaveLength(1);
    expect(memoryCommits(files).filter(commit => commit.message !== 'Memory state')).toHaveLength(1);
  });
});

describe('on GitHub', () => {
  const manifest = 'schema_version: 1\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
  const files: Record<string, string> = { '.mygitnotes.yaml': manifest, 'notes/life/shared.md': '---\ntitle: Shared\ngist: abc123\ntags: [todo]\n---\n\nOld body\n', 'notes/life/private.md': '---\ntags: [todo]\n---\n# Private\n', 'notes/life/picks.compilation.yml': 'version: 1\nid: picks\ntitle: Picks\narrangement: lane\ntags: [todo]\nsource:\n  kind: tag\n  tag: todo\n' };
  const session = 'c'.repeat(43);
  const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
  const repository = 'github:owner/home@main';
  /** Gists the fake GitHub holds, by id; the Gist requests it received, each with the token it was sent. */
  let gists: Map<string, { description: string; public: boolean; files: Record<string, { content: string; }>; }>;
  let gistCalls: { method: string; endpoint: string; token: string | null; }[];

  const start = async (services: Record<string, unknown> = {}) => {
    await listen(createApp(root, { defer: (work: Promise<unknown>) => void deferred.push(work), ...services }));
    vi.stubEnv('APP_URL', base);
  };
  const call = (method: string, url: string, body?: object) => fetch(`${base}${url}`, { method, headers, body: body && JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
  const grant = async () => (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;

  beforeEach(async () => {
    gists = new Map([['abc123', { description: 'Shared', public: false, files: { 'shared.md': { content: 'Old body\n' } } }]]);
    gistCalls = [];
    for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '' })) vi.stubEnv(key, value);
    await createRecordStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1, login: 'owner' });
    const nativeFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'x-oauth-scopes': 'repo, gist' } });
      const gist = /^https:\/\/api\.github\.com\/gists(\/[^/?]+)?$/.exec(String(url));
      if (gist) {
        const method = init?.method || 'GET';
        gistCalls.push({ method, endpoint: gist[1] || '', token: new Headers(init?.headers).get('authorization') });
        const found = gists.get(gist[1]?.slice(1) ?? '');
        if (!found) return json({ message: 'Not Found' }, 404);
        if (method === 'PATCH') {
          const body = JSON.parse(String(init!.body)) as { description: string; files: Record<string, { filename: string; content: string; }>; };
          for (const [name, file] of Object.entries(body.files)) {
            delete found.files[name];
            found.files[file.filename] = { content: file.content };
          }
          found.description = body.description;
        }
        return json(found);
      }
      const match = /^https:\/\/api\.github\.com\/repos\/owner\/home(.*)$/.exec(String(url));
      if (!match) return nativeFetch(url, init);
      const endpoint = match[1];
      if (endpoint === '') return json({ id: 7, private: true, default_branch: 'main', permissions: { push: true } });
      if (endpoint.startsWith('/commits/')) return json({ sha: 'a'.repeat(40), commit: { tree: { sha: 'tree' } } });
      if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: `blob:${file}`, type: 'blob', mode: '100644', size: 10 })) });
      if (endpoint.startsWith('/git/blobs/')) return json({ encoding: 'base64', content: Buffer.from(files[decodeURIComponent(endpoint.slice('/git/blobs/blob:'.length))] ?? '').toString('base64') });
      if (endpoint === '/git/trees') return json({ sha: 'new-tree' });
      if (endpoint === '/git/commits') return json({ sha: 'd'.repeat(40) });
      if (endpoint.startsWith('/git/refs/')) return json({ object: { sha: 'd'.repeat(40) } });
      return json({});
    });
  });

  it('updates the Gist a note names after an MCP save_note, with the token of the grant', async () => {
    await start();
    const saved = await tool(await grant(), 'save_note', { path: 'notes/life/shared.md', content: 'By the agent\n', revision: 'a'.repeat(40) });
    expect(saved).toMatchObject({ committed: true, commit: { commitHash: 'd'.repeat(40) } });
    // The answer is the commit's own: the Gist is updated beside it.
    expect(saved.gists).toBeUndefined();
    await settled();
    expect(gists.get('abc123')).toEqual({ description: 'Shared', public: false, files: { 'shared.md': { content: 'By the agent\n' } } });
    expect(gistCalls.map(({ method, endpoint, token }) => [method, endpoint, token])).toEqual([['GET', '/abc123', 'Bearer fixture-owner'], ['PATCH', '/abc123', 'Bearer fixture-owner']]);
  });

  it('hands the note an MCP save_note committed to syncCommitted beside the Gist update', async () => {
    await start({ publishing: service() });
    await tool(await grant(), 'save_note', { path: 'notes/life/shared.md', content: 'By the agent\n', metadata: { publish: 'shared' }, revision: 'a'.repeat(40) });
    await settled();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ person: { realm: 'github:https://github.com:', userId: 1 }, repository: { kind: 'remote', id: repository, authenticated: true }, notes: [{ path: 'notes/life/shared.md', content: 'By the agent\n', metadata: { publish: 'shared' } }] });
    expect(gistCalls.map(({ method }) => method)).toEqual(['GET', 'PATCH']);
    expect(synced).toEqual([]);
  });

  it('calls no Gist and no service after an MCP write of a note that names no Gist', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await start();
    expect(await tool(await grant(), 'save_note', { path: 'notes/life/private.md', content: '# Private changed\n', revision: 'a'.repeat(40) })).toMatchObject({ committed: true });
    await settled();
    expect(deferred).toEqual([]);
    expect(gistCalls).toEqual([]);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the MCP commit and logs the path when the Gist cannot be updated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gists.clear();
    await start();
    expect(await tool(await grant(), 'save_note', { path: 'notes/life/shared.md', content: 'Secret body\n', revision: 'a'.repeat(40) })).toMatchObject({ committed: true });
    await settled();
    const lines = warn.mock.calls.map(parts => parts.join(' '));
    expect(lines).toEqual([expect.stringMatching(/^\[publishing\] github:owner\/home@main\/notes\/life\/shared\.md: .*404/)]);
    expect(lines.join('\n')).not.toContain('Secret body');
  });

  it('publishes the notes a tag commit rewrote, and answers as before', async () => {
    await start({ publishing: service() });
    const { status, body } = await call('POST', '/api/tags/apply', { repository, revision: 'a'.repeat(40), entries: [{ path: 'notes/life/shared.md', tags: ['kept'] }, { path: 'notes/life/picks.compilation.yml', tags: ['kept'] }] });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['branch', 'changedPaths', 'commit', 'committed', 'pushed', 'repository', 'revision', 'success']);
    expect(body.changedPaths).toEqual(['notes/life/picks.compilation.yml', 'notes/life/shared.md']);
    await settled();
    // The compilation is no note text: only the note is published.
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ person: { realm: 'github:https://github.com:', userId: 1 }, repository: { kind: 'remote', id: repository }, notes: [{ path: 'notes/life/shared.md', content: 'Old body\n', metadata: { title: 'Shared', gist: 'abc123', tags: ['kept'] } }] });
    expect(gistCalls.map(({ method, endpoint, token }) => [method, endpoint, token])).toEqual([['GET', '/abc123', 'Bearer fixture-owner'], ['PATCH', '/abc123', 'Bearer fixture-owner']]);
    expect(synced).toEqual([]);
  });

  it('calls nothing after a tag commit of notes that name no Gist, without a service', async () => {
    await start();
    const { status, body } = await call('POST', '/api/tags/apply', { repository, revision: 'a'.repeat(40), entries: [{ path: 'notes/life/private.md', tags: ['kept'] }] });
    expect(status).toBe(200);
    expect(body.changedPaths).toEqual(['notes/life/private.md']);
    await settled();
    expect(deferred).toEqual([]);
    expect(gistCalls).toEqual([]);
  });
});
