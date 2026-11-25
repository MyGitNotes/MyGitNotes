import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runGit, stageAndCommit } from '@mygitnotes/git';
import { openRemoteRepository, parseCompilation, WORKSPACE_CONFIG_FILENAME } from '@mygitnotes/core';
import { createMCPServer } from '../src/server.js';
import { callRemoteTool } from '../src/remote-tools.js';
import { gitlabFixture } from '../../core/tests/fixtures/gitlab.js';

// A tag or status write an agent makes to a compilation is refused, naming the file, when the result would not open or
// would change another field; the tool answers an error and the file and history stay as they were.
const board = 'version: 1\nid: c\ntitle: C\narrangement: board\nstatus: working\nitems:\n  - { id: n1, kind: note, path: notes/ex/a.md }\nboard:\n  cards:\n    - { item: n1, x: 24, y: 56 }\n  texts:\n    - { id: t1, x: 0, y: 0, text: Open }\npublisher: { editions: [zh] }\n';
const file = 'notes/ex/c.compilation.yml';
let repo: string | undefined;

afterEach(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
  repo = undefined;
});

it('answers a refused local compilation write as a tool error and leaves the file and history alone', async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mgn-mcp-compilation-'));
  await runGit(['init', '-b', 'main'], repo);
  await runGit(['config', 'user.name', 'Test User'], repo);
  await runGit(['config', 'user.email', 'test@example.com'], repo);
  fs.writeFileSync(path.join(repo, WORKSPACE_CONFIG_FILENAME), 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n');
  fs.mkdirSync(path.join(repo, 'notes/ex'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'notes/ex/a.md'), '# A\n');
  fs.writeFileSync(path.join(repo, file), board);
  await stageAndCommit(repo, [WORKSPACE_CONFIG_FILENAME, 'notes/ex/a.md', file], 'fixture');
  const call = (await (createMCPServer(repo) as any)._requestHandlers.get('tools/call')) as (request: unknown) => Promise<{ isError?: boolean; content: { text: string; }[]; }>;
  const tool = (name: string, args: Record<string, unknown>) => call({ method: 'tools/call', params: { name, arguments: args } });
  const head = async () => (await runGit(['rev-parse', 'HEAD'], repo!)).stdout;
  const before = await head();

  for (const args of [{ path: file, status: ' ' }, { path: file, metadata: { tags: 'x' } }, { path: file, tags: ['t'.repeat(201)] }]) {
    const answer = await tool('update_note_metadata', args);
    expect(answer.isError).toBe(true);
    expect(JSON.parse(answer.content[0].text).error).toMatch(new RegExp(`^${file}: Tags and status not written: `));
  }
  const saved = await tool('save_note', { path: file, content: board.replace('arrangement: board\n', ''), tags: ['new'] });
  expect(saved.isError).toBe(true);
  expect(JSON.parse(saved.content[0].text).error).toContain('the compilation would not open (arrangement: Required)');
  expect(fs.readFileSync(path.join(repo, file), 'utf8')).toBe(board);
  expect(await head()).toBe(before);

  const done = await tool('update_note_metadata', { path: file, status: 'done', tags: ['kept'] });
  expect(done.isError).toBeFalsy();
  expect(parseCompilation(fs.readFileSync(path.join(repo, file), 'utf8'))).toMatchObject({ status: 'done', tags: ['kept'], board: parseCompilation(board).board });
});

it('refuses a remote compilation write that would not open, writing nothing', async () => {
  const f = gitlabFixture(undefined, { [file]: board });
  const reader = openRemoteRepository({ type: 'gitlab', url: 'https://gitlab.example.test/gitlab', repository: 'group/subgroup/project', branch: 'main' }, 'fixture-token', f.request).reader;
  const writes = f.writes;
  await expect(callRemoteTool(reader, 'update_note_metadata', { path: file, tags: ['t'.repeat(201)], revision: f.head }, true)).rejects.toThrow(`${file}: Tags and status not written: the compilation would not open (tags.0:`);
  expect(f.writes).toBe(writes);
  expect(f.files.get(file)).toBe(board);
});
