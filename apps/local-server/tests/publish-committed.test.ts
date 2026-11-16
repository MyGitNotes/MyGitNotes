import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { checkInLink, type EditionSourceConfig, gitBlobId, type LiveCommit, type LiveContext, parseWorkspaceConfig, sourceIdentity, withLiveCommits, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
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
    // The commit's revision comes along, so a service can drop a publication a later commit overtook.
    expect(committed[0].revision).toMatch(/^[0-9a-f]{40}$/);
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
          throw Object.assign(new Error('could not render: Typed live.'), { name: 'Leak Typed live' });
        },
      },
    });
    await edit(typed);
    expect(await checkIn()).toMatchObject({ status: 200, body: { committed: true, released: true } });
    await settled();
    expect(files.get('notes/life/a.md')).toBe(typed);
    expect(logged.filter(line => line.includes('notes/life/a.md'))).toEqual([`[publishing] ${repository}/notes/life/a.md: publishing failed (error)`]);
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
    expect(committed[0]).toMatchObject({ person: { realm: 'edition', userId: 'p1' }, repository: { kind: 'remote', id: repository }, revision: expect.stringMatching(/^[0-9a-f]{40}$/), notes: [{ path: 'notes/life/b.md', content: 'By the agent.\n', metadata: { publish: 'b-page' } }] });
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
  const initial: Record<string, string> = { '.mygitnotes.yaml': manifest, 'notes/life/shared.md': '---\ntitle: Shared\ngist: abc123\ntags: [todo]\n---\n\nOld body\n', 'notes/life/private.md': '---\ntags: [todo]\n---\n# Private\n', 'notes/life/picks.compilation.yml': 'version: 1\nid: picks\ntitle: Picks\narrangement: lane\ntags: [todo]\nsource:\n  kind: tag\n  tag: todo\n' };
  const session = 'c'.repeat(43);
  const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
  const repository = 'github:owner/home@main';
  /** Gists the fake GitHub holds, by id; the Gist requests it received, each with the token it was sent. */
  let gists: Map<string, { description: string; public: boolean; files: Record<string, { content: string; }>; }>;
  let gistCalls: { method: string; endpoint: string; token: string | null; }[];
  /** The files the fake GitHub serves at its head, which a commit moves. */
  let files: Record<string, string>;
  /** The fake GitHub's head commit, and the trees and commits made on it that no ref names yet. */
  let head: string, made: number;
  let trees: Map<string, Record<string, string>>, commits: Map<string, string>;

  const start = async (services: Record<string, unknown> = {}) => {
    await listen(createApp(root, { defer: (work: Promise<unknown>) => void deferred.push(work), ...services }));
    vi.stubEnv('APP_URL', base);
  };
  const call = (method: string, url: string, body?: object) => fetch(`${base}${url}`, { method, headers, body: body && JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
  const grant = async () => (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;

  beforeEach(async () => {
    gists = new Map([['abc123', { description: 'Shared', public: false, files: { 'shared.md': { content: 'Old body\n' } } }]]);
    gistCalls = [];
    files = { ...initial };
    head = 'a'.repeat(40);
    made = 0;
    trees = new Map();
    commits = new Map();
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
      // Commits apply: a written tree becomes the head's files once the ref moves to its commit.
      const blob = (file: string) => `${gitBlobId(Buffer.from(files[file]), 40)}`;
      if (endpoint.startsWith('/commits/')) return json({ sha: head, commit: { tree: { sha: `tree-${head}` } } });
      if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: blob(file), type: 'blob', mode: '100644', size: Buffer.byteLength(files[file]) })) });
      if (endpoint.startsWith('/git/blobs/')) {
        const sha = endpoint.slice('/git/blobs/'.length), file = Object.keys(files).find(name => blob(name) === sha);
        return file === undefined ? json({ message: 'Not Found' }, 404) : json({ encoding: 'base64', content: Buffer.from(files[file]).toString('base64') });
      }
      if (endpoint === '/git/trees') {
        const { tree } = JSON.parse(String(init!.body)) as { tree: { path: string; content?: string; sha?: string | null; }[]; };
        const next = { ...files };
        for (const entry of tree) {
          if (entry.content !== undefined) next[entry.path] = entry.content;
          else if (entry.sha === null) delete next[entry.path];
          else next[entry.path] = files[Object.keys(files).find(name => blob(name) === entry.sha)!];
        }
        const sha = `new-tree-${++made}`;
        trees.set(sha, next);
        return json({ sha });
      }
      if (endpoint === '/git/commits') {
        const sha = String(made).padStart(40, 'd');
        commits.set(sha, (JSON.parse(String(init!.body)) as { tree: string; }).tree);
        return json({ sha });
      }
      if (endpoint.startsWith('/git/refs/')) {
        const { sha } = JSON.parse(String(init!.body ?? '{}')) as { sha?: string; };
        if (sha && commits.has(sha)) {
          files = trees.get(commits.get(sha)!)!;
          head = sha;
        }
        return json({ object: { sha: head } });
      }
      return json({});
    });
  });

  it('pushes no Gist after an MCP save_note of a note that names one, and logs the path without the note text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await start();
    const saved = await tool(await grant(), 'save_note', { path: 'notes/life/shared.md', content: 'Secret body\n', revision: 'a'.repeat(40) });
    expect(saved).toMatchObject({ committed: true, commit: { commitHash: '1'.padStart(40, 'd') } });
    expect(saved.gists).toBeUndefined();
    await settled();
    expect(gistCalls).toEqual([]);
    expect(gists.get('abc123')!.files).toEqual({ 'shared.md': { content: 'Old body\n' } });
    const lines = info.mock.calls.map(parts => parts.join(' '));
    expect(lines).toEqual(['[publishing] github:owner/home@main/notes/life/shared.md: gist not updated by an agent write; updates on the next app commit']);
    expect(lines.join('\n')).not.toContain('Secret body');
  });

  it('hands the note an MCP save_note committed to syncCommitted, and pushes no Gist', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await start({ publishing: service() });
    await tool(await grant(), 'save_note', { path: 'notes/life/shared.md', content: 'By the agent\n', metadata: { publish: 'shared' }, revision: 'a'.repeat(40) });
    await settled();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ person: { realm: 'github:https://github.com:', userId: 1 }, repository: { kind: 'remote', id: repository, authenticated: true }, revision: '1'.padStart(40, 'd'), notes: [{ path: 'notes/life/shared.md', content: 'By the agent\n', metadata: { publish: 'shared' } }] });
    expect(gistCalls).toEqual([]);
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

  it('pushes no Gist an MCP write newly names, and still tells the service', async () => {
    gists.set('victim', { description: 'snippet.sh', public: true, files: { 'snippet.sh': { content: 'echo hi\n' } } });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await start({ publishing: service() });
    expect(await tool(await grant(), 'write', { path: 'notes/life/private.md', content: '---\ngist: victim\n---\nPRIVATE NOTE TEXT\n', revision: 'a'.repeat(40) })).toMatchObject({ committed: true });
    await settled();
    expect(gistCalls).toEqual([]);
    expect(gists.get('victim')!.files).toEqual({ 'snippet.sh': { content: 'echo hi\n' } });
    expect(info.mock.calls.map(parts => parts.join(' '))).toEqual(['[publishing] github:owner/home@main/notes/life/private.md: gist not updated by an agent write; updates on the next app commit']);
    expect(committed).toHaveLength(1);
  });

  it('pushes no Gist when one MCP write sets the mark and the next adds the text (s0rr-F001)', async () => {
    gists.set('victim', { description: 'snippet.sh', public: true, files: { 'snippet.sh': { content: 'echo hi\n' } } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await start();
    const token = await grant();
    const first = await tool(token, 'write', { path: 'notes/life/private.md', content: '---\ngist: victim\n---\nharmless\n', revision: 'a'.repeat(40) });
    expect(first).toMatchObject({ committed: true });
    await settled();
    expect(files['notes/life/private.md']).toBe('---\ngist: victim\n---\nharmless\n');
    const second = await tool(token, 'write', { path: 'notes/life/private.md', content: '---\ngist: victim\n---\nPRIVATE NOTE TEXT\n', revision: first.revision });
    expect(second).toMatchObject({ committed: true });
    await settled();
    expect(files['notes/life/private.md']).toBe('---\ngist: victim\n---\nPRIVATE NOTE TEXT\n');
    expect(gistCalls).toEqual([]);
    expect(gists.get('victim')!.files).toEqual({ 'snippet.sh': { content: 'echo hi\n' } });
  });

  it('publishes the notes a tag commit rewrote to the service, pushes no Gist as tags are not in one, and answers as before', async () => {
    await start({ publishing: service() });
    const { status, body } = await call('POST', '/api/tags/apply', { repository, revision: 'a'.repeat(40), entries: [{ path: 'notes/life/shared.md', tags: ['kept'] }, { path: 'notes/life/picks.compilation.yml', tags: ['kept'] }] });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['branch', 'changedPaths', 'commit', 'committed', 'pushed', 'repository', 'revision', 'success']);
    expect(body.changedPaths).toEqual(['notes/life/picks.compilation.yml', 'notes/life/shared.md']);
    await settled();
    // The compilation is no note text: only the note is published.
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ person: { realm: 'github:https://github.com:', userId: 1 }, repository: { kind: 'remote', id: repository }, revision: body.revision, notes: [{ path: 'notes/life/shared.md', content: 'Old body\n', metadata: { title: 'Shared', gist: 'abc123', tags: ['kept'] } }] });
    expect(gistCalls).toEqual([]);
    expect(synced).toEqual([]);
  });

  it('holds the answer of an MCP write until the service heard it where the deployment keeps no work alive after an answer', async () => {
    let heard = false;
    await start({ defer: undefined, publishing: { sync: async () => [], syncCommitted: async () => (await new Promise(resolve => setTimeout(resolve, 300)), heard = true, []) } });
    await tool(await grant(), 'save_note', { path: 'notes/life/private.md', content: 'By the agent\n', revision: 'a'.repeat(40) });
    expect(heard).toBe(true);
  });

  it('answers at once where the deployment keeps the work alive, and the service hears it after', async () => {
    let heard = false;
    await start({ publishing: { sync: async () => [], syncCommitted: async () => (await new Promise(resolve => setTimeout(resolve, 300)), heard = true, []) } });
    await tool(await grant(), 'save_note', { path: 'notes/life/private.md', content: 'By the agent\n', revision: 'a'.repeat(40) });
    expect(heard).toBe(false);
    await settled();
    expect(heard).toBe(true);
  });

  it('publishes no agent file or template an MCP write commits', async () => {
    files['notes/life/.templates/post.md'] = '---\ngist: abc123\npublish: post\n---\n# {{title}}\n';
    await start({ publishing: service() });
    expect(await tool(await grant(), 'write', { path: 'notes/life/.templates/post.md', content: '---\ngist: abc123\npublish: post\n---\n# {{title}} again\n', revision: 'a'.repeat(40) })).toMatchObject({ committed: true });
    await settled();
    expect(committed).toEqual([]);
    expect(gistCalls).toEqual([]);
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

describe('the check-in engine', () => {
  const manifest = 'schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
  const edition: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
  const repository = sourceIdentity(edition);
  const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
  let files: MemoryFiles, liveNotes: MemoryLiveNotes;
  const git = () => new MemoryEditionSource(edition, files, true, memoryCommitCounter(files), undefined, async () => parseWorkspaceConfig(manifest));
  const checkout = async () => {
    const content = files.get('notes/life/a.md')!;
    const { checkout: row } = await liveNotes.person(pat).checkout(repository, { notebook: 'notes~life', path: 'notes/life/a.md', base: { commit: (await git().getSnapshot(true)).sha, blob: gitBlobId(Buffer.from(content), 40), content } });
    return row.id;
  };
  const run = (adapter: Parameters<typeof checkInLink>[0], id: string) => checkInLink(adapter, repository, id, { mode: 'manual', sleep: async () => {} });

  beforeEach(() => {
    files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# Git\n']]);
    liveNotes = memoryLiveNotes({ editor: { origin: 'https://live.example.test', messageType: 'live-status' }, repositories: [{ source: edition, files }] });
  });

  it('tells the listener and the adapter of one commit when the head moved and the check-in committed again', async () => {
    const heard: LiveCommit[] = [], own: LiveCommit[] = [];
    liveNotes.committed = commit => void own.push(commit);
    const listening = withLiveCommits(liveNotes, commit => void heard.push(commit));
    const id = await checkout();
    liveNotes.type(repository, id, '# Typed\n', pat);
    const open = liveNotes.service.open.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'open').mockImplementationOnce(async (...args) => {
      const source = await open(...args);
      const read = source.getSnapshot.bind(source);
      source.getSnapshot = async fresh => {
        const snapshot = await read(fresh);
        // Someone commits another note between this check-in's read and its commit.
        const other = git(), head = await other.getSnapshot(true);
        await other.commitChanges([{ path: 'notes/life/other.md', content: '# Other\n' }], head.sha, 'write', 'notes', undefined, head);
        source.getSnapshot = read;
        return snapshot;
      };
      return source;
    });
    const result = await run(listening, id);
    expect(result).toMatchObject({ committed: true, released: true });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ repository, path: 'notes/life/a.md', content: '# Typed\n', commit: result.commit, author: { name: 'Pat', email: 'pat@example.test' } });
    expect((await heard[0].source.readFile('notes/life/a.md')).toString('utf8')).toBe('# Typed\n');
    expect(own).toEqual(heard);
  });

  it('checks the note in whatever a listener throws or rejects, logging the path and not the text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const thrown = () => {
      throw new Error('# Typed');
    };
    for (const listener of [thrown, async () => thrown()]) {
      files.set('notes/life/a.md', '# Git\n');
      const id = await checkout();
      liveNotes.type(repository, id, '# Typed\n', pat);
      expect(await run(withLiveCommits(liveNotes, listener), id)).toMatchObject({ committed: true, released: true });
    }
    await new Promise(resolve => setImmediate(resolve));
    const lines = warn.mock.calls.map(parts => parts.join(' '));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain(`${repository}/notes/life/a.md`);
      expect(line).not.toContain('Typed');
    }
  });
});
