import { useEffect, useState } from 'react';
import { commitStagedChanges, fetchFileChanges } from './api.js';
import { DEFAULT_LOCAL_COMMIT_SUBJECT } from './commit-summary.js';
import { isLivePendingPath } from './live-api.js';
import type { FileChange, GitStatus } from './types.js';

export interface SyncTarget {
  id: string;
  label: string;
  writable: boolean;
  gitStatus: GitStatus | null;
}

// A local workspace cannot attach Live to a checkout. Leave reserved virtual paths to Live check-in, too.
const selectable = (file: FileChange) => file.available && !file.manualCommitOnly && !isLivePendingPath(file.path);
const candidates = async (repository: string) => (await fetchFileChanges(repository)).filter(file => file.repository === repository && selectable(file));
const hasChanges = (status: GitStatus) => status.staged.length || status.modified.length || status.untracked.length;

/** The Changes panel's reviewed working copies, one commit in one worktree. Never commit the whole index. */
export async function commitWorkspaceChanges(repository: string): Promise<boolean> {
  const selected = await candidates(repository);
  if (!selected.length) return false;
  await commitStagedChanges(selected, DEFAULT_LOCAL_COMMIT_SUBJECT, true);
  return true;
}

/** Count the batch's candidates, not every path Git reports as changed. */
export function useUncommittedCount(targets: readonly SyncTarget[]): number {
  const [snapshot, setSnapshot] = useState<{ targets: readonly SyncTarget[]; count: number; }>();
  useEffect(() => {
    let cancelled = false;
    // Status only triggers the read; its path list can collapse a rename that Changes splits into two.
    const reads = targets.filter(({ gitStatus }) => gitStatus && hasChanges(gitStatus)).map(({ id }) => candidates(id).catch(() => []));
    if (reads.length) {
      void Promise.all(reads).then(lists => {
        if (!cancelled) setSnapshot({ targets, count: lists.reduce((sum, files) => sum + files.length, 0) });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [targets]);
  return snapshot?.targets === targets ? snapshot.count : 0;
}
