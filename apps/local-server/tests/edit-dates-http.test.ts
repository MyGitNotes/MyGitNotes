import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/app.js';
import { deriveAlias, notebookKey } from '@mygitnotes/core';

let root: string, server: Server, base: string;
const nb = (id: string) => notebookKey(deriveAlias(root, new Set()), id);
const git = (date: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
};
const json = async (url: string, init?: RequestInit) => (await fetch(`${base}${url}`, init)).json();

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-edit-dates-'));
  vi.stubEnv('MYGITNOTES_SOURCE', 'local');
  vi.stubEnv('MYGITNOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  const now = '2026-01-01T00:00:00Z';
  git(now, 'init', '-b', 'main');
  git(now, 'config', 'user.name', 'Test');
  git(now, 'config', 'user.email', 'test@example.com');
  write('.mygitnotes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  // The frontmatter says otherwise: Git's dates win for committed notes.
  write('notes/a/old.md', '---\nupdated: "2030-01-01T00:00:00Z"\n---\n# Old\n');
  write('notes/a/new.md', '---\nupdated: "2020-01-01T00:00:00Z"\n---\n# New\n');
  git(now, 'add', '.');
  git(now, 'commit', '-m', 'fixture');
  write('notes/a/new.md', '---\nupdated: "2020-01-01T00:00:00Z"\n---\n# New\nEdited.\n');
  git('2026-03-01T08:00:00+08:00', 'commit', '-am', 'Edit new');
  git('2026-04-01T00:00:00Z', 'mv', 'notes/a/old.md', 'notes/a/moved.md');
  git('2026-04-01T00:00:00Z', 'commit', '-m', 'Move old');
  write('notes/a/draft.md', '---\nupdated: "2026-02-01T00:00:00Z"\n---\n# Draft\n');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('sorts and lists notes by their Git edit date, the frontmatter standing in for a note Git does not hold', async () => {
  const page = await json(`/api/notes/query?notebookId=${encodeURIComponent(nb('a'))}&sort=updated&order=desc`);
  expect(page.notes.map((note: { path: string; lastCommitAt?: string; updated?: string; }) => [note.path, note.lastCommitAt, note.updated])).toEqual([['notes/a/new.md', '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'], ['notes/a/draft.md', undefined, '2026-02-01T00:00:00.000Z'], ['notes/a/moved.md', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']]);
  const looked = await json('/api/notes/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: [{ notebookId: nb('a'), path: 'notes/a/moved.md' }] }) });
  expect(looked.notes[0]).toMatchObject({ lastCommitAt: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' });
});

it('reads a note with its edit date, which an uncommitted change moves to the later frontmatter date', async () => {
  expect((await json('/api/notes/read?path=notes/a/new.md')).note).toMatchObject({ lastCommitAt: '2026-03-01T00:00:00.000Z', updated: '2026-03-01T00:00:00.000Z' });
  write('notes/a/new.md', '---\nupdated: "2026-05-01T00:00:00Z"\n---\n# New\nTyped, not committed.\n');
  expect((await json('/api/notes/read?path=notes/a/new.md')).note).toMatchObject({ lastCommitAt: '2026-03-01T00:00:00.000Z', updated: '2026-05-01T00:00:00.000Z' });
  const listed = (await json(`/api/notes?notebookId=${encodeURIComponent(nb('a'))}`)).notes as { path: string; updated?: string; }[];
  expect(Object.fromEntries(listed.map(note => [note.path, note.updated]))).toEqual({ 'notes/a/new.md': '2026-05-01T00:00:00.000Z', 'notes/a/moved.md': '2026-01-01T00:00:00.000Z', 'notes/a/draft.md': '2026-02-01T00:00:00.000Z' });
});
