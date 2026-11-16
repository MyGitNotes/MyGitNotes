import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { gitBlobId } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { createRecordStore } from '../src/record-store/index.js';

/*
 * An app commit route pushes a note to the Gist its frontmatter names only when the person meant it (todo #31): the
 * request confirms that Gist for that note, or the Gist's own description carries the marker that binds it to this
 * repository and path, which the app writes when it creates the Gist or the person confirms it. Otherwise the commit
 * stands, nothing is pushed, and the answer lists the note.
 */

const manifest = 'schema_version: 1\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n';
const SHARED = 'notes/life/shared.md', PRIVATE = 'notes/life/private.md';
const initial: Record<string, string> = { '.mygitnotes.yaml': manifest, [SHARED]: '---\ntitle: Shared\ngist: abc123\n---\n\nOld body\n', [PRIVATE]: '# Private\n' };
const session = 'c'.repeat(43);
const headers = { Cookie: `gh_notes_session=${session}`, 'Content-Type': 'application/json' };
const repository = 'github:owner/home@main';
const START = 'a'.repeat(40);

let root: string, server: Server, base: string;
let deferred: Promise<unknown>[];
/** Gists the fake GitHub holds, by id, and the Gist requests it received. */
let gists: Map<string, { description: string; public: boolean; files: Record<string, { content: string; }>; }>;
let gistCalls: { method: string; endpoint: string; }[];
/** Every repository request path the fake GitHub received. */
let repoCalls: string[];
/** The fake GitHub's commits by sha, each with its files, parent and message; and its branch head. */
let commits: Map<string, { files: Record<string, string>; parent?: string; message: string; }>;
let head: string, made: number;
let trees: Map<string, Record<string, string>>;
/** Whether the fake GitHub grants the person push, and whether its Gist reads fail. */
let canPush: boolean, gistDown: boolean;
/** The marker a Gist description carries once bound, after its title. */
const BOUND = /^(.*) (\[mgn:[0-9a-f]{8,}\])$/;
/** Measured cases take up to about 11 s, most of it the 1 s GitHubApi keeps between writes, whatever the load; each gets four times that. */
const TIMEOUT = 45_000;

