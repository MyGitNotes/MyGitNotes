import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { checkInLink, type EditionSourceConfig, type LiveContext, type LiveEditorInfo, LiveStaleError, LiveUnavailableError, parseWorkspaceConfig, RemoteSource, sourceIdentity, StaleRevisionError, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveClock, memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { liveEditorRef } from '../src/live-builtin/adapter.js';
import { type BuiltinFixture, builtinFixture, shutdownFixtures } from '../src/live-builtin/test-fixture.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * Moving a filed live note (編輯中) while it is edited (docs/specs/2026-11-15-builtin-live-editor §20.4): the move records
 * where the note goes (its target) and commits nothing, unless nobody else is editing it, when it is checked in at once;
 * the next check-in commits the move as one commit with every link rewritten. A note keeps working in every open editor.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const repository = sourceIdentity(notes);
const builtin: LiveEditorInfo = { kind: 'builtin' };
const frame: LiveEditorInfo = { origin: 'https://live.example.test', messageType: 'live-status' };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
const sam: LiveContext = { person: { realm: 'edition', userId: 'p3' }, author: { name: 'Sam', email: 'sam@example.test' }, request: { headers: {} } };
const weekly = 'notes/life/會議/2026-11-17 公司週會.md';
const archived = 'notes/life/archive/2026-11-17 公司週會.md';
const index = 'notes/life/index.md';

/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes]);
    return { ...settings, members: [{ ...settings.members[1], default: true }] };
  },
};

