import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { assetHash, deriveAlias, GitHubSource, GitLabSource, notebookKey } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

vi.mock('../src/auth.js', async original => ({ ...await original<typeof import('../src/auth.js')>(), authToken: async () => 'fixture-token' }));

const MANIFEST = 'schema_version: 4\nworkspace:\n  title: Test\n  default_notebook: a\nexclude:\n  - "**/analysis/**"\nnotebooks:\n  - id: a\n    title: A\n    root: docs\n';
/** One notebook of every kind of file a note can link, and a folder the manifest excludes. */
const FILES: Record<string, string | Buffer> = { 'docs/note.md': '# Note\n\nkeyword\n', 'docs/guide/other.md': '# Other\n\nkeyword\n', 'docs/db/schema.sql': 'select 1;\n', 'docs/cfg/deploy.yml': 'name: deploy\n', 'docs/src/main.ts': 'export const x = 1;\n', 'docs/data/table.csv': 'a,b\n1,2\n', 'docs/out/index.html': '<script>alert(1)</script><h1>Report</h1>', 'docs/spec.pdf': Buffer.from('%PDF-1.4 fixture'), 'docs/bundle.zip': Buffer.from([80, 75, 3, 4, 0]), 'docs/analysis/report.md': '# Report\n\nkeyword\n', 'docs/guide/analysis/deep.md': '# Deep\n\nkeyword\n', 'docs/analysis/query.sql': 'select 2;\n', 'docs/AGENTS.md': '# Rules\n' };
// Every raw answer may be framed by the app alone; a PDF is the one kind that goes out without the sandbox.
const TEXT = 'text/plain; charset=utf-8', SANDBOX = "default-src 'none'; sandbox; frame-ancestors 'self'", PDF_POLICY = "default-src 'none'; frame-ancestors 'self'";
const NOT_A_NOTE = { status: 403, error: 'Path is not a configured note.' };

/** What the raw routes answer for the linkable files, whichever way the workspace is served. */
function expectLinkableFiles(raw: (file: string) => Promise<{ status: number; type: string | null; policy: string | null; sniff: string | null; frame: string | null; body: Buffer; disposition: string | null; }>) {
  return async () => {
    const sql = await raw('docs/db/schema.sql');
    // Plain text that looks like a page, and a PDF sent without the sandbox, are safe only while the browser may not
    // guess another type, so each answer says so itself.
    expect(sql).toMatchObject({ status: 200, type: TEXT, policy: SANDBOX, sniff: 'nosniff' });
    expect(sql.body.toString()).toBe('select 1;\n');
    expect(sql.disposition).toBeNull();
    for (const file of ['docs/cfg/deploy.yml', 'docs/src/main.ts', 'docs/data/table.csv']) expect([file, (await raw(file)).type]).toEqual([file, TEXT]);
    // A PDF opens inline as a PDF; the browser's viewer refuses a document under the sandbox directive.
    expect(await raw('docs/spec.pdf')).toMatchObject({ status: 200, type: 'application/pdf', policy: PDF_POLICY, sniff: 'nosniff', frame: null, body: Buffer.from('%PDF-1.4 fixture') });
    // A page is sandboxed: no script runs, and it shares no origin with the app.
    expect(await raw('docs/out/index.html')).toMatchObject({ status: 200, type: 'text/html; charset=utf-8', policy: SANDBOX, sniff: 'nosniff' });
    expect((await raw('docs/bundle.zip')).policy).toBe(SANDBOX);
    // An excluded path is no note but is still a file of the notebook.
    expect(await raw('docs/analysis/report.md')).toMatchObject({ status: 200, type: TEXT, policy: SANDBOX, sniff: 'nosniff' });
    expect((await raw('docs/analysis/query.sql')).status).toBe(200);
    // The notebook's protected files stay protected, and a missing file is missing.
    expect([403, 404]).toContain((await raw('docs/AGENTS.md')).status);
    expect((await raw('docs/db/missing.sql')).status).toBe(404);
    expect((await raw('other/schema.sql')).status).toBe(403);
  };
}

