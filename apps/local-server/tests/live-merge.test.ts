import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, LIVE_MAX_BYTES, type LiveContext, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { type BuiltinFixture, builtinFixture, shutdownFixtures } from '../src/live-builtin/test-fixture.js';
import { memoryCommits, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import * as Y from 'yjs';
import { workspaceSettings } from './workspace-settings.js';

/*
 * `POST /api/live/merge` (docs/specs/2026-11-16-collab-first-self-host A4, slice S3): a text written on a base the
 * writer names, such as a draft made offline, is merged into the live note, which is checked out first when it is not live.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n    templates:\n      - id: registered\n        title: Registered\n        file: kept/registered.md\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const repository = sourceIdentity(notes);
const frame = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const gitA = '---\ntitle: A\n---\none\ntwo\nthree\n';
const file = 'notes/life/a.md';
const note = { notebookId: 'notes~life', path: file };
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const person = (n: number): LiveContext => ({ person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` }, request: { headers: {} } });
/** `x-person` names who is signed in: p1 and p3 write, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: `Person ${req.headers['x-person'].slice(1)}`, email: `${req.headers['x-person']}@example.test` } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles;

const start = async (liveNotes: unknown) => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']])]]), mayWrite: who => who.userId !== 'p2' });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes: liveNotes as MemoryLiveNotes }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, who: string | null = 'p1') => {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: (response.headers.get('content-type') ?? '').includes('application/json') && text ? JSON.parse(text) : null };
};
const merge = (body: Record<string, unknown>, who: string | null = 'p1') => call('POST', '/api/live/merge', { ...note, base: gitA, mergeId: 'draft-0001', ...body }, who);
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-merge-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], [file, gitA], ['notes/life/plan.outline.md', '# Plan\n'], ['notes/life/kept/registered.md', '# {{title}}\n']]);
  server = undefined;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await shutdownFixtures();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/live/merge over an adapter that merges', () => {
  let liveNotes: MemoryLiveNotes;
  beforeEach(async () => {
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], merge: true });
    await start(liveNotes);
  });
  const liveText = async () => {
    const [row] = await liveNotes.service.checkouts(repository);
    return row ? (await liveNotes.person(person(1)).read(repository, row.id)).content : undefined;
  };

  it('refuses anyone who may not write live, a repository without an editor, and notes that keep the direct editor, and checks nothing out for them', async () => {
    const text = gitA.replace('two', 'TWO');
    const refused = [[{}, null, 403], [{}, 'p2', 403], [{ notebookId: 'other~life', path: 'notes/life/z.md' }, 'p1', 400], [{ path: 'notes/life/plan.outline.md' }, 'p1', 400], [{ path: 'notes/life/kept/registered.md' }, 'p1', 400], [{ path: 'notes/life/missing.md' }, 'p1', 404]] as const;
    for (const [body, who, status] of refused) expect((await merge({ text, ...body }, who)).status, JSON.stringify([body, who])).toBe(status);
    expect((await merge({ text, notebookId: 'other~life', path: 'notes/life/z.md' })).body).toMatchObject({ code: 'not-live' });
    expect((await merge({ text, path: 'notes/life/plan.outline.md' })).body).toMatchObject({ code: 'not-live' });
    expect(await liveNotes.service.repositories()).toEqual([]);
    expect(commits()).toEqual([]);
  });

  it('refuses a request without a base, a text or a merge id of 8 to 128 URL-safe characters, and a text past the limit, before it checks anything out', async () => {
    const text = gitA.replace('two', 'TWO');
    for (const body of [{ base: undefined }, { base: 7 }, { text: undefined }, { text: ['x'] }, { mergeId: undefined }, { mergeId: 'short' }, { mergeId: 'x'.repeat(129) }, { mergeId: 'has space in it' }, { mergeId: 7 }]) expect((await merge({ text, ...body })).status, JSON.stringify(body)).toBe(400);
    const large = await merge({ text: 'x'.repeat(LIVE_MAX_BYTES + 1) });
    expect(large).toMatchObject({ status: 413, body: { code: 'too-large' } });
    expect((await merge({ text, base: 'x'.repeat(LIVE_MAX_BYTES + 1) })).status).toBe(413);
    expect(await liveNotes.service.repositories()).toEqual([]);
  });

  it('checks a note that is not live out first, merges the text in, and answers the link it is now', async () => {
    const answer = await merge({ text: gitA.replace('two', 'TWO') });
    expect(answer).toEqual({ status: 200, body: { applied: true, contentHash: sha256(gitA.replace('two', 'TWO')), outcome: 'created', checkout: { id: 'live-1', notebookId: 'notes~life', path: file, pending: false, editorUrl: 'https://live.example.test/n/live-1', embedUrl: 'https://live.example.test/n/live-1?embed=1', since: expect.any(String), activeEditors: 0, conflict: null } } });
    expect(await liveText()).toBe(gitA.replace('two', 'TWO'));
    // Nothing is committed by a merge: the text is live, and a check-in commits it in the writer's name.
    expect(files.get(file)).toBe(gitA);
    expect(commits()).toEqual([]);
    expect(await call('POST', '/api/live/checkin', note)).toMatchObject({ status: 200, body: { committed: true, released: true } });
    expect(files.get(file)).toBe(gitA.replace('two', 'TWO'));
    expect(commits()[0].author).toEqual({ name: 'Person 1', email: 'p1@example.test' });
  });

  it('joins a note that is live and keeps what people typed in it since the base', async () => {
    const { id } = (await call('POST', '/api/live/checkout', note, 'p3')).body.checkout;
    liveNotes.type(repository, id, `${gitA}four\n`, person(3));
    const answer = await merge({ text: gitA.replace('one', 'ONE') });
    expect(answer).toMatchObject({ status: 200, body: { applied: true, contentHash: sha256(`${gitA.replace('one', 'ONE')}four\n`), outcome: 'joined', checkout: { id } } });
    expect(await liveText()).toBe(`${gitA.replace('one', 'ONE')}four\n`);
  });

  it('answers 409 merge-conflict for a text that changed what the live note changed too, and leaves the live note as it was', async () => {
    const { id } = (await call('POST', '/api/live/checkout', note, 'p3')).body.checkout;
    liveNotes.type(repository, id, gitA.replace('two', 'xxx'), person(3));
    const answer = await merge({ text: gitA.replace('two', 'yyy') });
    expect(answer).toMatchObject({ status: 409, body: { code: 'merge-conflict', error: expect.any(String), checkout: { id, path: file } } });
    expect(await liveText()).toBe(gitA.replace('two', 'xxx'));
  });

  it('answers a repeated merge id with the first answer and takes its text once, also after the note was checked in', async () => {
    const request = { text: `${gitA}mine\n`, mergeId: 'draft-repeat-1' };
    const first = await merge(request);
    expect(first).toMatchObject({ status: 200, body: { applied: true, contentHash: sha256(`${gitA}mine\n`) } });
    liveNotes.type(repository, first.body.checkout.id, `${gitA}mine\nmore\n`, person(3));
    const again = await merge(request);
    expect(again).toMatchObject({ status: 200, body: { applied: true, contentHash: first.body.contentHash, outcome: 'joined' } });
    expect(await liveText()).toBe(`${gitA}mine\nmore\n`);
    expect(await call('POST', '/api/live/checkin', note)).toMatchObject({ status: 200, body: { committed: true, released: true } });
    // The answer never arrived, the note was checked in meanwhile, and the request comes again: Git holds its text once.
    expect(await merge(request)).toMatchObject({ status: 200, body: { applied: true, contentHash: first.body.contentHash, outcome: 'reopened' } });
    expect(await liveText()).toBe(`${gitA}mine\nmore\n`);
    expect(files.get(file)).toBe(`${gitA}mine\nmore\n`);
  });

  it('merges into a note not yet filed by its virtual path, and answers 404 for one that is gone', async () => {
    const made = await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' });
    const pending = made.body.checkout;
    const read = await liveNotes.person(person(1)).read(repository, pending.id);
    const answer = await merge({ path: pending.path, base: read.content, text: `${read.content}offline line\n` });
    expect(answer).toMatchObject({ status: 200, body: { applied: true, outcome: 'joined', checkout: { id: pending.id, pending: true, path: pending.path } } });
    expect((await liveNotes.person(person(1)).read(repository, pending.id)).content).toBe(`${read.content}offline line\n`);
    expect((await merge({ path: 'notes/life/.live/live-99.md', text: 'x' })).status).toBe(404);
  });

  it('says in the workspace that the repository merges', async () => {
    expect((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([{ ...frame, merge: true }, null]);
  });
});

describe('POST /api/live/merge over an adapter without merge', () => {
  it('answers 400 not-live, checks nothing out, and leaves the workspace answer as it was', async () => {
    const liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] });
    await start(liveNotes);
    expect(await merge({ text: gitA.replace('two', 'TWO') })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect(await liveNotes.service.repositories()).toEqual([]);
    expect(JSON.stringify((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live))).toBe(JSON.stringify([frame, null]));
  });
});

describe('POST /api/live/merge over the built-in editor', () => {
  let live: BuiltinFixture;
  beforeEach(async () => {
    live = builtinFixture({ files });
    await start(live.liveNotes);
  });

  it('merges through the document, records the writer as an editor with the person they signed in as, and says so in the workspace', async () => {
    expect((await call('GET', '/api/workspace')).body.repositories[0].live).toEqual({ kind: 'builtin', discard: true, retarget: true, merge: true });
    const { id } = (await call('POST', '/api/live/checkout', note, 'p3')).body.checkout;
    await live.liveNotes.type(repository, id, `${gitA}four\n`, person(3));
    live.time.advance(1000);
    const answer = await merge({ text: gitA.replace('one', 'ONE') });
    const merged = `${gitA.replace('one', 'ONE')}four\n`;
    expect(answer).toMatchObject({ status: 200, body: { applied: true, contentHash: sha256(merged), outcome: 'joined', checkout: { id, editorUrl: 'http://localhost/notebooks/notes~life/notes/a.md' } } });
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(merged);
    expect((await live.store.editors(id)).map(editor => [editor.key, editor.person])).toEqual([['person:p3@example.test', { realm: 'edition', userId: 'p3' }], ['person:p1@example.test', { realm: 'edition', userId: 'p1' }]]);
    // The same request again, through a second process on the same store: the first answer, and one copy.
    const seq = (await live.store.link(id))!.seq;
    const second = builtinFixture({ store: live.store, files, time: live.time });
    expect(await second.liveNotes.person(person(1)).merge!(repository, id, { base: gitA, text: gitA.replace('one', 'ONE'), mergeId: 'draft-0001' })).toEqual({ applied: true, contentHash: sha256(merged) });
    expect((await live.store.link(id))!.seq).toBe(seq);
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(merged);
  });

  it('takes the document a tab typed in and its update, in base64, so what the server stored of its typing lands once; refuses a malformed one', async () => {
    const { id } = (await call('POST', '/api/live/checkout', note)).body.checkout;
    const link = (await live.store.link(id))!;
    const held = await live.documents.open(link);
    const tab = new Y.Doc();
    Y.applyUpdate(tab, Y.encodeStateAsUpdate(held.document));
    const updates: Uint8Array[] = [];
    tab.on('update', (update: Uint8Array) => void updates.push(update));
    const text = tab.getText('content');
    // The server takes the tab's typing, and the acknowledgement never reaches the tab, which types on offline.
    text.insert(text.length, 'stored ');
    await live.documents.accept(link, updates[0], { key: 'person:p1@example.test', name: 'Person 1', email: 'p1@example.test', agent: false });
    await held.close();
    text.insert(text.length, 'kept\n');
    expect(await call('POST', '/api/live/checkin', note)).toMatchObject({ status: 200, body: { committed: true, released: true } });
    expect(files.get(file)).toBe(`${gitA}stored `);
    const typedIn = { document: `${id}.1`, update: Buffer.from(Y.encodeStateAsUpdate(tab)).toString('base64') };
    for (const bad of [{ document: 7, update: typedIn.update }, { document: typedIn.document, update: 'not base64!' }, { document: 'x', update: typedIn.update }, 'x']) expect((await merge({ base: '', text: text.toString(), mergeId: 'kept-bad-0001', typedIn: bad })).status, JSON.stringify(bad)).toBe(400);
    // The tab's first acknowledgement never came either: the base it names is empty.
    expect(await merge({ base: '', text: text.toString(), mergeId: 'kept-0001', typedIn })).toMatchObject({ status: 200, body: { applied: true, outcome: 'reopened' } });
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(`${gitA}stored kept\n`);
  });

  it('answers a conflict with nothing appended, and forgets a merge answer after 24 hours', async () => {
    const { id } = (await call('POST', '/api/live/checkout', note, 'p3')).body.checkout;
    await live.liveNotes.type(repository, id, gitA.replace('two', 'xxx'), person(3));
    const seq = (await live.store.link(id))!.seq;
    expect(await merge({ text: gitA.replace('two', 'yyy'), mergeId: 'draft-conflict' })).toMatchObject({ status: 409, body: { code: 'merge-conflict' } });
    expect((await live.store.link(id))!.seq).toBe(seq);
    expect((await live.store.editors(id)).map(editor => editor.key)).toEqual(['person:p3@example.test']);
    const request = { base: gitA.replace('two', 'xxx'), text: `${gitA.replace('two', 'xxx')}mine\n`, mergeId: 'draft-expiring' };
    expect((await merge(request)).status).toBe(200);
    live.time.advance(24 * 3600_000 - 1000);
    expect((await merge(request)).status).toBe(200);
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(`${gitA.replace('two', 'xxx')}mine\n`);
    live.time.advance(2000);
    // Past a day the id is as new: the same text on the same base merges again, and finds its lines there already.
    expect((await merge(request)).status).toBe(200);
    expect((await live.liveNotes.person(person(1)).read(repository, id)).content).toBe(`${gitA.replace('two', 'xxx')}mine\n`);
  });
});