let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, liveNotes: MemoryLiveNotes, clock: MemoryLiveClock;
/** Past the memory adapter's lease, which a failed call leaves held (it has no `unlease`). */
const leaseRunsOut = () => clock.advance(5 * 60_000 + 1);
const start = async (live: unknown = liveNotes) => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files]]), mayWrite: who => who.userId !== 'p2' });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes: live as MemoryLiveNotes }));
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, who: string | null = 'p1') => {
  const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text && (response.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : null };
};
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const scope = async () => parseWorkspaceConfig(manifest);
/** A commit someone makes in Git directly. */
const gitCommit = async (file: string, content: string) => {
  const source = new MemoryEditionSource(notes, files, true, memoryCommitCounter(files), undefined, scope);
  const snapshot = await source.getSnapshot(true);
  return (await source.commitChanges([{ path: file, content }], snapshot.sha, 'write', 'notes', undefined, snapshot)).revision;
};
/** A deletion someone makes in Git directly. */
const gitDelete = async (file: string) => {
  const source = new MemoryEditionSource(notes, files, true, memoryCommitCounter(files), undefined, scope);
  const snapshot = await source.getSnapshot(true);
  return (await source.commitChanges([{ path: file, sha: null }], snapshot.sha, 'delete', 'notes', undefined, snapshot)).revision;
};
const checkout = (file: string) => call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: file });
const open = async (file: string) => (await checkout(file)).body.checkout.id as string;
const move = (from: string, destination: string, extra: Record<string, unknown> = {}, who: string | null = 'p1') => call('POST', '/api/files', { command: { kind: 'move', notebookId: 'notes~life', path: from, destination, ...(extra.title ? { title: extra.title } : {}) }, ...(extra.editing ? { editing: true } : {}) }, who);
const checkIn = (file: string) => call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: file });
const read = (file: string) => call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(file)}`);
const listed = async () => ((await call('GET', '/api/notes?notebookId=notes~life')).body.notes as { path: string; live?: Record<string, unknown>; }[]).map(note => note.path).sort();
const rows = () => liveNotes.service.checkouts(repository);
/** The texts the check-in merges into the live note from now on, by either merge call. */
const recordMerges = () => {
  const merged: string[] = [];
  const mergeIn = liveNotes.service.mergeIn.bind(liveNotes.service), once = liveNotes.service.mergeInOnce!.bind(liveNotes.service);
  vi.spyOn(liveNotes.service, 'mergeIn').mockImplementation(async (...args) => {
    merged.push(args[3].content);
    return mergeIn(...args);
  });
  vi.spyOn(liveNotes.service, 'mergeInOnce').mockImplementation(async (...args) => {
    merged.push(args[3].content);
    return once(...args);
  });
  return merged;
};
const make = (editor: LiveEditorInfo = builtin, retarget = true) => memoryLiveNotes({ editor, repositories: [{ source: notes, files }], clock: clock = memoryLiveClock(), discard: true, retarget });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-move-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_LIVE_IDLE_CHECKIN: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], [weekly, '---\ntitle: 公司週會\n---\n議程\n'], [index, '# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n'], ['notes/life/archive/old.md', '# Old\n'], ['notes/life/會議/other.md', '# Other\n']]);
  liveNotes = make();
  server = undefined;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await shutdownFixtures();
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('moving a live note someone else edits', () => {
  it('records where it moves, commits nothing, and shows it there while every editor keeps working', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const moved = await move(weekly, archived);
    expect(moved).toMatchObject({ status: 200, body: { selectedPath: archived, pathMap: { [weekly]: archived }, live: { path: weekly, target: archived } } });
    expect(moved.body.live.checkIn).toBeUndefined();
    expect(commits()).toEqual([]);
    expect(await rows()).toMatchObject([{ id, path: weekly, target: archived }]);
    // The lists show the note where it goes, and say where it lies now; the old path leads there.
    expect(await listed()).toEqual([archived, 'notes/life/archive/old.md', index, 'notes/life/會議/other.md'].sort());
    expect((await read(archived)).body.note).toMatchObject({ path: archived, live: { movingFrom: weekly } });
    expect(await read(weekly)).toMatchObject({ status: 404, body: { movedTo: archived } });
    // Either path opens the same live note, and typing goes on.
    expect(await checkout(archived)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id, path: archived } } });
    expect(await checkout(weekly)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id, path: archived } } });
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n', sam);
    expect((await read(archived)).body.note.content).toBe('議程\n續寫\n');
    // A Git write to the old path is still refused while the note is live.
    expect(await call('POST', '/api/files', { command: { kind: 'delete', notebookId: 'notes~life', path: weekly }, revision: (await call('GET', '/api/files?notebookId=notes~life')).body.revision })).toMatchObject({ status: 409, body: { code: 'checked-out' } });
  });

  it('commits the move at the next check-in as one commit, rewriting the links to it, and the note then lies there', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n', sam);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true, released: true, moved: { from: weekly } } });
    expect(commits().map(commit => commit.paths)).toEqual([[archived, index, weekly].sort()]);
    expect(commits()[0].message).toMatch(/Live-Link: /);
    expect(files.has(weekly)).toBe(false);
    expect(files.get(archived)).toBe('---\ntitle: 公司週會\n---\n議程\n續寫\n');
    expect(decodeURIComponent(files.get(index)!)).toContain('](archive/2026-11-17 公司週會.md)');
    expect(await rows()).toEqual([]);
    expect(await read(archived)).toMatchObject({ status: 200, body: { note: { path: archived } } });
  });

  it('moves a note nobody else edits at once: the mover alone, or nobody at all, checks it in at its new path', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n改了\n', pat);
    const moved = await move(weekly, archived);
    expect(moved).toMatchObject({ status: 200, body: { selectedPath: archived, live: { path: archived, target: null, checkIn: { committed: true, released: true, path: archived } } } });
    expect(moved.body.revision).toBe(moved.body.live.checkIn.revision);
    expect(commits().map(commit => commit.paths)).toEqual([[archived, index, weekly].sort()]);
    expect(files.get(archived)).toBe('---\ntitle: 公司週會\n---\n議程\n改了\n');
    // Moved from its own editor (`editing`), the one person active is the mover: it lands now and stays open for them.
    const other = await open('notes/life/會議/other.md');
    liveNotes.setActive(repository, other, 1);
    expect(await move('notes/life/會議/other.md', 'notes/life/archive/other.md', { editing: true })).toMatchObject({ status: 200, body: { live: { path: 'notes/life/archive/other.md', target: null, checkIn: { committed: true, released: false, reason: 'active' } } } });
    expect(files.has('notes/life/archive/other.md')).toBe(true);
    expect(await rows()).toMatchObject([{ id: other, path: 'notes/life/archive/other.md' }]);
    expect((await rows())[0]).not.toHaveProperty('target');
  });

  it('credits the commit of a move that lands at once to the person who moved it, and whoever typed as co-authors', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\nSam 寫的\n', sam);
    expect(await move(weekly, archived)).toMatchObject({ status: 200, body: { live: { checkIn: { committed: true } } } });
    expect(commits()).toHaveLength(1);
    expect(commits()[0].author).toEqual({ name: 'Pat', email: 'pat@example.test' });
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Sam <sam@example.test>']);
  });

  it('credits a move that waits for a later check-in to its mover, a co-author of the commit that moves it (FCP-F003)', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    expect(commits()).toEqual([]);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\nSam 寫的\n', sam);
    liveNotes.setActive(repository, id, 0);
    // A scheduled check-in, which nobody asked for: whoever typed last authors it, and the mover is credited.
    expect(await checkInLink(liveNotes, repository, id, { mode: 'scheduled' })).toMatchObject({ committed: true });
    expect(commits()).toHaveLength(1);
    expect(commits()[0].paths).toContain(archived);
    expect(commits()[0].author).toEqual({ name: 'Sam', email: 'sam@example.test' });
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Pat <pat@example.test>']);
  });

  it('does not list the mover again when they author the later check-in that moves the note', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\nSam 寫的\n', sam);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { committed: true } });
    expect(commits()[0].author).toEqual({ name: 'Pat', email: 'pat@example.test' });
    expect(commits()[0].message.split('\n').filter(line => line.startsWith('Co-authored-by:'))).toEqual(['Co-authored-by: Sam <sam@example.test>']);
  });

  it('retitles the live text with a rename, without a check-in while others edit', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 2);
    const renamed = 'notes/life/會議/2026-11-17 全員週會.md';
    expect(await move(weekly, renamed, { title: '全員週會', editing: true })).toMatchObject({ status: 200, body: { live: { target: renamed } } });
    expect(commits()).toEqual([]);
    expect((await liveNotes.person(pat).read(repository, id)).content).toContain('title: 全員週會');
  });

  it('leads every path the note was read at while live to where it is now, until Git holds a file there', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    const again = 'notes/life/archive/週會.md';
    await move(archived, again);
    // A tab still at the first target finds the note at the second, and joins the same live note there.
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: again } });
    expect(await checkout(archived)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id, path: again } } });
    // Moved back where it lies, both targets lead there.
    await move(again, weekly);
    expect(await read(again)).toMatchObject({ status: 404, body: { movedTo: weekly } });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: weekly } });
    expect(await checkout(again)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id, path: weekly } } });
    expect(commits()).toEqual([]);
    // A move checked in at once leaves its old path behind: a tab there finds the note at its new path, still live.
    const other = 'notes/life/會議/other.md', otherMoved = 'notes/life/archive/other.md';
    const second = await open(other);
    liveNotes.setActive(repository, second, 1);
    expect(await move(other, otherMoved, { editing: true })).toMatchObject({ status: 200, body: { live: { path: otherMoved, checkIn: { committed: true, released: false } } } });
    expect(await read(other)).toMatchObject({ status: 404, body: { movedTo: otherMoved } });
    expect(await checkout(other)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id: second, path: otherMoved } } });
    // A file Git gets at a path the note was read at is that file's: it is read there, not led away.
    await gitCommit(archived, '# Archived\n');
    expect(await read(archived)).toMatchObject({ status: 200, body: { note: { path: archived, title: 'Archived' } } });
    expect(await read(again)).toMatchObject({ status: 404, body: { movedTo: weekly } });
  });

  it('keeps leading a path a note left while live to where it was filed once it is checked in and released, until Git holds a file there (fix5 P2-2)', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    const again = 'notes/life/archive/週會.md';
    await move(archived, again);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(again)).toMatchObject({ status: 200, body: { committed: true, released: true, path: again } });
    expect(await rows()).toEqual([]);
    // No longer live, the note still leads a background tab at either path to where it lies in Git.
    expect(await read(weekly)).toMatchObject({ status: 404, body: { movedTo: again } });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: again } });
    // Opened again, it is the same note there, and the old paths lead to it still.
    expect(await checkout(again)).toMatchObject({ status: 200, body: { outcome: 'reopened', checkout: { id, path: again } } });
    expect(await read(weekly)).toMatchObject({ status: 404, body: { movedTo: again } });
    // A file Git gets at a path it left is that file's.
    await gitCommit(weekly, '# New weekly\n');
    expect(await read(weekly)).toMatchObject({ status: 200, body: { note: { path: weekly, title: 'New weekly' } } });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: again } });
    // That file deleted in Git later, the path no longer leads to the note that left it before the file was there (FLM-F004).
    await gitDelete(weekly);
    expect((await read(weekly)).body).not.toHaveProperty('movedTo');
    expect(await checkout(weekly)).toMatchObject({ status: 404 });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: again } });
  });

  it('leads a path two notes left in turn to the one that left it last, live or not (review3 F002)', async () => {
    await start();
    const other = 'notes/life/會議/other.md', parked = 'notes/life/parked.md';
    const first = await open(weekly);
    liveNotes.setActive(repository, first, 1);
    await move(weekly, archived);
    const second = await open(other);
    liveNotes.setActive(repository, second, 1);
    // The second note goes where the first went, and then leaves it: the path is a former path of both.
    await move(weekly, 'notes/life/archive/週會.md');
    await move(other, archived);
    await move(archived, parked);
    expect((await rows()).map(row => row.formerPaths)).toEqual([[archived], [archived]]);
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: parked } });
    expect(await checkout(archived)).toMatchObject({ status: 200, body: { checkout: { id: second } } });
    // Released, the second still counts over the first, which left the path earlier.
    liveNotes.setActive(repository, second, 0);
    expect(await checkIn(parked)).toMatchObject({ status: 200, body: { released: true, path: parked } });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: parked } });
  });

  it('refuses a destination Git holds or another live note goes to, with 409, and records nothing', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    expect(await move(weekly, 'notes/life/archive/old.md')).toMatchObject({ status: 409, body: { error: 'Destination already exists.' } });
    const other = await open('notes/life/會議/other.md');
    liveNotes.setActive(repository, other, 1);
    await move('notes/life/會議/other.md', 'notes/life/archive/next.md');
    expect(await move(weekly, 'notes/life/archive/next.md')).toMatchObject({ status: 409 });
    expect((await rows()).find(row => row.id === id)).not.toHaveProperty('target');
    expect(commits()).toEqual([]);
  });

  it('keeps the note in place, never overwriting, when its target exists by the check-in, and says so on its row', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    await gitCommit(archived, '# Someone else\n');
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n', sam);
    // The editor stays active, so the manual check-in retries its release with real waits (about 9 s): bounded at about 4x (LM-F004).
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: weekly, committed: true, unmoved: archived } });
    expect(files.get(archived)).toBe('# Someone else\n');
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程\n續寫\n');
    expect(await rows()).toMatchObject([{ id, path: weekly, unmoved: archived }]);
    expect((await rows())[0]).not.toHaveProperty('unmovedReason');
    expect((await read(weekly)).body.note.live).toMatchObject({ unmoved: archived });
  }, 40_000);

  it('replaces the target with a second move, and a move back to where it lies clears it', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    const again = 'notes/life/archive/週會.md';
    expect(await move(archived, again)).toMatchObject({ status: 200, body: { pathMap: { [archived]: again }, live: { path: weekly, target: again } } });
    expect(await rows()).toMatchObject([{ id, path: weekly, target: again }]);
    expect(await move(again, weekly)).toMatchObject({ status: 200, body: { live: { path: weekly, target: null } } });
    expect((await rows())[0]).not.toHaveProperty('target');
    expect(await listed()).toContain(weekly);
    expect(commits()).toEqual([]);
  });

  it('moves a folder now and its live note at its check-in, every link right at each step', async () => {
    const pastWeekly = 'notes/life/past/2026-11-17 公司週會.md';
    files.set(weekly, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    files.set('notes/life/會議/other.md', '# Other\n\n[w](2026-11-17%20公司週會.md)\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const moved = await move('notes/life/會議', 'notes/life/past');
    expect(moved).toMatchObject({ status: 200, body: { pathMap: { 'notes/life/會議/other.md': 'notes/life/past/other.md', [weekly]: pastWeekly } } });
    expect(moved.body.liveLeft).toBeUndefined();
    // The links to the live note keep its Git path, where it still lies; its check-in moves it and rewrites them (LM-F006).
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/past/other.md', 'notes/life/會議/other.md'].sort()]);
    expect(files.get(index)).toBe('# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n');
    expect(decodeURIComponent(files.get('notes/life/past/other.md')!)).toContain('](../會議/2026-11-17 公司週會.md)');
    // Its own link to a note the folder took along follows that note at once, from where it lies (LM-F002).
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toContain('[o](../past/other.md)');
    expect(await rows()).toMatchObject([{ id, path: weekly, target: pastWeekly }]);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(pastWeekly)).toMatchObject({ status: 200, body: { committed: true, moved: { from: weekly } } });
    expect(files.get(pastWeekly)).toBe('---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    expect(decodeURIComponent(files.get(index)!)).toContain('](past/2026-11-17 公司週會.md)');
    expect(decodeURIComponent(files.get('notes/life/past/other.md')!)).toContain('[w](2026-11-17 公司週會.md)');
    expect([...files.keys()].some(file => file.startsWith('notes/life/會議/'))).toBe(false);
  });

  it("keeps every link right when a folder move's live note finds its target taken at its check-in (LM-F006)", async () => {
    const pastWeekly = 'notes/life/past/2026-11-17 公司週會.md';
    files.set(weekly, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move('notes/life/會議', 'notes/life/past');
    await gitCommit(pastWeekly, '# Someone else\n');
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(pastWeekly)).toMatchObject({ status: 200, body: { path: weekly, committed: true, unmoved: pastWeekly } });
    expect(files.get(pastWeekly)).toBe('# Someone else\n');
    // The note stays where the links to it lead, and its own link still finds the note that moved.
    expect(files.get(index)).toBe('# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n');
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程 [o](../past/other.md)\n');
  });

  it('answers a folder move whose commit landed with the live notes it could not take along, which stay where the links lead (LM-F003)', async () => {
    files.set(weekly, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    vi.spyOn(liveNotes.service, 'retarget').mockRejectedValue(new LiveUnavailableError());
    const moved = await move('notes/life/會議', 'notes/life/past');
    expect(moved).toMatchObject({ status: 200, body: { pathMap: { 'notes/life/會議/other.md': 'notes/life/past/other.md' }, liveLeft: [{ path: weekly }] } });
    expect(moved.body.pathMap).not.toHaveProperty([weekly]);
    expect(files.has('notes/life/past/other.md')).toBe(true);
    expect((await rows())[0]).not.toHaveProperty('target');
    expect(files.get(index)).toBe('# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n');
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toContain('[o](../past/other.md)');
    // The folder tree answers the same way.
    leaseRunsOut();
    const revision = (await call('GET', '/api/folder-manager?notebookId=notes~life')).body.revision;
    expect(await call('POST', '/api/folder-manager', { command: { kind: 'move', notebookId: 'notes~life', path: '會議', parent: 'archive' }, revision })).toMatchObject({ status: 200, body: { liveLeft: [{ path: weekly }] } });
    expect((await rows())[0]).not.toHaveProperty('target');
  });

  it('takes a target inside a moved folder along with the folder, and the target it replaced still leads to the note', async () => {
    files.set('notes/life/projects/plan.md', '# Plan\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    const projected = 'notes/life/projects/archive/2026-11-17 公司週會.md';
    const moved = await move('notes/life/archive', 'notes/life/projects/archive');
    expect(moved).toMatchObject({ status: 200, body: { pathMap: { [archived]: projected, 'notes/life/archive/old.md': 'notes/life/projects/archive/old.md' } } });
    expect(moved.body.liveLeft).toBeUndefined();
    expect(moved.body.deletedPaths).not.toContain(projected);
    // The note's Git file stays where it lies; only the folder's own files moved.
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程\n');
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/archive/old.md', 'notes/life/projects/archive/old.md']]);
    expect(await rows()).toMatchObject([{ id, path: weekly, target: projected }]);
    // An editor still at the old target finds the note at the new one and joins the same live note there.
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: projected } });
    expect(await checkout(archived)).toMatchObject({ status: 200, body: { outcome: 'joined', checkout: { id, path: projected } } });
    expect(await listed()).toContain(projected);
    expect(await listed()).not.toContain(archived);
  });

  it('moves a folder from the folder tree the same way', async () => {
    files.set(weekly, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const revision = (await call('GET', '/api/folder-manager?notebookId=notes~life')).body.revision;
    expect(await call('POST', '/api/folder-manager', { command: { kind: 'move', notebookId: 'notes~life', path: '會議', parent: 'archive' }, revision })).toMatchObject({ status: 200 });
    expect(files.has('notes/life/archive/會議/other.md')).toBe(true);
    expect(files.has(weekly)).toBe(true);
    expect(files.get(index)).toBe('# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n');
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/archive/會議/2026-11-17 公司週會.md' }]);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn('notes/life/archive/會議/2026-11-17 公司週會.md')).toMatchObject({ status: 200, body: { committed: true, moved: { from: weekly } } });
    expect(files.get('notes/life/archive/會議/2026-11-17 公司週會.md')).toBe('---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    expect(decodeURIComponent(files.get(index)!)).toContain('](archive/會議/2026-11-17 公司週會.md)');
  });

  it('keeps refusing a deletion while others edit, and a move where the live editor cannot retarget', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    expect(await call('POST', '/api/files', { command: { kind: 'delete', notebookId: 'notes~life', path: weekly }, revision: (await call('GET', '/api/files?notebookId=notes~life')).body.revision })).toMatchObject({ status: 409, body: { code: 'checked-out' } });
    await new Promise<void>(resolve => server!.close(() => resolve()));
    liveNotes = make(frame, false);
    await start();
    const framed = await open(weekly);
    liveNotes.setActive(repository, framed, 1);
    expect(await move(weekly, archived)).toMatchObject({ status: 409, body: { code: 'checked-out', paths: [weekly] } });
    expect(commits()).toEqual([]);
  });

  it('moves a live note through MCP mv as the app does, and says it moves at the check-in', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const token = (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;
    const tool = async (name: string, args: object) => {
      const response = await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const { result } = await response.json();
      return result.isError ? { error: JSON.parse(result.content[0].text) } : { result: result.structuredContent as Record<string, unknown> };
    };
    const revision = (await tool('glob', { pattern: 'notes/**/*.md' })).result!.revision as string;
    const answer = await tool('mv', { source: weekly, destination: archived, revision });
    expect(answer.result).toMatchObject({ committed: false, live: true, path: weekly, target: archived });
    expect(String(answer.result!.hint)).toMatch(/check-in/i);
    expect(commits()).toEqual([]);
    expect(await rows()).toMatchObject([{ id, target: archived }]);
    // Moved back, then with its folder: the links to it keep its Git path, and its own link follows the folder.
    await move(archived, weekly);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n', sam);
    const folder = await tool('mv', { source: 'notes/life/會議', destination: 'notes/life/past', recursive: true, revision: (await tool('glob', { pattern: 'notes/**/*.md' })).result!.revision as string });
    expect(folder).toMatchObject({ result: { live: true } });
    expect(files.get(index)).toBe('# Index\n\n[週會](會議/2026-11-17%20公司週會.md)\n');
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toContain('[o](../past/other.md)');
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/past/2026-11-17 公司週會.md' }]);
  });

  it("rewrites the moving note's own links once when its move commit is tried again (LM-F001)", async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    const merged = recordMerges();
    const commit = RemoteSource.prototype.commitChanges;
    let stale = 1;
    vi.spyOn(RemoteSource.prototype, 'commitChanges').mockImplementation(async function(this: RemoteSource, ...args: Parameters<RemoteSource['commitChanges']>) {
      if (args[2] === 'move' && stale-- > 0) throw new StaleRevisionError([repository]);
      return commit.apply(this, args);
    });
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true, moved: { from: weekly } } });
    expect(files.get(archived)).toBe('---\ntitle: 公司週會\n---\n議程 [x](old.md)\n');
    // The live text takes the rewrite once, after the commit landed.
    expect(merged).toEqual(['---\ntitle: 公司週會\n---\n議程 [x](old.md)\n']);
  });

  it('commits the note in place with its own text when the retried move finds its target taken (LM-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.type(repository, id, own.replace('議程', '議程二'), sam);
    liveNotes.setActive(repository, id, 0);
    const merged = recordMerges();
    const commit = RemoteSource.prototype.commitChanges;
    let stale = 1;
    vi.spyOn(RemoteSource.prototype, 'commitChanges').mockImplementation(async function(this: RemoteSource, ...args: Parameters<RemoteSource['commitChanges']>) {
      if (args[2] === 'move' && stale-- > 0) {
        await gitCommit(archived, '# Someone else\n');
        throw new StaleRevisionError([repository]);
      }
      return commit.apply(this, args);
    });
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: weekly, committed: true, unmoved: archived } });
    expect(files.get(archived)).toBe('# Someone else\n');
    expect(files.get(weekly)).toBe(own.replace('議程', '議程二'));
    expect(merged).toEqual([]);
  });

  it('finishes a move whose commit landed but whose live text missed the rewrite, rewriting it once (LM-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n\n結論\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    vi.spyOn(liveNotes.service, 'mergeInOnce').mockRejectedValueOnce(new LiveUnavailableError());
    expect((await checkIn(archived)).status).toBe(502);
    expect(files.get(archived)).toBe(own.replace('../archive/old.md', 'old.md'));
    // Typing goes on in the live text, which still holds the links as they were.
    liveNotes.type(repository, id, own.replace('結論', '結論二'), sam);
    liveNotes.setActive(repository, id, 0);
    leaseRunsOut();
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true } });
    expect(files.get(archived)).toBe(own.replace('../archive/old.md', 'old.md').replace('結論', '結論二'));
    expect(files.has(weekly)).toBe(false);
  });

  it('rewrites a link line the person edited after the write-back of a landed move failed, at the next check-in (LMR-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [o](other.md) [x](../archive/old.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    // The first write-back fails, by whichever call the check-in makes it.
    vi.spyOn(liveNotes.service, 'mergeIn').mockRejectedValueOnce(new LiveUnavailableError());
    vi.spyOn(liveNotes.service, 'mergeInOnce').mockRejectedValueOnce(new LiveUnavailableError());
    expect((await checkIn(archived)).status).toBe(502);
    expect(decodeURIComponent(files.get(archived)!)).toBe('---\ntitle: 公司週會\n---\n議程 [o](../會議/other.md) [x](old.md)\n');
    // The person types on the link line, which still holds the links as they were before the move.
    liveNotes.type(repository, id, own.replace('議程', '議程改'), sam);
    liveNotes.setActive(repository, id, 0);
    leaseRunsOut();
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true } });
    expect(decodeURIComponent(files.get(archived)!)).toBe('---\ntitle: 公司週會\n---\n議程改 [o](../會議/other.md) [x](old.md)\n');
    expect(await rows()).toEqual([]);
  });

  it('makes a write-back typing refused again on the text as typed, in the same check-in (LMR-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    // Typing on the link line lands between the read and the write-back, which it refuses.
    const once = liveNotes.service.mergeInOnce!.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'mergeInOnce').mockImplementationOnce(async () => {
      liveNotes.type(repository, id, own.replace('[o]', '[其他]'), sam);
      throw new LiveStaleError();
    }).mockImplementation(once);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true, released: false, reason: 'changed' } });
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toBe('---\ntitle: 公司週會\n---\n議程 [其他](../會議/other.md)\n');
  });

  for (const once of [true, false]) {
    it(`never rewrites the links of a landed move twice when its acknowledgement was lost, whatever lines were pasted since (LMR-F002${once ? ', by the write-back record' : ', by the lines'})`, async () => {
      const own = '---\ntitle: 公司週會\n---\n[x](../archive/old.md)\n[y](../archive/y.md)\n';
      files.set(weekly, own);
      if (!once) delete (liveNotes.service as { mergeInOnce?: unknown; }).mergeInOnce;
      await start();
      const id = await open(weekly);
      liveNotes.setActive(repository, id, 1);
      await move(weekly, archived);
      liveNotes.setActive(repository, id, 0);
      vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new LiveUnavailableError());
      expect((await checkIn(archived)).status).toBe(502);
      const rewritten = '---\ntitle: 公司週會\n---\n[x](old.md)\n[y](y.md)\n';
      expect(files.get(archived)).toBe(rewritten);
      expect((await liveNotes.person(pat).read(repository, id)).content).toBe(rewritten);
      // More lines in the form the links had before the move than lines the rewrite changed.
      liveNotes.type(repository, id, `${rewritten}${'[x](../archive/old.md)\n'.repeat(3)}`, sam);
      liveNotes.setActive(repository, id, 0);
      leaseRunsOut();
      expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true } });
      expect(files.get(archived)).toBe(`${rewritten}${'[x](../archive/old.md)\n'.repeat(3)}`);
    });
  }

  it('rewrites the links of a note moved there, back, and there again, each move on its own (FLM-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const there = own.replace('../archive/old.md', 'old.md');
    for (const [from, to, text] of [[weekly, archived, there], [archived, weekly, own], [weekly, archived, there]] as const) {
      await move(from, to);
      expect(await checkIn(to)).toMatchObject({ status: 200, body: { path: to, committed: true, moved: { from } } });
      expect(files.get(to)).toBe(text);
      expect((await liveNotes.person(pat).read(repository, id)).content).toBe(text);
      // The memory adapter cannot give a lease back: the check-in that left the note live holds it until it runs out.
      leaseRunsOut();
    }
    // Nothing typed since, the next check-in commits nothing and the links still lead where they did.
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: false, released: true } });
    expect(files.get(archived)).toBe(there);
  });

  it('never rewrites the links of a landed move twice when its acknowledgement was lost twice, with typing between (FLM-F001)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n\n結論\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new LiveUnavailableError()).mockRejectedValueOnce(new LiveUnavailableError());
    expect((await checkIn(archived)).status).toBe(502);
    const rewritten = own.replace('../archive/old.md', 'old.md');
    expect(files.get(archived)).toBe(rewritten);
    liveNotes.type(repository, id, rewritten.replace('結論', '結論二'), sam);
    liveNotes.setActive(repository, id, 0);
    leaseRunsOut();
    expect((await checkIn(archived)).status).toBe(502);
    expect(files.get(archived)).toBe(rewritten.replace('結論', '結論二'));
    leaseRunsOut();
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: false, released: true } });
    expect(files.get(archived)).toBe(rewritten.replace('結論', '結論二'));
  });

  it('leaves a link line the person fixed by hand after the write-back of a landed move failed, and rewrites the rest (FLM-F002)', async () => {
    const own = '---\ntitle: 公司週會\n---\n[x](../archive/old.md)\n[y](../archive/y.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    vi.spyOn(liveNotes.service, 'mergeInOnce').mockRejectedValueOnce(new LiveUnavailableError());
    expect((await checkIn(archived)).status).toBe(502);
    const rewritten = '---\ntitle: 公司週會\n---\n[x](old.md)\n[y](y.md)\n';
    expect(files.get(archived)).toBe(rewritten);
    // The editor reads the note where it went: the person fixes the first link for that folder.
    liveNotes.type(repository, id, own.replace('../archive/old.md', 'old.md'), sam);
    liveNotes.setActive(repository, id, 0);
    leaseRunsOut();
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, released: true } });
    expect(files.get(archived)).toBe(rewritten);
  });

  it('leaves a link line typing fixed when a write-back it refused is made again in the same check-in (FLM-F002)', async () => {
    const own = '---\ntitle: 公司週會\n---\n[x](../archive/old.md)\n[y](../archive/y.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    const once = liveNotes.service.mergeInOnce!.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'mergeInOnce').mockImplementationOnce(async () => {
      liveNotes.type(repository, id, own.replace('../archive/old.md', 'old.md'), sam);
      throw new LiveStaleError();
    }).mockImplementation(once);
    // The live text holds what the move committed, so it is released with it.
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, committed: true, released: true } });
    expect(files.get(archived)).toBe('---\ntitle: 公司週會\n---\n[x](old.md)\n[y](y.md)\n');
  });

  it('never rewrites the links of a landed move twice when its acknowledgement was lost for more than a day (FLM-F003)', async () => {
    const own = '---\ntitle: 公司週會\n---\n議程 [x](../archive/old.md)\n';
    files.set(weekly, own);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    await move(weekly, archived);
    liveNotes.setActive(repository, id, 0);
    vi.spyOn(liveNotes.service, 'synced').mockRejectedValueOnce(new LiveUnavailableError());
    expect((await checkIn(archived)).status).toBe(502);
    const rewritten = own.replace('../archive/old.md', 'old.md');
    expect((await liveNotes.person(pat).read(repository, id)).content).toBe(rewritten);
    clock.advance(25 * 60 * 60_000);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: archived, released: true } });
    expect(files.get(archived)).toBe(rewritten);
  });

  it("tries a folder move's rewrite of a live note's links again on a fresh read, and says when its links still lead where the notes were (LMR-F003)", async () => {
    files.set(weekly, '---\ntitle: 公司週會\n---\n議程 [o](other.md)\n');
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const person = liveNotes.person.bind(liveNotes);
    let refusals = 1;
    vi.spyOn(liveNotes, 'person').mockImplementation(context => {
      const calls = person(context);
      return { ...calls, write: async (...args) => refusals-- > 0 ? Promise.reject(new LiveStaleError()) : calls.write(...args) };
    });
    // Refused once, the rewrite is made again and holds.
    expect(await move('notes/life/會議', 'notes/life/past')).toMatchObject({ status: 200, body: { pathMap: { 'notes/life/會議/other.md': 'notes/life/past/other.md' } } });
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toContain('[o](../past/other.md)');
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/past/2026-11-17 公司週會.md' }]);
    // Refused twice, the note still moves, and the answer says its links lead where the notes were.
    leaseRunsOut();
    refusals = 2;
    const moved = await move('notes/life/past', 'notes/life/later');
    expect(moved).toMatchObject({ status: 200, body: { liveLeft: [{ path: 'notes/life/past/2026-11-17 公司週會.md', destination: 'notes/life/later/2026-11-17 公司週會.md', linksBroken: true, moved: true, reason: expect.stringContaining('links') }] } });
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/later/2026-11-17 公司週會.md' }]);
    expect(decodeURIComponent((await liveNotes.person(pat).read(repository, id)).content)).toContain('[o](../past/other.md)');
  });

  it('commits a note in place, marked unmoved for its size, when its move would change too many files (LM-F005)', async () => {
    for (let n = 0; n < 201; n++) files.set(`notes/life/refs/r${n}.md`, `[w](../會議/2026-11-17%20公司週會.md)\n`);
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    expect(await move(weekly, archived)).toMatchObject({ status: 200, body: { live: { target: archived } } });
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n', sam);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: weekly, committed: true, unmoved: archived, unmovedReason: 'too-large' } });
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程\n續寫\n');
    expect(files.has(archived)).toBe(false);
  });

  it('moves a note its mover alone edits in place when the move is too large, keeps it open marked with the reason, and checks it in again (LM-F005)', async () => {
    for (let n = 0; n < 201; n++) files.set(`notes/life/refs/r${n}.md`, `[w](../會議/2026-11-17%20公司週會.md)\n`);
    await start();
    const id = await open(weekly);
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n', pat);
    liveNotes.setActive(repository, id, 1);
    expect(await move(weekly, archived, { editing: true })).toMatchObject({ status: 200, body: { live: { path: weekly, target: null, checkIn: { path: weekly, committed: true, released: false, unmoved: archived, unmovedReason: 'too-large' } } } });
    expect(await rows()).toMatchObject([{ id, path: weekly, unmoved: archived, unmovedReason: 'too-large' }]);
    expect((await read(weekly)).body.note.live).toMatchObject({ unmoved: archived, unmovedReason: 'too-large' });
    liveNotes.type(repository, id, '---\ntitle: 公司週會\n---\n議程\n續寫\n再寫\n', sam);
    liveNotes.setActive(repository, id, 0);
    leaseRunsOut();
    expect(await checkIn(weekly)).toMatchObject({ status: 200, body: { path: weekly, committed: true, released: true } });
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程\n續寫\n再寫\n');
  });
});

describe('moving a live note over the built-in editor', () => {
  let fixture: BuiltinFixture;
  const IDLE_MS = 10 * 60_000;
  /** Who has the note open on a process of the editor, and when each last did something there. */
  const present = async (id: string, people: Record<string, number>) => fixture.store.presence(id, 'process-x', people, fixture.time.now());
  // The app signs every writer of this file in as Pat: the mover.
  const mover = liveEditorRef(pat, false).key, other = liveEditorRef(sam, false).key;
  beforeEach(async () => {
    fixture = builtinFixture({ files });
    await start(fixture.liveNotes);
  });

  it("checks a move from the mover's own editor in at once only when nobody else has the note open, whether they or the mover typed lately or not", async () => {
    const id = await open(weekly);
    fixture.time.advance(IDLE_MS + 1000);
    const now = fixture.time.now();
    // The mover has been idle a while, and Sam is typing: Sam still edits it.
    await present(id, { [mover]: now - IDLE_MS - 1, [other]: now });
    expect(await move(weekly, archived, { editing: true })).toMatchObject({ status: 200, body: { live: { path: weekly, target: archived } } });
    expect(commits()).toEqual([]);
    // Sam has been idle a while but has it open: still not alone.
    await present(id, { [mover]: now, [other]: now - IDLE_MS - 1 });
    const renamed = 'notes/life/archive/週會.md';
    expect(await move(archived, renamed, { editing: true })).toMatchObject({ status: 200, body: { live: { path: weekly, target: renamed } } });
    expect(await move(renamed, archived, { title: '公司週會', editing: true })).toMatchObject({ status: 200, body: { live: { target: archived } } });
    expect(commits()).toEqual([]);
    // Sam left: the mover alone has it open, and the move lands now.
    await present(id, { [mover]: now });
    expect(await move(archived, renamed, { editing: true })).toMatchObject({ status: 200, body: { live: { path: renamed, target: null, checkIn: { committed: true, released: false, reason: 'active' } } } });
    expect(commits().map(commit => commit.paths)).toEqual([[index, renamed, weekly].sort()]);
    // A tab still at any path the note was read at follows it, and its socket opens there.
    expect(await read(weekly)).toMatchObject({ status: 404, body: { movedTo: renamed } });
    expect(await read(archived)).toMatchObject({ status: 404, body: { movedTo: renamed } });
    for (const path of [weekly, archived, renamed]) expect(await call('POST', '/api/live/socket-ticket', { notebookId: 'notes~life', path }), path).toMatchObject({ status: 200, body: { document: expect.stringMatching(new RegExp(`^${id}\\.`)) } });
  });

  it('keeps leading the paths a note left to where it was filed once it is released (fix5 P2-2)', async () => {
    const id = await open(weekly);
    // Nobody else has it open: the move lands now, and the note is released with nobody in it.
    expect(await move(weekly, archived)).toMatchObject({ status: 200, body: { live: { path: archived, checkIn: { committed: true, released: true } } } });
    expect(await fixture.liveNotes.service.checkouts(repository)).toEqual([]);
    expect(await read(weekly)).toMatchObject({ status: 404, body: { movedTo: archived } });
    expect((await fixture.store.link(id))?.live).toBe(false);
  });
});
