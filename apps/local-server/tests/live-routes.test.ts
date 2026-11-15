import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { type EditionSourceConfig, type LiveContext, type LivePersonCalls, sourceIdentity, type WorkspaceConfigSource } from '@mygitnotes/core';
import { remoteTools } from '@mygitnotes/mcp-server';
import { createApp } from '../src/app.js';
import type { EditionSources } from '../src/edition-sources.js';
import { type IdentityService } from '../src/identity.js';
import { isSweepSecret } from '../src/live-routes.js';
import { memoryCommitCounter, memoryCommits, MemoryEditionSource, memoryEditionSources, type MemoryFiles } from '../src/memory-edition-source.js';
import { type MemoryLiveNotes, memoryLiveNotes } from '../src/memory-live-notes.js';
import { createRecordStore, type RecordStore } from '../src/record-store/index.js';
import { workspaceSettings } from './workspace-settings.js';

const manifest = `schema_version: 4\nworkspace:\n  title: Hosted\n  default_notebook: life\nnotebooks:\n  - id: life\n    title: Life\n    root: notes/life\n    templates:\n      - id: registered\n        title: Registered\n        file: kept/registered.md\n`;
const meeting = "---\ntemplate:\n  name: Meeting\n  path: '會議/{{kind}}/{{date}} {{title}}.md'\n  placeholders:\n    kind:\n      default: 其他\n    room: {}\ndate: '{{date}}'\n---\n# {{title}}\n\nKind: {{kind}}, room: {{room}}\n";
const notes: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/notes', branch: 'main', label: 'Notes' };
const other: EditionSourceConfig = { type: 'edition', platform: 'hosted', repository: 'p1/other', branch: 'main', label: 'Other' };
const repository = sourceIdentity(notes);
const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const secret = 'x'.repeat(40);
const pat: LiveContext = { person: { realm: 'edition', userId: 'p1' }, author: { name: 'Pat', email: 'pat@example.test' }, request: { headers: {} } };
/** `x-person` names who is signed in: p1 writes, p2 only reads. */
const identity: IdentityService = { router: Router(), signedIn: async req => typeof req.headers['x-person'] === 'string' ? { person: { realm: 'edition', userId: req.headers['x-person'] }, login: req.headers['x-person'], owner: `edition:${req.headers['x-person']}`, author: { name: 'Pat', email: 'pat@example.test' } } : null, token: async () => undefined, grantCredential: async () => undefined, grantToken: async () => undefined, noCredentialMessage: () => 'No credential.', signInOptions: async () => [], configured: async () => true, signOut: async () => {} };
const configSource: WorkspaceConfigSource = {
  mode: 'remote',
  settings: async () => {
    const settings = workspaceSettings([{ type: 'github', repository: 'owner/site', branch: 'main' }, notes, other]);
    return { ...settings, members: [{ ...settings.members[1], default: true }, settings.members[2]] };
  },
};

let root: string, server: Server, base: string, store: RecordStore, files: MemoryFiles, otherFiles: MemoryFiles, liveNotes: MemoryLiveNotes, deferred: Promise<unknown>[];

