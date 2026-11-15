import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { checkInLink, type EditionSourceConfig, gitBlobId, type LiveCheckInOptions, type LiveContext, type LiveEditorInfo, normalizeLiveText, parseWorkspaceConfig, sourceIdentity, sweepLive, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';
import { type IdentityService } from '../src/identity.js';
import { liveNotesContract } from '../src/live-notes-contract.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { memoryLiveClock, type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

/*
 * Discarding a pending live draft (docs/specs/2026-11-15-builtin-live-editor §19, §19.1, slice N1b): the seam's
 * optional `discard`, the sweep and 「立即簽回」 that discard empty drafts, and `POST /api/live/discard`.
 */

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n`;
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const repository = sourceIdentity(notes);
const frame = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const builtin = { kind: 'builtin' as const };
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
const person = (n: number): LiveContext => ({ ...pat, person: { realm: 'edition', userId: `p${n}` }, author: { name: `Person ${n}`, email: `p${n}@example.test` } });

for (const [name, editor] of [['frame', frame], ['builtin', builtin]] as [string, LiveEditorInfo][]) {
  liveNotesContract(`memory (${name}, discard)`, () => {
    const clock = memoryLiveClock();
    const adapter = memoryLiveNotes({ editor, repositories: [{ source: notes, files: new Map([['.mygitnotes.yaml', manifest]]) }], clock, discard: true });
    return { liveNotes: adapter, repository, notebook: 'notes~life', root: 'notes/life', person, type: (id, text, who) => adapter.type(repository, id, text, who), setActive: (id, n) => adapter.setActive(repository, id, n), advance: ms => clock.advance(ms) };
  });
}

describe('the memory adapter with discard', () => {
  it('implements discard only when asked to, as a 0.19 adapter lacks it', () => {
    const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest]]);
    expect(typeof memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], discard: true }).service.discard).toBe('function');
    expect(memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] }).service.discard).toBeUndefined();
  });

  it('gives the initial text of a pending note in its detail, and none for a checked-out note', async () => {
    const files: MemoryFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '# A\n']]);
    const adapter = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], discard: true });
    const pending = await adapter.person(pat).createPending(repository, { notebook: 'notes~life', pathRule: '{{title}}.md', content: '# Start\n' });
    adapter.type(repository, pending.id, '# Start\nmore\n', pat);
    const lease = await adapter.service.lease(repository, pending.id);
    expect(await adapter.service.detail(repository, pending.id, lease)).toMatchObject({ content: '# Start\nmore\n', initialText: '# Start\n' });
    const { checkout } = await adapter.person(pat).checkout(repository, { notebook: 'notes~life', path: 'notes/life/a.md', base: { commit: 'a'.repeat(40), blob: 'b'.repeat(40), content: '# A\n' } });
    const detail = await adapter.service.detail(repository, checkout.id, await adapter.service.lease(repository, checkout.id));
    expect(detail).not.toHaveProperty('initialText');
  });
});

describe('the check-in engine and empty drafts', () => {
  let files: MemoryFiles, clock: ReturnType<typeof memoryLiveClock>, liveNotes: MemoryLiveNotes;
  const scope = async () => parseWorkspaceConfig(manifest);
  const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
  const run = (id: string, options: Partial<LiveCheckInOptions> = {}) => checkInLink(liveNotes, repository, id, { mode: 'manual', now: clock.now, timeZone: 'Asia/Taipei', sleep: async () => {}, ...options });
  const sweep = () => sweepLive(liveNotes, { instant: new Date(clock.now() + 1000), now: clock.now, timeZone: 'Asia/Taipei', sleep: async () => {} });
  const pending = (content: string, pathRule = 'inbox/{{title}}.md') => liveNotes.person(pat).createPending(repository, { notebook: 'notes~life', pathRule, content });
  const make = (discard: boolean) => memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], clock, ...(discard ? { discard } : {}) });

  beforeEach(() => {
    files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\nGit body.\n']]);
    clock = memoryLiveClock(Date.parse('2026-11-14T20:00:00.000Z'));
    liveNotes = make(true);
  });

  it('makes the sweep discard a pending note nobody typed in, with no commit', async () => {
    const untyped = await pending('---\ntitle: 未命名\n---\n\nStart writing here.\n');
    const report = await sweep();
    expect(report).toMatchObject({ due: 1, failed: [] });
    expect(report.results).toEqual([{ id: untyped.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' }]);
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
    expect(await liveNotes.person(pat).filed(repository, untyped.id)).toBeNull();
    expect(liveNotes.notices).toEqual([]);
  });

  it('makes the sweep discard a pending note nobody typed in even where the adapter keeps no initial text', async () => {
    const untyped = await pending('---\ntitle: Kept\n---\n\nA body that is not empty.\n');
    const detail = liveNotes.service.detail.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'detail').mockImplementation(async (...args) => {
      const { initialText: _initial, ...rest } = await detail(...args);
      return rest;
    });
    expect((await sweep()).results).toEqual([{ id: untyped.id, path: null, committed: false, released: true, discarded: true, reason: 'untyped' }]);
    expect(commits()).toEqual([]);
  });

  it('makes the sweep discard a typed draft of only spaces and ---, and file one with a single CJK character', async () => {
    const empty = await pending('---\ntitle: Empty\n---\n');
    liveNotes.type(repository, empty.id, '---\ntitle: Empty\n---\n   \n\n---\n  ', person(2));
    const one = await pending('---\ntitle: 一字\n---\n');
    liveNotes.type(repository, one.id, '---\ntitle: 一字\n---\n字\n', person(2));
    const report = await sweep();
    expect(report.failed).toEqual([]);
    expect(report.results).toContainEqual({ id: empty.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(report.results).toContainEqual(expect.objectContaining({ id: one.id, path: 'notes/life/inbox/一字.md', committed: true, released: true, filed: true }));
    expect(files.get('notes/life/inbox/一字.md')).toBe('---\ntitle: 一字\n---\n字\n');
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/inbox/一字.md']]);
    expect(commits()[0].author).toEqual({ name: 'Person 2', email: 'p2@example.test' });
  });

  it('files a typed draft in a sweep even when its only editor has a name the engine cannot take (§19)', async () => {
    const long = await pending('---\ntitle: Long\n---\n');
    liveNotes.type(repository, long.id, '---\ntitle: Long\n---\n字\n', { ...pat, person: { realm: 'edition', userId: 'p9' }, author: { name: 'n'.repeat(300), email: 'p9@example.test' } });
    const report = await sweep();
    expect(report.failed).toEqual([]);
    expect(report.results).toEqual([expect.objectContaining({ id: long.id, path: 'notes/life/inbox/Long.md', committed: true, filed: true })]);
  });

  it('makes 「立即簽回」 discard an empty draft whoever typed in it, and file one with content', async () => {
    const template = '---\ntitle: 週會\n---\n# 週會\n\n## 待辦\n- \n';
    const empty = await pending(template);
    liveNotes.type(repository, empty.id, `${template}- \n\n  \n`, person(2));
    expect(await run(empty.id)).toEqual({ id: empty.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' });
    const typed = await pending(template);
    liveNotes.type(repository, typed.id, template.replace('- \n', '- 買牛奶\n'), person(2));
    expect(await run(typed.id)).toMatchObject({ path: 'notes/life/inbox/週會.md', committed: true, released: true, filed: true });
    expect(commits().map(commit => commit.paths)).toEqual([['notes/life/inbox/週會.md']]);
  });

  it('leaves a pending note nobody typed in but with content to the sweep: 「立即簽回」 files it where the adapter keeps no initial text', async () => {
    const untyped = await pending('---\ntitle: Kept\n---\n\nA body.\n');
    const detail = liveNotes.service.detail.bind(liveNotes.service);
    vi.spyOn(liveNotes.service, 'detail').mockImplementation(async (...args) => {
      const { initialText: _initial, ...rest } = await detail(...args);
      return rest;
    });
    expect(await run(untyped.id)).toMatchObject({ path: 'notes/life/inbox/Kept.md', committed: true, filed: true });
  });

  it('retries a discard refused as active by hand, and leaves it to the next tick when scheduled', async () => {
    const manual = await pending('---\ntitle: M\n---\n');
    const scheduled = await pending('---\ntitle: S\n---\n');
    for (const id of [manual.id, scheduled.id]) liveNotes.setActive(repository, id, 1);
    const discard = vi.spyOn(liveNotes.service, 'discard' as never) as unknown as ReturnType<typeof vi.fn>;
    const sleep = vi.fn(async () => {});
    expect(await run(manual.id, { sleep })).toMatchObject({ committed: false, released: false, reason: 'active', activeEditors: 1 });
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(discard).toHaveBeenCalledTimes(4);
    discard.mockClear();
    sleep.mockClear();
    expect(await run(scheduled.id, { mode: 'scheduled', sleep })).toMatchObject({ committed: false, released: false, reason: 'active' });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect((await liveNotes.service.checkouts(repository)).map(row => row.id).sort()).toEqual([manual.id, scheduled.id].sort());
  });

  it('never discards a filed note, even blanked', async () => {
    const snapshot = await new MemoryEditionSource(notes, files, true, memoryCommitCounter(files), undefined, scope).getSnapshot(true);
    const content = files.get('notes/life/a.md')!;
    const { checkout } = await liveNotes.person(pat).checkout(repository, { notebook: 'notes~life', path: 'notes/life/a.md', base: { commit: snapshot.sha, blob: gitBlobId(Buffer.from(content), 40), content: normalizeLiveText(content) } });
    liveNotes.type(repository, checkout.id, '---\ntitle: A\n---\n', pat);
    expect(await run(checkout.id)).toMatchObject({ path: 'notes/life/a.md', committed: true, released: true });
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\n');
  });

  it('files an untyped or empty pending note as 0.19 did where the adapter cannot discard', async () => {
    liveNotes = make(false);
    const untyped = await pending('---\ntitle: 未命名\n---\n');
    const report = await sweep();
    expect(report.results).toEqual([expect.objectContaining({ id: untyped.id, path: 'notes/life/inbox/未命名.md', committed: true, released: true, filed: true })]);
    const empty = await pending('---\ntitle: Blank\n---\n');
    liveNotes.type(repository, empty.id, '---\ntitle: Blank\n---\n  \n---\n', pat);
    expect(await run(empty.id)).toMatchObject({ path: 'notes/life/inbox/Blank.md', committed: true, filed: true });
    expect(commits()).toHaveLength(2);
  });
});

/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

describe('POST /api/live/discard and the routes around it', () => {
  let root: string, server: Server | undefined, base: string, store: RecordStore, files: MemoryFiles, otherFiles: MemoryFiles, liveNotes: MemoryLiveNotes;
  const start = async () => {
    const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', otherFiles]]), mayWrite: who => who.userId === 'p1' });
    server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes }));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  };
  const call = async (method: string, url: string, body?: unknown, who: string | null = 'p1') => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-person': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text && (response.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(text) : null };
  };
  const tool = async (token: string, name: string, args: object) => {
    const answer = await (await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json();
    if (!answer.result || answer.result.isError) throw new Error(`MCP ${name}: ${JSON.stringify(answer)}`);
    return answer.result.structuredContent as Record<string, unknown>;
  };
  const tools = async (token: string) => (await (await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })).json()).result.tools as { name: string; outputSchema: { properties: Record<string, { enum?: string[]; }>; }; }[];
  const grant = async () => (await call('POST', '/api/auth/agent-token', { name: 'client', write: true })).body.token as string;
  const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
  const draft = async (body: Record<string, unknown> = {}) => (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Draft', ...body })).body.checkout as { id: string; path: string; };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-discard-')));
    for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
    store = createRecordStore(root);
    files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\nGit body.\n']]);
    otherFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']]);
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }], clock: memoryLiveClock(), discard: true });
    server = undefined;
  });
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('says discard in the workspace for an adapter that has it, beside the editor as configured', async () => {
    await start();
    expect((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([{ ...frame, discard: true }, null]);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    liveNotes = memoryLiveNotes({ editor: builtin, repositories: [{ source: notes, files }], discard: true });
    await start();
    expect((await call('GET', '/api/workspace')).body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([{ kind: 'builtin', discard: true }, null]);
  });

  it('discards an untyped draft at once for a signed-in writer, and the virtual path then says nothing was filed', async () => {
    await start();
    const pending = await draft({ content: 'Start writing here.\n' });
    expect((await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path }, 'p2')).status).toBe(403);
    expect((await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path }, null)).status).toBe(403);
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toEqual({ status: 200, body: { discarded: true } });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
    expect(await call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(pending.path)}`)).toMatchObject({ status: 404, body: { movedTo: null } });
    expect((await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).status).toBe(404);
  });

  it('asks a typed draft with content for confirm, and discards it with confirm', async () => {
    await start();
    const pending = await draft();
    liveNotes.type(repository, pending.id, `${(await liveNotes.person(pat).read(repository, pending.id)).content}\nA thought.\n`, pat);
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toMatchObject({ status: 409, body: { code: 'has-edits' } });
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path, confirm: false })).toMatchObject({ status: 409, body: { code: 'has-edits' } });
    expect((await liveNotes.service.checkouts(repository)).map(row => row.id)).toEqual([pending.id]);
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path, confirm: true })).toEqual({ status: 200, body: { discarded: true } });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('discards a typed but empty draft without confirm', async () => {
    await start();
    const pending = await draft();
    const text = (await liveNotes.person(pat).read(repository, pending.id)).content;
    liveNotes.type(repository, pending.id, `${text}   \n---\n\n`, pat);
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toEqual({ status: 200, body: { discarded: true } });
    expect(commits()).toEqual([]);
  });

  it('discards an empty template draft without confirm: the precheck takes the initial text out (§19.1)', async () => {
    await start();
    const pending = await draft({ content: '# 週會\n\n## 待辦\n- \n' });
    const text = (await liveNotes.person(pat).read(repository, pending.id)).content;
    liveNotes.type(repository, pending.id, `${text}   \n- \n\n`, pat);
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toEqual({ status: 200, body: { discarded: true } });
    expect(commits()).toEqual([]);
  });

  it('refuses a filed note, an unknown draft, another repository, and an adapter without discard', async () => {
    await start();
    await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: 'notes/life/a.md' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect((await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: 'notes/life/.live/unknown.md' })).status).toBe(404);
    expect(await call('POST', '/api/live/discard', { notebookId: 'other~life', path: 'notes/life/.live/unknown.md' })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect((await liveNotes.service.checkouts(repository)).map(row => row.path)).toEqual(['notes/life/a.md']);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] });
    await start();
    const pending = await draft();
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toMatchObject({ status: 400, body: { code: 'not-live' } });
    expect((await liveNotes.service.checkouts(repository)).map(row => row.id)).toEqual([pending.id]);
  });

  it('asks for the discard again while the editor that was just closed still counts as active', async () => {
    await start();
    const pending = await draft();
    liveNotes.setActive(repository, pending.id, 1);
    const original = liveNotes.service.discard!.bind(liveNotes.service);
    const discard = vi.spyOn(liveNotes.service, 'discard' as never).mockImplementationOnce(
      (async (...args: Parameters<typeof original>) => {
        const answer = await original(...args);
        // The closed frame stops counting before the retry 2 s later.
        liveNotes.setActive(repository, pending.id, 0);
        return answer;
      }) as never,
    );
    expect(await call('POST', '/api/live/discard', { notebookId: 'notes~life', path: pending.path })).toEqual({ status: 200, body: { discarded: true } });
    expect(discard).toHaveBeenCalledTimes(2);
  });

  it('makes 「立即簽回」 and check_in_note answer discarded for an empty draft', async () => {
    await start();
    const first = await draft();
    const checkedIn = await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: first.path });
    expect(checkedIn).toMatchObject({ status: 200, body: { id: first.id, path: null, committed: false, released: true, discarded: true, reason: 'empty' } });
    const second = await draft();
    const token = await grant();
    const listed = (await tools(token)).find(entry => entry.name === 'check_in_note')!;
    expect(listed.outputSchema.properties.reason.enum).toContain('empty');
    expect(listed.outputSchema.properties).toHaveProperty('discarded');
    expect(await tool(token, 'check_in_note', { path: second.path, notebookId: 'notes~life' })).toMatchObject({ path: second.path, committed: false, released: true, discarded: true, reason: 'empty' });
    expect(commits()).toEqual([]);
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('keeps check_in_note as 0.19 listed it where the adapter cannot discard', async () => {
    liveNotes = memoryLiveNotes({ editor: frame, repositories: [{ source: notes, files }] });
    await start();
    const listed = (await tools(await grant())).find(entry => entry.name === 'check_in_note')!;
    expect(listed.outputSchema.properties.reason.enum).toEqual(['leased', 'released', 'unfiled', 'active', 'changed', 'not-synced']);
    expect(listed.outputSchema.properties).not.toHaveProperty('discarded');
  });
});
