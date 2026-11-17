import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, type LiveEditorInfo, parseWorkspaceConfig, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
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

let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, liveNotes: MemoryLiveNotes;
const start = async () => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files]]), mayWrite: who => who.userId !== 'p2' });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes }));
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
const checkout = (file: string) => call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: file });
const open = async (file: string) => (await checkout(file)).body.checkout.id as string;
const move = (from: string, destination: string, extra: Record<string, unknown> = {}, who: string | null = 'p1') => call('POST', '/api/files', { command: { kind: 'move', notebookId: 'notes~life', path: from, destination, ...(extra.title ? { title: extra.title } : {}) }, ...(extra.editing ? { editing: true } : {}) }, who);
const checkIn = (file: string) => call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: file });
const read = (file: string) => call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(file)}`);
const listed = async () => ((await call('GET', '/api/notes?notebookId=notes~life')).body.notes as { path: string; live?: Record<string, unknown>; }[]).map(note => note.path).sort();
const rows = () => liveNotes.service.checkouts(repository);
const make = (editor: LiveEditorInfo = builtin, retarget = true) => memoryLiveNotes({ editor, repositories: [{ source: notes, files }], clock: memoryLiveClock(), discard: true, retarget });

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
    expect(files.get(index)).toMatch(/\]\(archive\/2026-11-17(%20| )公司週會\.md\)/);
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

  it('retitles the live text with a rename, without a check-in while others edit', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 2);
    const renamed = 'notes/life/會議/2026-11-17 全員週會.md';
    expect(await move(weekly, renamed, { title: '全員週會', editing: true })).toMatchObject({ status: 200, body: { live: { target: renamed } } });
    expect(commits()).toEqual([]);
    expect((await liveNotes.person(pat).read(repository, id)).content).toContain('title: 全員週會');
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
    expect(await checkIn(archived)).toMatchObject({ status: 200, body: { path: weekly, committed: true, unmoved: archived } });
    expect(files.get(archived)).toBe('# Someone else\n');
    expect(files.get(weekly)).toBe('---\ntitle: 公司週會\n---\n議程\n續寫\n');
    expect(await rows()).toMatchObject([{ id, path: weekly, unmoved: archived }]);
    expect((await read(weekly)).body.note.live).toMatchObject({ unmoved: archived });
  });

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

  it('moves a folder now and its live note at its check-in', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const moved = await move('notes/life/會議', 'notes/life/past');
    expect(moved).toMatchObject({ status: 200, body: { pathMap: { 'notes/life/會議/other.md': 'notes/life/past/other.md', [weekly]: 'notes/life/past/2026-11-17 公司週會.md' } } });
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/past/other.md', 'notes/life/會議/other.md'].sort()]);
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/past/2026-11-17 公司週會.md' }]);
    liveNotes.setActive(repository, id, 0);
    expect(await checkIn('notes/life/past/2026-11-17 公司週會.md')).toMatchObject({ status: 200, body: { committed: true, moved: { from: weekly } } });
    expect(files.has('notes/life/past/2026-11-17 公司週會.md')).toBe(true);
    expect([...files.keys()].some(file => file.startsWith('notes/life/會議/'))).toBe(false);
  });

  it('moves a folder from the folder tree the same way', async () => {
    await start();
    const id = await open(weekly);
    liveNotes.setActive(repository, id, 1);
    const revision = (await call('GET', '/api/folder-manager?notebookId=notes~life')).body.revision;
    expect(await call('POST', '/api/folder-manager', { command: { kind: 'move', notebookId: 'notes~life', path: '會議', parent: 'archive' }, revision })).toMatchObject({ status: 200 });
    expect(files.has('notes/life/archive/會議/other.md')).toBe(true);
    expect(files.has(weekly)).toBe(true);
    expect(await rows()).toMatchObject([{ id, path: weekly, target: 'notes/life/archive/會議/2026-11-17 公司週會.md' }]);
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
  });
});
