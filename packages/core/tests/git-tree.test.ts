import { afterAll, describe, expect, it } from 'vitest';
import { gitListing, gitTreeId, inGitOrder } from '../src/git-tree.js';
import { gitBlobId } from '../src/remote-cache.js';
import type { RemoteEntry } from '../src/remote-source.js';
import { gitWorktree, type WorktreeFiles } from './fixtures/git-worktree.js';

type Files = WorktreeFiles;
const worktrees: ReturnType<typeof gitWorktree>[] = [];
afterAll(() => worktrees.forEach(worktree => worktree.remove()));
/** Git's own listing of each state it is given. */
function repository(format: 'sha1' | 'sha256' = 'sha1') {
  const worktree = gitWorktree(format);
  worktrees.push(worktree);
  return worktree.list;
}

/** What `gitListing` is given: the files alone, as a remote listing would name them. */
const filesOf = (entries: RemoteEntry[]) => entries.filter(entry => entry.type !== 'tree');
const topLevel = (entries: RemoteEntry[]) => entries.filter(entry => !entry.path.includes('/'));

const initial: Files = { 'a.txt': 'beside a directory of the same stem\n', 'a/x.md': '# X\n', 'a/b.md': '# B beside a/b/\n', 'a/b/c.md': '# C\n', 'a-b': 'sorts before a.txt\n', 'a0': 'sorts after a/\n', 'bin/run.sh': { content: '#!/bin/sh\n', mode: '100755' }, 'link.md': { content: 'a.txt', mode: '120000' }, 'notes/ex/with space.md': '# Spaced\n', 'z/deep/er/still/file.md': '# Deep\n', '筆記/專案/計畫.md': '# 計畫\n', '筆記/😀.md': 'astral plane name\n', '筆記/￮.md': 'sorts after the astral name by code unit and before it by byte\n' };

describe('git tree listing', () => {
  it('hashes blobs as git does', () => {
    const state = repository()(initial);
    for (const [file, value] of Object.entries(initial)) expect(gitBlobId(Buffer.from(typeof value === 'string' ? value : value.content), 40)).toBe(state.entries.find(entry => entry.path === file)!.sha);
  });

  it('derives every directory id and the listing order git gives, through nested adds, deletes, renames and mode changes', () => {
    const state = repository();
    const steps: [string, Files, Record<string, string>?][] = [['initial', initial]];
    const next = (label: string, change: (files: Files) => void, gitlinks?: Record<string, string>) => {
      const files = { ...steps.at(-1)![1] };
      change(files);
      steps.push([label, files, gitlinks]);
    };
    next('nested adds', files => {
      files['a/b/new/dir/n.md'] = '# New, three new directories down\n';
      files['a/y.md'] = '# Y\n';
      files['top.md'] = '# Top\n';
    });
    next('deletes that empty a chain of directories', files => {
      delete files['z/deep/er/still/file.md'];
      delete files['a/b/new/dir/n.md'];
      delete files['a/x.md'];
    });
    next('renames of a file and of a directory', files => {
      files['renamed/x.md'] = files['a/y.md'];
      delete files['a/y.md'];
      files['a/c/c.md'] = files['a/b/c.md'];
      delete files['a/b/c.md'];
    });
    next('mode changes', files => {
      files['a.txt'] = { content: files['a.txt'] as string, mode: '100755' };
      files['bin/run.sh'] = '#!/bin/sh\n';
      files['link.md'] = 'a symlink no longer\n';
    });
    next('a file replaced by a directory and a directory by a file', files => {
      delete files['a-b'];
      files['a-b/inner.md'] = '# Inner\n';
      delete files['notes/ex/with space.md'];
      files['notes'] = 'now a file\n';
    });
    next('a submodule', () => {}, { 'vendor/lib': 'c'.repeat(40) });
    for (const [label, files, gitlinks] of steps) {
      const { root, entries } = state(files, gitlinks);
      const derived = gitListing(filesOf(entries));
      expect(derived, label).toEqual(entries);
      expect(gitTreeId(topLevel(derived!)), label).toBe(root);
      expect(inGitOrder([...entries].reverse()), label).toEqual(entries);
    }
    expect(steps).toHaveLength(7);
  });

  it('hashes a SHA-256 repository with its own ids', () => {
    const { root, entries } = repository('sha256')(initial);
    expect(root).toHaveLength(64);
    const derived = gitListing(filesOf(entries), 64);
    expect(derived).toEqual(entries);
    expect(gitTreeId(topLevel(derived!), 64)).toBe(root);
    expect(gitListing(filesOf(entries))).toBeUndefined();
  });

  it('refuses files that cannot form one tree', () => {
    const blob = (file: string): RemoteEntry => ({ path: file, mode: '100644', type: 'blob', sha: 'a'.repeat(40) });
    expect(gitListing([blob('a'), blob('b/c')])).toHaveLength(3);
    for (const files of [[blob('a'), blob('a')], [blob('a'), blob('a/b')], [blob('a//b')], [blob('/a')], [blob('')], [{ ...blob('a'), sha: 'not-an-id' }], [{ ...blob('a'), mode: '' }], [{ ...blob('a'), type: 'tree' }]]) expect(gitListing(files)).toBeUndefined();
  });
});
