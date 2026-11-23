import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGit } from '../src/git-service.js';
import { noteEditFacts } from '../src/edit-dates.js';

let root: string;
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
/** Commits everything staged with `files` added, authored at `date`. */
async function commit(date: string, message: string, ...files: string[]) {
  if (files.length) await runGit(['add', '--', ...files], root);
  await runGit(['commit', '-q', '-m', message], root, { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}
const roots = ['notes/a', 'notes/b'];
const dates = async (scope = roots) => Object.fromEntries([...await noteEditFacts(root, scope)].map(([file, fact]) => [file, fact.uncommitted ? `${fact.lastCommitAt} +uncommitted` : fact.lastCommitAt]));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-edit-dates-'));
  await runGit(['init', '-q', '-b', 'main'], root);
  await runGit(['config', 'user.name', 'Test'], root);
  await runGit(['config', 'user.email', 'test@example.com'], root);
  write('notes/a/one.md', 'one\n');
  write('notes/a/deep/two.md', 'two\n');
  write('notes/b/three.md', 'three\n');
  write('outside/four.md', 'four\n');
  await commit('2026-01-01T10:00:00+08:00', 'Start', '.');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('dates every note under the roots by the last commit that changed it, in one pass', async () => {
  write('notes/a/one.md', 'one, edited\n');
  await commit('2026-02-01T00:00:00Z', 'Edit one', 'notes/a/one.md');
  write('outside/four.md', 'four, edited\n');
  await commit('2026-03-01T00:00:00Z', 'Edit outside', 'outside/four.md');
  expect(await dates()).toEqual({ 'notes/a/one.md': '2026-02-01T00:00:00.000Z', 'notes/a/deep/two.md': '2026-01-01T02:00:00.000Z', 'notes/b/three.md': '2026-01-01T02:00:00.000Z' });
  expect(await dates(['notes/b'])).toEqual({ 'notes/b/three.md': '2026-01-01T02:00:00.000Z' });
});

it('follows a note back through a commit that only moved it, but not through a move that changed its text', async () => {
  write('notes/a/one.md', 'one, edited\n');
  await commit('2026-02-01T00:00:00Z', 'Edit one', 'notes/a/one.md');
  await runGit(['mv', 'notes/a/one.md', 'notes/b/moved.md'], root);
  await commit('2026-03-01T00:00:00Z', 'Move one');
  await runGit(['mv', 'notes/b/moved.md', 'notes/b/again.md'], root);
  await commit('2026-03-02T00:00:00Z', 'Move it again');
  await runGit(['mv', 'notes/a/deep/two.md', 'notes/a/two.md'], root);
  write('notes/a/two.md', 'two, retitled while moved\n');
  await commit('2026-04-01T00:00:00Z', 'Move and edit two', 'notes/a/two.md');
  expect(await dates()).toEqual({ 'notes/b/again.md': '2026-02-01T00:00:00.000Z', 'notes/a/two.md': '2026-04-01T00:00:00.000Z', 'notes/b/three.md': '2026-01-01T02:00:00.000Z' });
});

it('dates an edit merged from another branch by the edit', async () => {
  await runGit(['checkout', '-q', '-b', 'side'], root);
  write('notes/b/three.md', 'three, on a side branch\n');
  await commit('2026-05-01T00:00:00Z', 'Side edit', 'notes/b/three.md');
  await runGit(['checkout', '-q', 'main'], root);
  write('notes/a/one.md', 'one, on main\n');
  await commit('2026-05-02T00:00:00Z', 'Main edit', 'notes/a/one.md');
  await runGit(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], root, { env: { GIT_AUTHOR_DATE: '2026-06-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-06-01T00:00:00Z' } });
  expect(await dates()).toMatchObject({ 'notes/b/three.md': '2026-05-01T00:00:00.000Z', 'notes/a/one.md': '2026-05-02T00:00:00.000Z' });
});

it('moves with the branch head, whether it advanced or went back', async () => {
  expect((await dates())['notes/a/one.md']).toBe('2026-01-01T02:00:00.000Z');
  write('notes/a/one.md', 'one, edited\n');
  await commit('2026-02-01T00:00:00Z', 'Edit one', 'notes/a/one.md');
  await runGit(['mv', 'notes/b/three.md', 'notes/b/renamed.md'], root);
  await commit('2026-02-02T00:00:00Z', 'Rename three');
  write('notes/b/new.md', 'new\n');
  await commit('2026-02-03T00:00:00Z', 'Add new', 'notes/b/new.md');
  expect(await dates()).toEqual({ 'notes/a/one.md': '2026-02-01T00:00:00.000Z', 'notes/a/deep/two.md': '2026-01-01T02:00:00.000Z', 'notes/b/renamed.md': '2026-01-01T02:00:00.000Z', 'notes/b/new.md': '2026-02-03T00:00:00.000Z' });
  await runGit(['reset', '-q', '--hard', 'HEAD~3'], root);
  expect(await dates()).toEqual({ 'notes/a/one.md': '2026-01-01T02:00:00.000Z', 'notes/a/deep/two.md': '2026-01-01T02:00:00.000Z', 'notes/b/three.md': '2026-01-01T02:00:00.000Z' });
});

it('marks a note with uncommitted changes and leaves out one Git does not hold', async () => {
  write('notes/a/one.md', 'one, typed and saved\n');
  write('notes/b/three.md', 'three, staged\n');
  await runGit(['add', 'notes/b/three.md'], root);
  write('notes/b/untracked.md', 'new\n');
  expect(await dates()).toEqual({ 'notes/a/one.md': '2026-01-01T02:00:00.000Z +uncommitted', 'notes/a/deep/two.md': '2026-01-01T02:00:00.000Z', 'notes/b/three.md': '2026-01-01T02:00:00.000Z +uncommitted' });
});

it('knows nothing of a folder that is not a repository, or of a repository without commits', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-plain-'));
  try {
    fs.mkdirSync(path.join(plain, 'notes/a'), { recursive: true });
    fs.writeFileSync(path.join(plain, 'notes/a/one.md'), 'one\n');
    expect((await noteEditFacts(plain, roots)).size).toBe(0);
    await runGit(['init', '-q', '-b', 'main'], plain);
    expect((await noteEditFacts(plain, roots)).size).toBe(0);
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});

it('dates nothing, without failing, when Git cannot read the history', async () => {
  // The first commit's tree is gone: the log stops on it.
  const tree = (await runGit(['rev-parse', 'HEAD^{tree}'], root)).stdout;
  write('notes/a/one.md', 'one, edited\n');
  await commit('2026-02-01T00:00:00Z', 'Edit one', 'notes/a/one.md');
  fs.rmSync(path.join(root, '.git/objects', tree.slice(0, 2), tree.slice(2)));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    expect((await noteEditFacts(root, roots)).size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[edit-dates]'));
  } finally {
    warn.mockRestore();
  }
});
