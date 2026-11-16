import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { assetHash, deriveAlias, GitHubSource, notebookKey, type RemoteChange } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

// A workspace whose notes total more than 32 MiB: a move changes only what links to the moved note.
vi.setConfig({ testTimeout: 60000 });
const MiB = 1024 * 1024;
const CONFIG = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n';
/** About 1 MiB of prose that names neither the moved note nor a path near it. */
const filler = (i: number) => Buffer.from(`# Filler ${i}\n\n` + `lorem ipsum dolor sit amet ${i}\n`.repeat(Math.floor(MiB / 30)));
const largeWorkspace = () => {
  const files = new Map<string, Buffer>([['.github-notes.yaml', Buffer.from(CONFIG)]]);
  for (let i = 0; i < 36; i++) files.set(`notes/a/bulk/filler-${i}.md`, filler(i));
  files.set('notes/a/target.md', Buffer.from('# Target\n\n[Back](linker.md)\n'));
  files.set('notes/a/linker.md', Buffer.from('# Linker\n\nSee [the target](target.md#part) and [again](./target.md).\n'));
  files.set('notes/a/mention.md', Buffer.from('# Mention\n\nAn unrelated [path](other/path.md).\n'));
  return files;
};
/** Notes that all link to the moved note, more than 32 MiB together, each under the 5 MiB read limit. */
const linkingWorkspace = () => {
  const files = new Map<string, Buffer>([['.github-notes.yaml', Buffer.from(CONFIG)], ['notes/a/target.md', Buffer.from('# Target\n')]]);
  for (let i = 0; i < 8; i++) files.set(`notes/a/bulk/linker-${i}.md`, Buffer.concat([Buffer.from(`[T](../target.md)\n`), filler(i), filler(i + 100), filler(i + 200), filler(i + 300)]));
  return files;
};
const RETAINED = /more than 32 MiB of files that may link to the moved path/;

let server: Server | undefined, root: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const listen = async (app: ReturnType<typeof createApp>) => {
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
};
const move = async (base: string, notebookId: string, command: Record<string, unknown>) => {
  const { revision } = await fetch(base + `/api/files?notebookId=${notebookId}`).then(r => r.json());
  return fetch(base + '/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: { notebookId, kind: 'move', ...command }, revision }) });
};

const local = async (files: Map<string, Buffer>) => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-large-'));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(root, '.github-notes.yaml'), CONFIG);
  git('add', '.');
  git('commit', '-m', 'fixture');
  for (const [file, bytes] of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), bytes);
  }
  return { base: await listen(createApp(root)), notebookId: notebookKey(deriveAlias(root, new Set()), 'a'), read: (file: string) => fs.readFileSync(path.join(root!, file), 'utf8'), exists: (file: string) => fs.existsSync(path.join(root!, file)) };
};

const remote = async (files: Map<string, Buffer>) => {
  let revision = 'one';
  const published: RemoteChange[][] = [];
  const blobs = new Map([...files.values()].map(bytes => [assetHash(bytes), bytes]));
  const prototype = GitHubSource.prototype as any;
  vi.spyOn(prototype, 'loadSnapshot').mockImplementation(async () => {
    const dirs = new Set<string>();
    for (const file of files.keys()) {
      const parts = file.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    return { sha: revision, treeSha: revision, info: { private: true, permissions: { push: true }, default_branch: 'main' }, entries: [...[...dirs].map(path => ({ path, type: 'tree', mode: '040000', sha: path })), ...[...files].map(([path, bytes]) => ({ path, type: 'blob', mode: '100644', sha: assetHash(bytes), size: bytes.length }))] };
  });
  vi.spyOn(prototype, 'readBlob').mockImplementation(async (...args: unknown[]) => blobs.get(args[0] as string)!);
  const prefetch = vi.spyOn(prototype, 'prefetchFiles');
  vi.spyOn(prototype, 'publishChanges').mockImplementation(async (...args: unknown[]) => {
    const changes = args[0] as RemoteChange[];
    published.push(changes);
    for (const change of changes) {
      if (change.sha === null) files.delete(change.path);
      else files.set(change.path, change.content !== undefined ? Buffer.from(change.content) : blobs.get(change.sha!)!);
    }
    return revision += '-next';
  });
  vi.stubEnv('MYGITNOTES_SOURCE', 'github');
  vi.stubEnv('MYGITNOTES_REPOSITORY', 'example/notes');
  vi.stubEnv('MYGITNOTES_BRANCH', 'main');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
  return { base: await listen(createApp(process.cwd())), notebookId: 'notes~a', published, prefetch, read: (file: string) => files.get(file)!.toString('utf8'), exists: (file: string) => files.has(file) };
};

it('moves a note in a local workspace whose notes total more than 32 MiB, rewriting only the notes that link to it', async () => {
  const w = await local(largeWorkspace());
  const response = await move(w.base, w.notebookId, { path: 'notes/a/target.md', destination: 'notes/a/moved.md' });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(w.exists('notes/a/target.md')).toBe(false);
  expect(w.read('notes/a/moved.md')).toBe('# Target\n\n[Back](linker.md)\n');
  expect(w.read('notes/a/linker.md')).toBe('# Linker\n\nSee [the target](moved.md#part) and [again](moved.md).\n');
  expect(w.read('notes/a/mention.md')).toBe('# Mention\n\nAn unrelated [path](other/path.md).\n');
  expect(w.read('notes/a/bulk/filler-3.md')).toBe(filler(3).toString('utf8'));
});

it('refuses a local move whose linking notes total more than 32 MiB, naming the cause', async () => {
  const w = await local(linkingWorkspace());
  const response = await move(w.base, w.notebookId, { path: 'notes/a/target.md', destination: 'notes/a/moved.md' });
  expect(response.status).toBe(413);
  expect((await response.json()).error).toMatch(RETAINED);
  expect(w.exists('notes/a/target.md')).toBe(true);
});

it('moves a note in a GitHub workspace whose notes total more than 32 MiB with batched reads, publishing only the linking note', async () => {
  const w = await remote(largeWorkspace());
  const response = await move(w.base, w.notebookId, { path: 'notes/a/target.md', destination: 'notes/a/moved.md' });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(w.read('notes/a/linker.md')).toBe('# Linker\n\nSee [the target](moved.md#part) and [again](moved.md).\n');
  expect(w.read('notes/a/mention.md')).toBe('# Mention\n\nAn unrelated [path](other/path.md).\n');
  expect(w.published).toHaveLength(1);
  expect(w.published[0].map(change => change.path).sort()).toEqual(['notes/a/linker.md', 'notes/a/moved.md', 'notes/a/target.md']);
  // Reads are batched, a few prefetches for the whole workspace rather than one per note.
  expect(w.prefetch.mock.calls.length).toBeGreaterThan(0);
  expect(w.prefetch.mock.calls.length).toBeLessThan(10);
});

it('refuses a GitHub move whose linking notes total more than 32 MiB, naming the cause', async () => {
  const w = await remote(linkingWorkspace());
  const response = await move(w.base, w.notebookId, { path: 'notes/a/target.md', destination: 'notes/a/moved.md' });
  expect(response.status).toBe(413);
  expect((await response.json()).error).toMatch(RETAINED);
  expect(w.published).toHaveLength(0);
});
