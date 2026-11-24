import { useEffect, useState } from 'react';
import { commitStagedChanges, fetchFileChanges } from './api.js';
import { isLivePendingPath } from './live-api.js';
import type { FileChange, GitStatus } from './types.js';

export interface SyncTarget {
  id: string;
  label: string;
  gitStatus: GitStatus | null;
}

// A local workspace cannot attach Live to a checkout. Leave reserved virtual paths to Live check-in, too.
const selectable = (file: FileChange) => file.available && !isLivePendingPath(file.path);

/** The Changes panel's reviewed working copies, one commit in one worktree. Never commit the whole index. */
export async function commitWorkspaceChanges(repository: string): Promise<boolean> {
  const selected = (await fetchFileChanges(repository)).filter(file => file.repository === repository && selectable(file));
  if (!selected.length) return false;
  await commitStagedChanges(selected, 'minor-mod', true);
  return true;
}

/** Tracked paths count even if they block sync and cannot be committed here. Untracked paths count only if selectable. */
export function useUncommittedCount(targets: readonly SyncTarget[]): number {
  const [untracked, setUntracked] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const reads = targets.filter(target => target.gitStatus?.untracked.length).map(async ({ id }) => {
      const files = await fetchFileChanges(id).catch(() => []);
      return [id, new Set(files.filter(file => file.repository === id && selectable(file)).map(file => file.path))] as const;
    });
    if (reads.length) {
      void Promise.all(reads).then(entries => {
        if (!cancelled) setUntracked(new Map(entries));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [targets]);
  return targets.reduce((count, { id, gitStatus }) => {
    if (!gitStatus) return count;
    const paths = new Set([...gitStatus.staged, ...gitStatus.modified]);
    for (const path of gitStatus.untracked) if (untracked.get(id)?.has(path)) paths.add(path);
    return count + paths.size;
  }, 0);
}