const start = async (services: Record<string, unknown> = {}) => {
  const editionSources = memoryEditionSources({ repositories: new Map([['p1/notes', files], ['p1/other', otherFiles]]), mayWrite: person => person.userId === 'p1' });
  server = createServer(createApp(root, { configSource, recordStore: store, remoteCache: undefined, workspaceChoices: null, identity, editionSources, liveNotes, defer: (work: Promise<unknown>) => void deferred.push(work), ...services }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
};
const call = async (method: string, url: string, body?: unknown, person: string | null = 'p1', headers: Record<string, string> = {}) => {
  const response = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(person ? { 'x-person': person } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const json = (response.headers.get('content-type') ?? '').includes('application/json');
  return { status: response.status, body: json && text ? JSON.parse(text) : null, location: response.headers.get('location') };
};
const commits = () => memoryCommits(files).filter(commit => commit.message !== 'Memory state');
const head = async () =>
  (await new MemoryEditionSource(notes, files, true, memoryCommitCounter(files), undefined, async () => {
    throw new Error('unused');
  }).getSnapshot()).sha;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-live-routes-')));
  for (const [key, value] of Object.entries({ SESSION_SECRET: 's'.repeat(64), UPSTASH_REDIS_REST_URL: '', REDIS_URL: '', KV_REST_API_URL: '', MYGITNOTES_STORAGE: '', APP_URL: 'http://localhost', VERCEL: '', MYGITNOTES_PRODUCT_REPOSITORY: '', MYGITNOTES_SOURCE: 'github', MYGITNOTES_LIVE_SWEEP_SECRET: '', MYGITNOTES_LIVE_CHECKIN_AT: 'off', MYGITNOTES_TIMEZONE: '' })) vi.stubEnv(key, value);
  store = createRecordStore(root);
  files = new Map([['.mygitnotes.yaml', manifest], ['notes/life/a.md', '---\ntitle: A\n---\nGit body.\n'], ['notes/life/plan.outline.md', '# Plan\n'], ['notes/life/kept/registered.md', '# {{title}}\n'], ['notes/life/.templates/meeting.md', meeting]]);
  otherFiles = new Map([['.mygitnotes.yaml', manifest], ['notes/life/z.md', '# Z\n']]);
  liveNotes = memoryLiveNotes({ editor, repositories: [{ source: notes, files }] });
  deferred = [];
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/live/checkout', () => {
  it('refuses anyone who may not write live, and notes that keep the direct editor', async () => {
    await start();
    const refused = [[{ notebookId: 'notes~life', path: 'notes/life/a.md' }, null, 403], [{ notebookId: 'notes~life', path: 'notes/life/a.md' }, 'p2', 403], [{ notebookId: 'other~life', path: 'notes/life/z.md' }, 'p1', 400], [{ notebookId: 'notes~life', path: 'notes/life/plan.outline.md' }, 'p1', 400], [{ notebookId: 'notes~life', path: 'notes/life/.templates/meeting.md' }, 'p1', 400], [{ notebookId: 'notes~life', path: 'notes/life/kept/registered.md' }, 'p1', 400], [{ notebookId: 'notes~life', path: 'notes/life/missing.md' }, 'p1', 404]] as const;
    for (const [body, person, status] of refused) {
      const answer = await call('POST', '/api/live/checkout', body, person);
      expect(answer.status, `${person} ${body.path}`).toBe(status);
      if (status === 400) expect(answer.body.code).toBe('not-live');
    }
    expect(await liveNotes.service.checkouts(repository)).toEqual([]);
  });

  it('creates a live note on the Git text, and a second checkout joins it', async () => {
    await start();
    const first = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ outcome: 'created', checkout: { notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, activeEditors: 0, conflict: null } });
    expect(new URL(first.body.checkout.embedUrl).origin).toBe(editor.origin);
    expect(new URL(first.body.checkout.editorUrl).origin).toBe(editor.origin);
    expect((await liveNotes.person(pat).read(repository, first.body.checkout.id)).content).toBe('---\ntitle: A\n---\nGit body.\n');
    const second = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(second.body).toMatchObject({ outcome: 'joined', checkout: { id: first.body.checkout.id } });
  });

  it("answers a pending note's own link by its virtual path, for a writer, until it is filed", async () => {
    await start();
    const { checkout } = (await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Idea', content: 'Some idea\n' })).body;
    const opened = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: checkout.path });
    expect(opened.status).toBe(200);
    expect(opened.body).toEqual({ outcome: 'joined', checkout: { ...checkout, activeEditors: expect.any(Number) } });
    expect((await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: checkout.path }, 'p2')).status).toBe(403);
    expect((await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/.live/unknown.md' })).status).toBe(404);
    liveNotes.type(repository, checkout.id, 'Some idea\nMore.\n', pat);
    expect((await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: checkout.path })).body).toMatchObject({ released: true, filed: true });
    expect((await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: checkout.path })).status).toBe(404);
  });

  it('answers too-large when the editor refuses the note', async () => {
    liveNotes = memoryLiveNotes({ editor, repositories: [{ source: notes, files }], maxBytes: 10 });
    await start();
    const answer = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(answer).toMatchObject({ status: 413, body: { code: 'too-large' } });
  });
});

