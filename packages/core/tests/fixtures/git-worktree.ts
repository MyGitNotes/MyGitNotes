import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RemoteEntry } from '../../src/remote-source.js';

export type WorktreeFiles = Record<string, string | { content: string; mode: string; }>;

/**
 * A real git repository whose worktree is replaced by each state `list` is given, answering with git's own root tree id
 * and recursive listing of it. `gitlinks` adds submodule entries, which name a commit and need no checkout.
 */
export function gitWorktree(format: 'sha1' | 'sha256' = 'sha1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-git-worktree-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('init', '-q', `--object-format=${format}`);
  // The modes and bytes under test are the ones written here, whatever the machine's defaults.
  git('config', 'core.fileMode', 'true');
  git('config', 'core.symlinks', 'true');
  git('config', 'core.autocrlf', 'false');
  return {
    list(files: WorktreeFiles, gitlinks: Record<string, string> = {}): { root: string; entries: RemoteEntry[]; } {
      for (const entry of fs.readdirSync(root)) if (entry !== '.git') fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      for (const [file, value] of Object.entries(files)) {
        const { content, mode } = typeof value === 'string' ? { content: value, mode: '100644' } : value;
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        if (mode === '120000') fs.symlinkSync(content, path.join(root, file));
        else fs.writeFileSync(path.join(root, file), content, { mode: mode === '100755' ? 0o755 : 0o644 });
      }
      git('add', '-A');
      for (const [file, commit] of Object.entries(gitlinks)) git('update-index', '--add', '--cacheinfo', `160000,${commit},${file}`);
      const tree = git('write-tree').trim();
      const entries = git('ls-tree', '-r', '-t', '-z', tree).split('\0').filter(Boolean).map((line): RemoteEntry => {
        const [meta, file] = line.split('\t');
        const [mode, type, sha] = meta.split(' ');
        return { path: file, mode, type, sha };
      });
      return { root: tree, entries };
    },
    remove() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