const call = (method: string, url: string, body?: object) => fetch(`${base}${url}`, { method, headers, body: body && JSON.stringify(body) }).then(async response => ({ status: response.status, body: await response.json() }));
const commit = (notes: object[], revision: string, extra: object = {}) => call('POST', '/api/notes/commit', { repository, revision, message: 'docs: update', notes, ...extra });
const grant = async () => (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;
const tool = async (token: string, name: string, args: object) => {
  const response = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const answer = await response.json();
  if (!answer.result || answer.result.isError) throw new Error(`MCP call ${name} failed: ${response.status} ${JSON.stringify(answer)}`);
  return answer.result.structuredContent as Record<string, unknown> & { revision: string; };
};
const settled = async () => {
  for (let seen = -1; seen !== deferred.length;) {
    seen = deferred.length;
    await Promise.all(deferred);
  }
};
const patches = () => gistCalls.filter(entry => entry.method === 'PATCH').map(entry => entry.endpoint);
const historyCalls = () => repoCalls.filter(entry => entry.startsWith('/commits?'));

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-gist-confirm-')));
  deferred = [];
  gists = new Map([['abc123', { description: 'Shared', public: false, files: { 'shared.md': { content: 'Old body\n' } } }], ['victim', { description: 'snippet.sh', public: true, files: { 'snippet.sh': { content: 'echo hi\n' } } }]]);
  gistCalls = [];
  repoCalls = [];
  commits = new Map([[START, { files: { ...initial }, message: 'docs: start the notes' }]]);
  head = START;
  made = 0;
  trees = new Map();
  canPush = true;
  gistDown = false;
  for (const [key, value] of Object.entries({ MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/home', MYGITNOTES_BRANCH: 'main', SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: '', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '' })) vi.stubEnv(key, value);
  await createRecordStore(root).set(session, { kind: 'session', token: 'fixture-owner', userId: 1, login: 'owner' });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const nativeFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'x-oauth-scopes': 'repo, gist' } });
    const gist = /^https:\/\/api\.github\.com\/gists(\/[^/?]+)?$/.exec(String(url));
    if (gist) {
      const method = init?.method || 'GET';
      gistCalls.push({ method, endpoint: gist[1]?.slice(1) ?? '' });
      if (gistDown) return json({ message: 'Server Error' }, 502);
      if (method === 'POST' && !gist[1]) {
        const body = JSON.parse(String(init!.body)) as { description: string; public: boolean; files: Record<string, { content: string; }>; };
        const id = `created${gists.size}`;
        gists.set(id, body);
        return json({ id, html_url: `https://gist.github.com/${id}` });
      }
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
    repoCalls.push(endpoint);
    const files = commits.get(head)!.files;
    const blob = (text: string) => gitBlobId(Buffer.from(text), 40);
    if (endpoint === '') return json({ id: 7, private: true, default_branch: 'main', permissions: { push: canPush } });
    // The commits that changed a path, newest first, from the commit `sha` names back through its parents.
    if (endpoint.startsWith('/commits?')) {
      const query = new URLSearchParams(endpoint.slice('/commits?'.length));
      const file = query.get('path')!;
      const listed: unknown[] = [];
      for (let sha: string | undefined = query.get('sha')!; sha && listed.length < Number(query.get('per_page')); sha = commits.get(sha)!.parent) {
        const { files: at, parent, message } = commits.get(sha)!;
        if (at[file] !== (parent ? commits.get(parent)!.files[file] : undefined)) listed.push({ sha, parents: parent ? [{ sha: parent }] : [], commit: { message, author: { name: 'Owner', date: '2026-11-16T00:00:00Z' } } });
      }
      return json(listed);
    }
    if (endpoint.startsWith('/commits/')) return json({ sha: head, commit: { tree: { sha: `tree-${head}` } } });
    if (endpoint.startsWith('/contents/')) {
      const [file, query] = endpoint.slice('/contents/'.length).split('?');
      const text = commits.get(new URLSearchParams(query).get('ref')!)?.files[decodeURIComponent(file)];
      return text === undefined ? json({ message: 'Not Found' }, 404) : json({ type: 'file', sha: blob(text), size: Buffer.byteLength(text) });
    }
    if (endpoint.startsWith('/git/trees/')) return json({ truncated: false, tree: Object.keys(files).map(file => ({ path: file, sha: blob(files[file]), type: 'blob', mode: '100644', size: Buffer.byteLength(files[file]) })) });
    if (endpoint.startsWith('/git/blobs/')) {
      const sha = endpoint.slice('/git/blobs/'.length);
      const text = [...commits.values()].flatMap(entry => Object.values(entry.files)).find(value => blob(value) === sha);
      return text === undefined ? json({ message: 'Not Found' }, 404) : json({ encoding: 'base64', content: Buffer.from(text).toString('base64') });
    }
    if (endpoint === '/git/trees') {
      const { tree } = JSON.parse(String(init!.body)) as { tree: { path: string; content?: string; sha?: string | null; }[]; };
      const next = { ...files };
      for (const entry of tree) {
        if (entry.content !== undefined) next[entry.path] = entry.content;
        else if (entry.sha === null) delete next[entry.path];
        else next[entry.path] = Object.values(files).find(value => blob(value) === entry.sha)!;
      }
      const sha = `new-tree-${++made}`;
      trees.set(sha, next);
      return json({ sha });
    }
    if (endpoint === '/git/commits') {
      const body = JSON.parse(String(init!.body)) as { tree: string; message: string; parents: string[]; };
      const sha = String(made).padStart(40, 'd');
      commits.set(sha, { files: trees.get(body.tree)!, parent: body.parents[0], message: body.message });
      return json({ sha });
    }
    if (endpoint.startsWith('/git/refs/')) {
      const { sha } = JSON.parse(String(init!.body ?? '{}')) as { sha?: string; };
      if (sha && commits.has(sha)) head = sha;
      return json({ object: { sha: head } });
    }
    return json({});
  });
  server = createServer(createApp(root, { defer: (work: Promise<unknown>) => void deferred.push(work) }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  vi.stubEnv('APP_URL', base);
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A commit made outside the app, as on GitHub's web editor or with git: no Agent-Edit trailer. Answers its sha. */
const external = (files: Record<string, string>, message = 'Update notes') => {
  const sha = String(++made).padStart(40, 'e');
  commits.set(sha, { files: { ...commits.get(head)!.files, ...files }, parent: head, message });
  head = sha;
  return sha;
};
/** The person confirms the Gist `abc123` the shared note names on a commit; answers the Gist's marker. */
const bind = async () => {
  const { body } = await commit([{ path: SHARED, content: 'Bound body\n', metadata: { title: 'Shared', gist: 'abc123' } }], head, { confirmedGists: [{ path: SHARED, gist: 'abc123' }] });
  expect(body.gists).toEqual([{ path: SHARED, gist: 'abc123' }]);
  const description = gists.get('abc123')!.description;
  expect(description).toMatch(BOUND);
  return BOUND.exec(description)![2];
};

/** An agent's MCP write names the Gist `victim` in the private note; answers the head commit it made. */
const plant = async () => {
  const planted = await tool(await grant(), 'write', { path: PRIVATE, content: '---\ngist: victim\n---\nharmless\n', revision: START });
  await settled();
  expect(planted).toMatchObject({ committed: true });
  return head;
};

it('pushes no Gist an agent planted when the owner next commits the note, and lists the note to confirm', async () => {
  const revision = await plant();
  const { status, body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision);
  expect(status).toBe(200);
  expect(body).toMatchObject({ committed: true, revision: head });
  expect(commits.get(head)!.files[PRIVATE]).toContain('PRIVATE NOTE TEXT');
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(patches()).toEqual([]);
  expect(gists.get('victim')!.files).toEqual({ 'snippet.sh': { content: 'echo hi\n' } });
}, TIMEOUT);

it("pushes nothing when the person's next commit drops the Gist link they did not publish", async () => {
  const revision = await plant();
  const first = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision);
  expect(first.body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  // Don't publish staged the note without its `gist`; the person commits that draft.
  const { status, body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: {} }], head);
  expect(status).toBe(200);
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toBeUndefined();
  expect(commits.get(head)!.files[PRIVATE]).not.toContain('gist');
  // Later commits of the note have no Gist to push either.
  expect((await commit([{ path: PRIVATE, content: 'More text\n', metadata: {} }], head)).body.gists).toBeUndefined();
  expect(patches()).toEqual([]);
  expect(gists.get('victim')!.files).toEqual({ 'snippet.sh': { content: 'echo hi\n' } });
}, TIMEOUT);

