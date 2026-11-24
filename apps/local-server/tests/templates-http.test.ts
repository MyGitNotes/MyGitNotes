import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { createApp } from '../src/app.js';
import { deriveAlias, notebookKey, parseNoteContent } from '@mygitnotes/core';

let root: string;
const nb = (id: string) => notebookKey(deriveAlias(root, new Set()), id);
let server: Server;
let base: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
const READING = '---\ntemplate:\n  name: Reading\n  description: Notes on a book\n  placeholders:\n    book: The book\n    author:\n      description: Who wrote it\n      default: Unknown\ntags: [reading]\nauthor: "{{author}}"\n---\n# {{title}}\n\n{{date}} {{time}} {{book}}\n';
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-templates-http-'));
  vi.stubEnv('GITHUB_NOTES_SOURCE', 'local');
  vi.stubEnv('GITHUB_NOTES_LOCAL_PATH', root);
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(64));
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  for (const [file, content] of Object.entries({ 'notes/.github-notes.yaml': 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: example\nnotebooks:\n  - id: example\n    title: Example\n    root: notes/example\n    templates:\n      - id: registered\n        title: Registered\n        file: kept/registered.md\n', 'notes/example/note.md': '# Note\n', 'notes/example/kept/registered.md': '# {{title}}\n', 'notes/example/.templates/reading.md': READING, 'notes/example/.templates/nested/deep.md': '# Deep\n', 'notes/example/.other/secret.md': '# Secret\n' })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  server = createServer(createApp(root));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('lists a notebook’s templates without a manifest change and keeps them out of notes, queries and folders', async () => {
  const listed = await fetch(`${base}/api/templates?notebookId=${nb('example')}`).then(r => r.json());
  expect(listed.templates.map((template: { id: string; source: string; name: string; file: string; notebookId: string; }) => [template.id, template.source, template.name, template.file, template.notebookId])).toEqual([['registered', 'manifest', 'Registered', 'notes/example/kept/registered.md', nb('example')], ['reading', 'file', 'Reading', 'notes/example/.templates/reading.md', nb('example')]]);
  expect(listed.templates[1]).toMatchObject({ description: 'Notes on a book', placeholders: expect.arrayContaining([{ name: 'book', description: 'The book', declared: true }]) });
  expect((await fetch(`${base}/api/templates`)).status).toBe(400);
  const notes = await fetch(`${base}/api/notes?notebookId=${nb('example')}`).then(r => r.json());
  expect(notes.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/example/note.md']);
  const query = await fetch(`${base}/api/notes/query?notebookId=${nb('example')}`).then(r => r.json());
  expect(JSON.stringify(query)).not.toContain('.templates');
  const search = await fetch(`${base}/api/notes/query?notebookId=${nb('example')}&q=${encodeURIComponent('{{title}}')}`).then(r => r.json());
  expect(JSON.stringify(search)).not.toContain('.templates');
  const folders = await fetch(`${base}/api/folders`).then(r => r.json());
  expect(folders.folders.map((folder: { path: string; }) => folder.path)).toEqual(['kept']);
});

it('dates each template’s last use by the notes that carry its id, as the New note menu stamps them', async () => {
  const used = async () => Object.fromEntries((await fetch(`${base}/api/templates?notebookId=${nb('example')}`).then(r => r.json())).templates.map((template: { id: string; lastUsed: string | null; }) => [template.id, template.lastUsed]));
  expect(await used()).toEqual({ registered: null, reading: null });
  expect((await fetch(`${base}/api/notes`, json({ path: 'notes/example/untitled.md', notebookId: nb('example'), createOnly: true, noCommit: true, content: '# Untitled\n', metadata: { template: 'reading' } }))).status).toBe(200);
  expect(await used()).toEqual({ registered: null, reading: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  // The stamped note is an ordinary note: it lists as one, and names no new template.
  expect((await fetch(`${base}/api/notes?notebookId=${nb('example')}`).then(r => r.json())).notes.map((note: { path: string; }) => note.path)).toEqual(['notes/example/note.md', 'notes/example/untitled.md']);
});

it('renders a .templates file with the page’s date and time, other placeholders left literal and the template block dropped', async () => {
  const rendered = await fetch(`${base}/api/templates/render?notebookId=${nb('example')}&templateId=reading&title=${encodeURIComponent('My Note')}&date=2026-11-14&time=${encodeURIComponent('09:30')}`).then(r => r.json());
  // The New note menu fills the title, date and time only: a declared default stays unapplied, for the writer.
  expect(rendered).toEqual({ metadata: { tags: ['reading'], author: '{{author}}', title: 'My Note' }, content: '# My Note\n\n2026-11-14 09:30 {{book}}\n', unfilled: ['author', 'book'] });
  const clock = await fetch(`${base}/api/templates/render?notebookId=${nb('example')}&templateId=reading&title=T`).then(r => r.json());
  expect(clock.content).toMatch(/^# T\n\n\d{4}-\d{2}-\d{2} \d{2}:\d{2} \{\{book\}\}\n$/);
  expect((await fetch(`${base}/api/templates/render?notebookId=${nb('example')}&templateId=deep&title=x`)).status).toBe(400);
});

it('opens, saves, renames and deletes a template file through the note and file routes, and no other dot path', async () => {
  const file = 'notes/example/.templates/reading.md';
  const lookup = await fetch(`${base}/api/notes/lookup`, json({ notes: [{ notebookId: nb('example'), path: file }, { notebookId: nb('example'), path: 'notes/example/kept/registered.md' }, { notebookId: nb('example'), path: 'notes/example/.other/secret.md' }, { notebookId: nb('example'), path: 'notes/example/.templates/nested/deep.md' }], content: true })).then(r => r.json());
  expect(lookup.notes.map((note: { path: string; }) => note.path)).toEqual([file, 'notes/example/kept/registered.md']);
  expect(lookup.notes[0]).toMatchObject({ notebookId: nb('example'), content: '# {{title}}\n\n{{date}} {{time}} {{book}}\n', metadata: { template: { name: 'Reading' } } });
  expect((await fetch(`${base}/api/notes/read?path=${file}&notebookId=${nb('example')}`).then(r => r.json())).note.metadata.template).toMatchObject({ name: 'Reading' });

  // A new template is written to the working tree and listed at once; Changes can manage it.
  const created = await fetch(`${base}/api/notes`, json({ path: 'notes/example/.templates/Meeting notes.md', notebookId: nb('example'), createOnly: true, noCommit: true, content: '# {{title}}\n', metadata: { template: { name: 'Meeting notes', description: '' } } }));
  expect(created.status).toBe(200);
  expect(parseNoteContent(fs.readFileSync(path.join(root, 'notes/example/.templates/Meeting notes.md'), 'utf8')).metadata).toMatchObject({ template: { name: 'Meeting notes' } });
  expect((await fetch(`${base}/api/templates?notebookId=${nb('example')}`).then(r => r.json())).templates.map((template: { id: string; }) => template.id)).toEqual(['registered', 'Meeting notes', 'reading']);
  expect((await fetch(`${base}/api/notes`, json({ path: 'notes/example/.templates/Meeting notes.md', notebookId: nb('example'), createOnly: true, noCommit: true, content: 'again' }))).status).toBe(409);
  const changes = await fetch(`${base}/api/git/changes`).then(r => r.json());
  expect(changes.changes.find((change: { path: string; }) => change.path === 'notes/example/.templates/Meeting notes.md')).toMatchObject({ available: true, manualCommitOnly: true });

  const moved = await fetch(`${base}/api/files`, json({ command: { kind: 'move', notebookId: nb('example'), path: file, destination: 'notes/example/.templates/books.md' } }));
  expect(moved.status).toBe(200);
  expect(fs.existsSync(path.join(root, file))).toBe(false);
  expect(fs.readFileSync(path.join(root, 'notes/example/.templates/books.md'), 'utf8')).toBe(READING);
  expect((await fetch(`${base}/api/notes?path=${encodeURIComponent('notes/example/.templates/books.md')}&notebookId=${nb('example')}&noCommit=true`, { method: 'DELETE' })).status).toBe(200);
  expect(fs.existsSync(path.join(root, 'notes/example/.templates/books.md'))).toBe(false);

  for (const hidden of ['notes/example/.other/secret.md', 'notes/example/.templates/nested/deep.md']) {
    expect((await fetch(`${base}/api/notes/read?path=${hidden}&notebookId=${nb('example')}`)).status).toBe(403);
    expect((await fetch(`${base}/api/notes`, json({ path: hidden, notebookId: nb('example'), noCommit: true, content: 'changed' }))).status).toBe(403);
  }
  expect(fs.readFileSync(path.join(root, 'notes/example/.other/secret.md'), 'utf8')).toBe('# Secret\n');
});
