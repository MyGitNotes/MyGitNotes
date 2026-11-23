import { afterEach, beforeEach, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { runGit } from '@mygitnotes/git';
import { handleGetNoteMetadata, handleListNotes, handleReadNote } from '../src/tools/index.js';

let repo: string;
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};
const commit = (date: string, message: string) => runGit(['commit', '-q', '-am', message], repo, { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-edit-dates-'));
  await runGit(['init', '-q', '-b', 'main'], repo);
  await runGit(['config', 'user.name', 'Test'], repo);
  await runGit(['config', 'user.email', 'test@example.com'], repo);
  write('.mygitnotes.yaml', 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Ex\n    root: notes/ex\n');
  write('notes/ex/a.md', '---\nupdated: "2030-01-01T00:00:00Z"\n---\n# A\n');
  await runGit(['add', '.'], repo);
  await commit('2026-11-20T09:00:00+08:00', 'Start');
  write('notes/ex/b.md', '---\nupdated: "2026-11-22T00:00:00Z"\n---\n# B\n');
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

it('lists and reads notes with the Git edit date, and the frontmatter date for a note not yet committed', async () => {
  const listed = await handleListNotes({ repoRoot: repo }, { notebookId: 'ex' }) as { notes: Record<string, unknown>[]; };
  expect(listed.notes.map(note => [note.path, note.lastCommitAt, note.updated])).toEqual([['notes/ex/a.md', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:00.000Z'], ['notes/ex/b.md', undefined, '2026-11-22T00:00:00.000Z']]);
  expect((await handleReadNote({ repoRoot: repo }, { path: 'notes/ex/a.md', notebookId: 'ex' }) as { note: Record<string, unknown>; }).note).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z' });
  expect(await handleGetNoteMetadata({ repoRoot: repo }, { path: 'notes/ex/a.md' })).toMatchObject({ lastCommitAt: '2026-11-20T01:00:00.000Z', updated: '2026-11-20T01:00:00.000Z' });
  expect(await handleReadNote({ repoRoot: repo }, { path: 'notes/ex/b.md', metadataOnly: true })).toMatchObject({ updated: '2026-11-22T00:00:00.000Z' });
});