// GC-F001: the person's own commit of a planted id is no consent; a decline lost with its draft, or made on another device, still asks.
it('keeps asking about a planted Gist the person declined, on the next commit from a client that remembers nothing', async () => {
  const revision = await plant();
  const first = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision);
  expect(first.body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  // The person declined, and the draft that dropped the link is gone: the next commit still names the planted id.
  const { status, body } = await commit([{ path: PRIVATE, content: 'MORE PRIVATE TEXT\n', metadata: { gist: 'victim' } }], head);
  expect(status).toBe(200);
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(patches()).toEqual([]);
  expect(gists.get('victim')!.files).toEqual({ 'snippet.sh': { content: 'echo hi\n' } });
  // No commit history is read to decide.
  expect(historyCalls()).toEqual([]);
}, TIMEOUT);

it('asks about a planted Gist after a commit made outside the app, such as an edit on GitHub', async () => {
  await plant();
  external({ [PRIVATE]: '---\ngist: victim\n---\nedited on GitHub\n' }, 'Update private.md');
  const { body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], head);
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(patches()).toEqual([]);
}, TIMEOUT);

it('pushes a Gist bound to the note without asking or reading history, keeping its marker under a new title', async () => {
  const marker = await bind();
  repoCalls.length = 0;
  gistCalls.length = 0;
  const { status, body } = await commit([{ path: SHARED, content: 'New body\n', metadata: { title: 'Shared again', gist: 'abc123' } }], head);
  expect(status).toBe(200);
  expect(body.gists).toEqual([{ path: SHARED, gist: 'abc123' }]);
  expect(body.gistsNeedConfirm).toBeUndefined();
  expect(gists.get('abc123')!.files).toEqual({ 'shared.md': { content: 'New body\n' } });
  expect(gists.get('abc123')!.description).toBe(`Shared again ${marker}`);
  // The Gist read that a push makes anyway decides; it comes before the push.
  expect(gistCalls).toEqual([{ method: 'GET', endpoint: 'abc123' }, { method: 'PATCH', endpoint: 'abc123' }]);
  expect(historyCalls()).toEqual([]);
}, TIMEOUT);