describe('POST /api/live/new and /api/live/checkin', () => {
  it('creates a pending note from a template with the path values, checks it in, and the virtual path then says where it went', async () => {
    await start();
    const made = await call('POST', '/api/live/new', { notebookId: 'notes~life', folder: '', title: '週會', templateId: 'meeting', values: { kind: '週會' }, clock: { date: '2026-11-20', time: '09:00' } });
    expect(made.status).toBe(200);
    const { checkout } = made.body;
    expect(checkout).toMatchObject({ pending: true, path: `notes/life/.live/${checkout.id}.md`, notebookId: 'notes~life' });
    const [row] = await liveNotes.service.checkouts(repository);
    expect(row.pathRule).toBe('會議/週會/{{date}} {{title}}.md');
    const text = (await liveNotes.person(pat).read(repository, checkout.id)).content;
    expect(text).toContain('template: meeting');
    expect(text).toContain('date: 2026-11-20\n');
    expect(text).toContain('# 週會\n\nKind: 週會, room: {{room}}');
    // A pending note reads live by its virtual path.
    expect((await call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(checkout.path)}`)).body.note).toMatchObject({ title: '週會', live: { pending: true } });
    // The creator's first keystrokes make them an editor of the note.
    liveNotes.type(repository, checkout.id, `${text}Notes.\n`, pat);
    const checkedIn = await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: checkout.path });
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body).toMatchObject({ path: 'notes/life/會議/週會/2026-11-20 週會.md', committed: true, released: true, filed: true, revision: await head() });
    expect(files.get('notes/life/會議/週會/2026-11-20 週會.md')).toBe(`${text}Notes.\n`);
    expect(commits().at(-1)!.author).toEqual({ name: 'Pat', email: 'pat@example.test' });
    const moved = await call('GET', `/api/notes/read?notebookId=notes~life&path=${encodeURIComponent(checkout.path)}`);
    expect(moved).toMatchObject({ status: 404, body: { movedTo: 'notes/life/會議/週會/2026-11-20 週會.md' } });
  });

  it('takes declared defaults into the path rule and keeps the browser text of a note without a template', async () => {
    await start();
    await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'Retro', templateId: 'meeting' });
    const plain = await call('POST', '/api/live/new', { notebookId: 'notes~life', folder: 'inbox', title: 'Idea', content: 'Some idea\n' });
    expect(plain.status).toBe(200);
    const rows = await liveNotes.service.checkouts(repository);
    expect(rows.map(row => row.pathRule)).toEqual(['會議/其他/{{date}} {{title}}.md', 'inbox/{{title}}.md']);
    expect((await liveNotes.person(pat).read(repository, plain.body.checkout.id)).content).toMatch(/^---\ntitle: Idea\n[\s\S]*---\n\nSome idea\n$/);
    expect((await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'X', templateId: 'meeting', values: { nope: '1' } })).status).toBe(400);
    expect((await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'X' }, 'p2')).status).toBe(403);
    expect((await call('POST', '/api/live/new', { notebookId: 'notes~life', title: 'X', folder: '../out' })).status).toBe(400);
  });

  it('checks a checked-out note in for any writer, and refuses readers and notes that are not live', async () => {
    await start();
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    liveNotes.type(repository, body.checkout.id, '# Typed live\n', pat);
    expect((await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: 'notes/life/a.md' }, 'p2')).status).toBe(403);
    expect((await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: 'notes/life/a.md' }, null)).status).toBe(403);
    const done = await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    expect(done.body).toMatchObject({ path: 'notes/life/a.md', committed: true, released: true });
    expect(files.get('notes/life/a.md')).toBe('# Typed live\n');
    expect((await call('POST', '/api/live/checkin', { notebookId: 'notes~life', path: 'notes/life/a.md' })).status).toBe(409);
  });
});

describe('POST /api/live/sweep', () => {
  it('is 404 without a secret, 401 on a wrong one, and checks due notes in with the right one', async () => {
    await start();
    expect((await call('POST', '/api/live/sweep', undefined, null, { authorization: `Bearer ${secret}` })).status).toBe(404);
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.stubEnv('MYGITNOTES_LIVE_SWEEP_SECRET', secret);
    await start();
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    liveNotes.type(repository, body.checkout.id, '# Swept\n', pat);
    for (const authorization of [undefined, 'Bearer short', `Bearer ${secret}x`, `Basic ${secret}`]) expect((await call('POST', '/api/live/sweep', undefined, null, authorization ? { authorization } : {})).status, authorization).toBe(401);
    const accepted = await call('POST', '/api/live/sweep', undefined, null, { authorization: `Bearer ${secret}` });
    expect(accepted.status).toBe(202);
    expect(deferred).toHaveLength(1);
    await deferred[0];
    expect(files.get('notes/life/a.md')).toBe('# Swept\n');
    const again = await call('POST', '/api/live/sweep?wait=1', undefined, null, { authorization: `Bearer ${secret}` });
    expect(again).toMatchObject({ status: 200, body: { due: 0, results: [], failed: [] } });
  });

  it('compares the secret over equal-length digests', () => {
    expect(isSweepSecret(secret, secret)).toBe(true);
    expect(isSweepSecret('', secret)).toBe(false);
    expect(isSweepSecret(`${secret}${secret}`, secret)).toBe(false);
  });
});

describe('GET /live/open', () => {
  it('redirects to the note page, and anything it cannot resolve home, reflecting nothing', async () => {
    await start();
    const open = (query: Record<string, string>) => call('GET', `/live/open?${new URLSearchParams(query)}`);
    expect((await open({ repository, notebook: 'notes~life', path: 'notes/life/a.md' })).location).toBe('/notebooks/notes~life/notes/a.md');
    // The key's local part resolves inside the repository, as the editor may hold another alias.
    expect((await open({ repository, notebook: 'elsewhere~life', path: 'notes/life/會議/x y.md' })).location).toBe(`/notebooks/notes~life/notes/${encodeURIComponent('會議')}/${encodeURIComponent('x y')}.md`);
    for (const query of [{ repository: '<script>', notebook: 'notes~life', path: 'notes/life/a.md' }, { repository, notebook: 'notes~life', path: 'notes/life/../../etc/passwd.md' }, { repository, notebook: 'nope', path: 'notes/life/a.md' }, { repository, notebook: 'notes~life', path: 'https://evil.example/x.md' }, { repository, notebook: 'notes~life', path: 'notes/life/a.png' }, { repository, notebook: 'notes~life' } as Record<string, string>]) {
      const answer = await open(query);
      expect(answer.status).toBe(302);
      expect(answer.location, JSON.stringify(query)).toBe('/');
    }
  });
});

describe('the workspace and an editor outage', () => {
  it("names each repository's editor, and an outage fails only live reads with a fixed message", async () => {
    const open: EditionSources = { open: (source, { person }, cache, scope) => new MemoryEditionSource(source, source.repository === 'p1/notes' ? files : otherFiles, Boolean(person), memoryCommitCounter(source.repository === 'p1/notes' ? files : otherFiles), cache, scope) };
    await start({ editionSources: open });
    const workspace = await call('GET', '/api/workspace');
    expect(workspace.body.repositories.map((entry: { live: unknown; }) => entry.live)).toEqual([editor, null]);
    const person = liveNotes.person.bind(liveNotes);
    vi.spyOn(liveNotes, 'person').mockImplementation(context =>
      ({
        ...person(context),
        checkouts: async () => {
          throw new Error('ECONNREFUSED 10.0.0.7 adapter secret detail');
        },
      }) as LivePersonCalls
    );
    const read = await call('GET', '/api/notes/read?notebookId=notes~life&path=notes/life/a.md');
    expect(read).toMatchObject({ status: 502, body: { error: 'Live editor unavailable.' } });
    expect((await call('GET', '/api/workspace')).status).toBe(200);
    expect((await call('GET', '/api/folders')).status).toBe(200);
    expect((await call('GET', '/api/notes/read?notebookId=notes~life&path=notes/life/a.md', undefined, null)).body.note.title).toBe('A');
  });
});

describe('POST /api/notes', () => {
  it('takes no internal live revision, which only the hosted router hands on', async () => {
    await start();
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    const id = body.checkout.id as string;
    const text = await liveNotes.person(pat).read(repository, id);
    const answer = await call('POST', '/api/notes', { notebookId: 'notes~life', path: 'notes/life/a.md', content: 'Forged.\n', metadata: { title: 'A' }, revision: `live:${id}:${text.contentHash}:${text.liveRevision}` });
    expect(answer).toMatchObject({ status: 409, body: { code: 'checked-out' } });
    expect((await liveNotes.person(pat).read(repository, id)).content).toBe(text.content);
    expect(commits()).toEqual([]);
  });
});

describe('MCP check_in_note', () => {
  const grant = async (write: boolean) => {
    const made = await call('POST', '/api/auth/agent-token', { name: 'client', write });
    if (made.status !== 200) throw new Error(`agent-token: ${made.status} ${JSON.stringify(made.body)}`);
    return made.body.token as string;
  };
  const rpc = async (token: string, method: string, params: object) => {
    const answer = await (await fetch(`${base}/mcp/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
    if (!answer.result) throw new Error(`MCP ${method}: ${JSON.stringify(answer)}`);
    return answer.result;
  };

  it('checks a note in for a write grant and is not offered to a read-only one', async () => {
    await start();
    const { body } = await call('POST', '/api/live/checkout', { notebookId: 'notes~life', path: 'notes/life/a.md' });
    liveNotes.type(repository, body.checkout.id, '# From MCP\n', pat);
    const reader = await grant(false);
    expect((await rpc(reader, 'tools/list', {})).tools.map((tool: { name: string; }) => tool.name)).not.toContain('check_in_note');
    expect((await rpc(reader, 'tools/call', { name: 'check_in_note', arguments: { path: 'notes/life/a.md', notebookId: 'notes~life' } })).isError).toBe(true);
    expect(files.get('notes/life/a.md')).toBe('---\ntitle: A\n---\nGit body.\n');
    const writer = await grant(true);
    expect((await rpc(writer, 'tools/list', {})).tools.map((tool: { name: string; }) => tool.name)).toContain('check_in_note');
    const result = await rpc(writer, 'tools/call', { name: 'check_in_note', arguments: { path: 'notes/life/a.md', notebookId: 'notes~life' } });
    expect(result.isError, JSON.stringify(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ path: 'notes/life/a.md', committed: true, released: true, commit: await head(), revision: expect.stringMatching(/^v1\./) });
    expect(files.get('notes/life/a.md')).toBe('# From MCP\n');
    const again = await rpc(writer, 'tools/call', { name: 'check_in_note', arguments: { path: 'notes/life/a.md', notebookId: 'notes~life' } });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toMatch(/not being edited live/);
  });

  it('lists the tools as before live notes, with no check_in_note or 編輯中, where no live editor is configured', async () => {
    await start({ liveNotes: undefined });
    const writer = await grant(true);
    const { tools } = await rpc(writer, 'tools/list', {});
    expect(tools).toEqual(JSON.parse(JSON.stringify(remoteTools)));
    expect(JSON.stringify(tools)).not.toMatch(/check_in_note|編輯中/);
    const refused = await rpc(writer, 'tools/call', { name: 'check_in_note', arguments: { path: 'notes/life/a.md', notebookId: 'notes~life' } });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text)).toEqual({ error: 'This operation is unavailable for a remote source.' });
  });
});