describe('links to a notebook’s files, on a local workspace', () => {
  let root: string, server: Server, base: string;
  const nb = (id: string) => notebookKey(deriveAlias(root, new Set()), id);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-file-links-'));
    vi.stubEnv('MYGITNOTES_SOURCE', 'local');
    vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('APP_URL', '');
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    for (const [file, content] of Object.entries({ '.mygitnotes.yaml': MANIFEST, ...FILES })) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '.');
    git('commit', '-m', 'fixture');
    server = createServer(createApp(root));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (root) fs.rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const fetched = async (url: string) => {
    const response = await fetch(base + url);
    return { status: response.status, type: response.headers.get('content-type'), policy: response.headers.get('content-security-policy'), sniff: response.headers.get('x-content-type-options'), frame: response.headers.get('x-frame-options'), disposition: response.headers.get('content-disposition'), body: Buffer.from(await response.arrayBuffer()) };
  };

  it('serves text as plain text, a PDF inline, a page sandboxed, by the raw asset route', async () => {
    await expectLinkableFiles(file => fetched(`/raw-assets/${file}?notebook=${nb('a')}`))();
  });

  it('serves the same through the file manager’s raw route, and downloads on request', async () => {
    await expectLinkableFiles(file => fetched(`/api/files/raw?notebookId=${nb('a')}&path=${encodeURIComponent(file)}`))();
    expect((await fetched(`/api/files/raw?notebookId=${nb('a')}&path=docs/db/schema.sql&download=1`)).disposition).toContain('attachment; filename="schema.sql"');
  });

  it('lists only the notes the manifest leaves: not a plain file, not an excluded note, in the query, the search and the lookup', async () => {
    const query = await fetch(`${base}/api/notes/query?notebookId=${nb('a')}&limit=50&showHidden=1`).then(r => r.json());
    expect(query.notes.map((note: { path: string; }) => note.path).sort()).toEqual(['docs/guide/other.md', 'docs/note.md']);
    const searched = await fetch(`${base}/api/notes/query?notebookId=${nb('a')}&limit=50&q=keyword`).then(r => r.json());
    expect(searched.notes.map((note: { path: string; }) => note.path).sort()).toEqual(['docs/guide/other.md', 'docs/note.md']);
    const lookup = await fetch(`${base}/api/notes/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: ['docs/note.md', 'docs/analysis/report.md', 'docs/db/schema.sql'].map(file => ({ notebookId: nb('a'), path: file })) }) }).then(r => r.json());
    expect(lookup.notes.map((note: { path: string; }) => note.path)).toEqual(['docs/note.md']);
    const folders = await fetch(`${base}/api/folder-manager?notebookId=${nb('a')}`).then(r => r.json());
    expect(JSON.stringify(folders)).not.toContain('analysis');
  });

  it('reads a linked file by the file manager, which tells text from a binary, and keeps excluded folders out of the note folders', async () => {
    const read = (file: string) => fetch(`${base}/api/files/read?notebookId=${nb('a')}&path=${encodeURIComponent(file)}`).then(async r => ({ status: r.status, ...await r.json() }));
    expect(await read('docs/db/schema.sql')).toMatchObject({ status: 200, content: 'select 1;\n' });
    expect(await read('docs/analysis/report.md')).toMatchObject({ status: 200, content: '# Report\n\nkeyword\n' });
    expect(await read('docs/spec.pdf')).toMatchObject({ status: 200, content: null });
    const listing = await fetch(`${base}/api/files?notebookId=${nb('a')}`).then(r => r.json());
    const entry = (file: string) => listing.entries.find((candidate: { path: string; }) => candidate.path === file);
    expect(entry('docs/analysis')).toMatchObject({ directory: true, noteDirectory: false });
    expect(entry('docs/guide')).toMatchObject({ directory: true, noteDirectory: true });
    expect(entry('docs/guide/analysis')).toMatchObject({ noteDirectory: false });
  });

  it('refuses an excluded path and a plain file as a note, to read, save, delete or restore, and leaves the file alone', async () => {
    const call = async (method: string, url: string, body?: unknown) => {
      const response = await fetch(base + url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      return { status: response.status, ...await response.json() };
    };
    const head = () => git('rev-parse', 'HEAD').toString().trim();
    // What a remote workspace answers: only a note, an outline, a compilation or a template is one, so neither is an image,
    // a file of the assets folder or an agent's file, excluded or not.
    const others: Record<string, string | Buffer> = { 'docs/pic.png': Buffer.from([137, 80, 78, 71]), 'docs/analysis/pic.png': Buffer.from([137, 80, 78, 71]), 'docs/assets/x.md': '# Asset\n', 'docs/analysis/AGENTS.md': '# Rules\n', 'docs/guide/docs/agent/x.md': '# Agent\n' };
    for (const [file, content] of Object.entries(others)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    git('add', '.');
    git('commit', '-m', 'other files');
    const before = head();
    for (const file of ['docs/analysis/report.md', 'docs/guide/analysis/deep.md', 'docs/db/schema.sql', 'docs/spec.pdf', 'docs/out/index.html', 'docs/bundle.zip', ...Object.keys(others)]) {
      const content = fs.readFileSync(path.join(root, file));
      // The workspace guard ahead of the note routes already refuses an agent's file, in its own words.
      const refused = /(^|\/)(AGENTS\.md|docs\/agent\/.*)$/.test(file) ? { status: 403, error: 'Path is outside configured workspace resources.' } : NOT_A_NOTE;
      expect([file, await call('GET', `/api/notes/read?path=${encodeURIComponent(file)}`)]).toEqual([file, refused]);
      expect([file, await call('GET', `/api/notes/read?notebookId=${nb('a')}&path=${encodeURIComponent(file)}`)]).toEqual([file, refused]);
      expect([file, await call('POST', '/api/notes', { path: file, content: 'overwritten', metadata: { title: 'x' } })]).toEqual([file, refused]);
      expect([file, await call('POST', '/api/notes', { path: file, content: 'overwritten', noCommit: true })]).toEqual([file, refused]);
      expect([file, await call('POST', '/api/notes/restore', { path: file, content: 'overwritten' })]).toEqual([file, refused]);
      expect([file, await call('POST', '/api/notes/restore', { path: file })]).toEqual([file, refused]);
      expect([file, await call('DELETE', `/api/notes?path=${encodeURIComponent(file)}`)]).toEqual([file, refused]);
      expect([file, await call('DELETE', `/api/notes?noCommit=true&path=${encodeURIComponent(file)}`)]).toEqual([file, refused]);
      expect(fs.readFileSync(path.join(root, file)).equals(content)).toBe(true);
    }
    // A new note cannot be created under an excluded folder either.
    expect(await call('POST', '/api/notes', { path: 'docs/analysis/new.md', content: 'new', createOnly: true })).toEqual(NOT_A_NOTE);
    expect(fs.existsSync(path.join(root, 'docs/analysis/new.md'))).toBe(false);
    expect(head()).toBe(before);
    expect(git('status', '--porcelain').toString()).toBe('');
    // A note is still read, saved and deleted as one.
    expect(await call('GET', '/api/notes/read?path=docs/note.md')).toMatchObject({ status: 200, note: { path: 'docs/note.md' } });
    expect(await call('POST', '/api/notes', { path: 'docs/guide/new.md', content: 'new', createOnly: true })).toMatchObject({ status: 200, committed: true });
    expect(await call('DELETE', '/api/notes?path=docs/guide/new.md')).toMatchObject({ status: 200, committed: true });
    // A text note and a template of the notebook are notes to these routes too.
    expect(await call('POST', '/api/notes', { path: 'docs/guide/plain.txt', content: 'plain', createOnly: true })).toMatchObject({ status: 200, committed: true });
    expect(await call('GET', '/api/notes/read?path=docs/guide/plain.txt')).toMatchObject({ status: 200, note: { path: 'docs/guide/plain.txt' } });
    expect(await call('POST', '/api/notes', { path: 'docs/.templates/meeting.md', content: '# {{title}}\n', createOnly: true })).toMatchObject({ status: 200, committed: true });
    expect(await call('GET', '/api/notes/read?path=docs/.templates/meeting.md')).toMatchObject({ status: 200 });
  });
});

describe.each(['github', 'gitlab'] as const)('links to a notebook’s files, on a %s workspace', provider => {
  let server: Server, base: string;
  const nb = (id: string) => `notes~${id}`;
  beforeEach(async () => {
    const files = new Map<string, Buffer>([['.mygitnotes.yaml', Buffer.from(MANIFEST)], ...Object.entries(FILES).map(([file, content]) => [file, Buffer.from(content)] as [string, Buffer])]);
    const prototype = (provider === 'github' ? GitHubSource : GitLabSource).prototype as any;
    vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => {
      const dirs = new Set<string>();
      for (const file of files.keys()) {
        const parts = file.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      return { sha: 'head', treeSha: 'head', info: { private: true, permissions: { push: false }, default_branch: 'main' }, entries: [...[...dirs].map(entry => ({ path: entry, type: 'tree', mode: '040000', sha: entry })), ...[...files].map(([entry, bytes]) => ({ path: entry, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length }))] };
    });
    vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => [...files.values()].find(bytes => assetHash(bytes) === args[0])!);
    vi.stubEnv('MYGITNOTES_SOURCE', provider);
    vi.stubEnv('MYGITNOTES_REPOSITORY', 'example/notes');
    vi.stubEnv('MYGITNOTES_BRANCH', 'main');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('VERCEL', '');
    server = createServer(createApp(process.cwd()));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const fetched = async (url: string) => {
    const response = await fetch(base + url);
    return { status: response.status, type: response.headers.get('content-type'), policy: response.headers.get('content-security-policy'), sniff: response.headers.get('x-content-type-options'), frame: response.headers.get('x-frame-options'), disposition: response.headers.get('content-disposition'), body: Buffer.from(await response.arrayBuffer()) };
  };

  it('serves text as plain text, a PDF inline, a page sandboxed, and lists no file or excluded path as a note', async () => {
    await expectLinkableFiles(file => fetched(`/raw-assets/${file}?notebook=${nb('a')}`))();
    await expectLinkableFiles(file => fetched(`/api/files/raw?notebookId=${nb('a')}&path=${encodeURIComponent(file)}`))();
    const query = await fetch(`${base}/api/notes/query?notebookId=${nb('a')}&limit=50&showHidden=1`).then(r => r.json());
    expect(query.notes.map((note: { path: string; }) => note.path).sort()).toEqual(['docs/guide/other.md', 'docs/note.md']);
    const searched = await fetch(`${base}/api/notes/query?notebookId=${nb('a')}&limit=50&q=keyword`).then(r => r.json());
    expect(searched.notes.map((note: { path: string; }) => note.path).sort()).toEqual(['docs/guide/other.md', 'docs/note.md']);
    // The same refusal, in the same words, as a local workspace gives.
    for (const file of ['docs/analysis/report.md', 'docs/db/schema.sql']) {
      const response = await fetch(`${base}/api/notes/read?notebookId=${nb('a')}&path=${encodeURIComponent(file)}`);
      expect([file, { status: response.status, ...await response.json() }]).toEqual([file, NOT_A_NOTE]);
    }
  });
});