it('asks once about a Gist published before markers, and pushes without asking once Publish binds it', async () => {
  expect(gists.get('abc123')!.description).toBe('Shared');
  const asked = await commit([{ path: SHARED, content: 'New body\n', metadata: { title: 'Shared', gist: 'abc123' } }], START);
  expect(asked.body.gists).toBeUndefined();
  expect(asked.body.gistsNeedConfirm).toEqual([{ path: SHARED, gist: 'abc123' }]);
  expect(patches()).toEqual([]);
  const published = await call('POST', '/api/gists/sync', { repository, revision: asked.body.revision, notes: [{ path: SHARED, gist: 'abc123' }] });
  expect(published).toEqual({ status: 200, body: { gists: [{ path: SHARED, gist: 'abc123' }] } });
  expect(gists.get('abc123')!.description).toMatch(BOUND);
  expect(gists.get('abc123')!.files).toEqual({ 'shared.md': { content: 'New body\n' } });
  const next = await commit([{ path: SHARED, content: 'Newer body\n', metadata: { title: 'Shared', gist: 'abc123' } }], head);
  expect(next.body.gists).toEqual([{ path: SHARED, gist: 'abc123' }]);
  expect(next.body.gistsNeedConfirm).toBeUndefined();
  expect(gists.get('abc123')!.files).toEqual({ 'shared.md': { content: 'Newer body\n' } });
}, TIMEOUT);

it('asks again after a bound note moves, on every commit until the person binds the Gist to its new path', async () => {
  const marker = await bind();
  const MOVED = 'notes/life/moved.md';
  const moved = await commit([{ path: MOVED, content: 'Bound body\n', metadata: { title: 'Shared', gist: 'abc123' }, createOnly: true }, { path: SHARED, delete: true }], head);
  expect(moved.body.gistsNeedConfirm).toEqual([{ path: MOVED, gist: 'abc123' }]);
  // Declined, or confirmed on no device: the next commit of the moved note asks again.
  const again = await commit([{ path: MOVED, content: 'Moved body\n', metadata: { title: 'Shared', gist: 'abc123' } }], head);
  expect(again.body.gists).toBeUndefined();
  expect(again.body.gistsNeedConfirm).toEqual([{ path: MOVED, gist: 'abc123' }]);
  expect(patches()).toEqual(['abc123']);
  expect((await call('POST', '/api/gists/sync', { repository, revision: again.body.revision, notes: [{ path: MOVED, gist: 'abc123' }] })).status).toBe(200);
  const rebound = gists.get('abc123')!.description;
  expect(rebound).toMatch(BOUND);
  expect(BOUND.exec(rebound)![2]).not.toBe(marker);
  expect((await commit([{ path: MOVED, content: 'Moved again\n', metadata: { title: 'Shared', gist: 'abc123' } }], head)).body.gists).toEqual([{ path: MOVED, gist: 'abc123' }]);
}, TIMEOUT);

it('binds the Gist it creates to the note, with a marker that does not show the path', async () => {
  const created = await call('POST', '/api/gists', { repository, path: SHARED, content: 'Shared body\n', metadata: { title: 'Shared' } });
  expect(created.status).toBe(200);
  const description = gists.get(created.body.id)!.description;
  expect(description).toMatch(BOUND);
  expect(BOUND.exec(description)![1]).toBe('Shared');
  expect(description).not.toMatch(/notes|life|shared\.md/);
  // A later commit of the note naming the Gist, made anywhere, pushes without asking.
  external({ [SHARED]: `---\ntitle: Shared\ngist: ${created.body.id}\n---\n\nShared body\n` });
  const { body } = await commit([{ path: SHARED, content: 'Shared body, edited\n', metadata: { title: 'Shared', gist: created.body.id } }], head);
  expect(body.gists).toEqual([{ path: SHARED, gist: created.body.id }]);
  expect(body.gistsNeedConfirm).toBeUndefined();
}, TIMEOUT);

it('asks about a Gist bound to another note of the same repository', async () => {
  const created = await call('POST', '/api/gists', { repository, path: PRIVATE, content: 'Private body\n', metadata: { title: 'Private' } });
  expect(gists.get(created.body.id)!.description).toMatch(BOUND);
  external({ [SHARED]: `---\ntitle: Shared\ngist: ${created.body.id}\n---\n\nOld body\n` });
  const { body } = await commit([{ path: SHARED, content: 'Shared text\n', metadata: { title: 'Shared', gist: created.body.id } }], head);
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: SHARED, gist: created.body.id }]);
  expect(patches()).toEqual([]);
}, TIMEOUT);

// The marker is computable from the repository and path, and a note's title is text an agent can write.
it('writes no marker a note title carries into a Gist description', async () => {
  const bound = await call('POST', '/api/gists', { repository, path: PRIVATE, content: 'Private body\n', metadata: { title: 'Private' } });
  const marker = BOUND.exec(gists.get(bound.body.id)!.description)![2];
  // An older client creates the Gist without naming the repository, for a note whose title an agent set.
  const planted = await call('POST', '/api/gists', { path: SHARED, content: 'Shared body\n', metadata: { title: `Shared ${marker}` } });
  expect(gists.get(planted.body.id)!.description).toBe('Shared');
  const titled = await commit([{ path: SHARED, content: 'Shared body\n', metadata: { title: `Shared ${marker}`, gist: planted.body.id } }], START, { confirmedGists: [{ path: SHARED, gist: planted.body.id }] });
  expect(titled.body.gists).toEqual([{ path: SHARED, gist: planted.body.id }]);
  expect(gists.get(planted.body.id)!.description).not.toContain(marker);
  // The agent then names that Gist in the private note: the owner's next commit asks.
  external({ [PRIVATE]: `---\ngist: ${planted.body.id}\n---\nPRIVATE\n` });
  const { body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: planted.body.id } }], head);
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: planted.body.id }]);
  expect(gists.get(planted.body.id)!.files).toEqual({ 'shared.md': { content: 'Shared body\n' } });
}, TIMEOUT);

it('asks when the Gist cannot be read', async () => {
  await bind();
  gistDown = true;
  const { status, body } = await commit([{ path: SHARED, content: 'New body\n', metadata: { title: 'Shared', gist: 'abc123' } }], head);
  expect(status).toBe(200);
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: SHARED, gist: 'abc123' }]);
  expect(patches()).toEqual(['abc123']);
}, TIMEOUT);

it('asks first for a Gist id the parent did not name, as on a new note or a changed id', async () => {
  const { body } = await commit([{ path: 'notes/life/new.md', content: 'New note\n', metadata: { gist: 'victim' }, createOnly: true }, { path: SHARED, content: 'Moved\n', metadata: { gist: 'victim' } }], START);
  expect(body.gistsNeedConfirm).toEqual([{ path: 'notes/life/new.md', gist: 'victim' }, { path: SHARED, gist: 'victim' }]);
  expect(patches()).toEqual([]);
}, TIMEOUT);

it('pushes the Gist the request confirms for the note and binds it, so the next commit asks nothing', async () => {
  const revision = await plant();
  repoCalls.length = 0;
  const { body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision, { confirmedGists: [{ path: PRIVATE, gist: 'victim' }] });
  expect(body.gists).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(body.gistsNeedConfirm).toBeUndefined();
  expect(patches()).toEqual(['victim']);
  expect(gists.get('victim')!.description).toMatch(BOUND);
  expect(historyCalls()).toEqual([]);
  const next = await commit([{ path: PRIVATE, content: 'More text\n', metadata: { gist: 'victim' } }], head);
  expect(next.body.gists).toEqual([{ path: PRIVATE, gist: 'victim' }]);
}, TIMEOUT);

it('pushes nothing for a confirmation that names another Gist than the note does', async () => {
  const revision = await plant();
  const { body } = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision, { confirmedGists: [{ path: PRIVATE, gist: 'abc123' }, { path: SHARED, gist: 'victim' }] });
  expect(body.gists).toBeUndefined();
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(patches()).toEqual([]);
}, TIMEOUT);

it('holds the single-note save route to the same rule', async () => {
  const revision = await plant();
  const { status, body } = await call('POST', '/api/notes', { path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' }, revision });
  expect(status).toBe(200);
  expect(body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  expect(patches()).toEqual([]);
}, TIMEOUT);

it('publishes a note the person confirmed after its commit, from that commit, only to the Gist it names there', async () => {
  const revision = await plant();
  const committed = await commit([{ path: PRIVATE, content: 'PRIVATE NOTE TEXT\n', metadata: { gist: 'victim' } }], revision);
  expect(committed.body.gistsNeedConfirm).toEqual([{ path: PRIVATE, gist: 'victim' }]);
  const refused = await call('POST', '/api/gists/sync', { repository, revision: committed.body.revision, notes: [{ path: PRIVATE, gist: 'abc123' }] });
  expect(refused).toEqual({ status: 200, body: { gists: [{ path: PRIVATE, gist: 'abc123', error: expect.stringContaining('names another Gist') }] } });
  expect(patches()).toEqual([]);
  const confirmed = await call('POST', '/api/gists/sync', { repository, revision: committed.body.revision, notes: [{ path: PRIVATE, gist: 'victim' }] });
  expect(confirmed).toEqual({ status: 200, body: { gists: [{ path: PRIVATE, gist: 'victim' }] } });
  expect(gists.get('victim')!.files).toEqual({ 'private.md': { content: 'PRIVATE NOTE TEXT\n' } });
  expect(gists.get('victim')!.description).toMatch(BOUND);
  expect((await call('POST', '/api/gists/sync', { repository, revision: committed.body.revision, notes: [{ path: PRIVATE, gist: 'not an id' }] })).status).toBe(400);
}, TIMEOUT);

// GC-F002: Publish writes the binding, so it needs the write access a commit route needs.
it('refuses to publish a confirmed note of a repository the person cannot write', async () => {
  canPush = false;
  const refused = await call('POST', '/api/gists/sync', { repository, revision: START, notes: [{ path: SHARED, gist: 'abc123' }] });
  expect(refused.status).toBe(403);
  expect(gistCalls).toEqual([]);
  expect(gists.get('abc123')!.description).toBe('Shared');
}, TIMEOUT);
