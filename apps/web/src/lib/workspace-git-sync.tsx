import { createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { GitSyncError, syncGitWorkspace } from './api.js';
import { useRegisterCommands } from './commands/registry.js';
import { useTranslation } from './i18n/index.js';
import { usePanelContext } from './panel-context.js';
import type { GitStatus } from './types.js';
import { commitWorkspaceChanges, type SyncTarget, useUncommittedCount } from './workspace-git-changes.js';

export type { SyncTarget } from './workspace-git-changes.js';
export const COMMIT_AND_SYNC_COMMAND = 'workspace.commitAndSync';
const NO_TARGETS: readonly SyncTarget[] = [];

type SyncResult = Awaited<ReturnType<typeof syncGitWorkspace>>;
type Strategy = NonNullable<Parameters<typeof syncGitWorkspace>[0]>;
export type SyncState = { kind: 'busy' | 'dirty' | 'no-upstream' | 'manual'; } | { kind: 'done'; result: SyncResult; } | { kind: 'conflict' | 'unresolved'; files: string[]; } | { kind: 'error'; message: string; };

interface WorkspaceGitSync {
  targets: readonly SyncTarget[];
  states: ReadonlyMap<string, SyncState>;
  changedCount: number;
  committing: boolean;
  commitError: string;
  commitAll: (andSync: boolean) => Promise<void>;
  run: (target: SyncTarget, strategy?: Strategy) => Promise<void>;
  resolveManually: (id: string) => void;
  canReveal: boolean;
  reveal: { repository?: string; } | null;
  revealChanges: (repository?: string) => void;
  didReveal: () => void;
}

const WorkspaceGitSyncContext = createContext<WorkspaceGitSync | null>(null);
export const useWorkspaceGitSync = () => useContext(WorkspaceGitSyncContext);

export function hasTrackedChanges(status: GitStatus | null): boolean {
  return Boolean(status?.staged.length || status?.modified.length);
}

function failureState(failure: unknown): SyncState {
  if (failure instanceof GitSyncError) {
    switch (failure.code) {
      case 'DIRTY':
        return { kind: 'dirty' };
      case 'NO_UPSTREAM':
        return { kind: 'no-upstream' };
      case 'CONFLICT':
        return { kind: 'conflict', files: failure.files };
      case 'UNRESOLVED':
        return { kind: 'unresolved', files: failure.files };
    }
  }
  return { kind: 'error', message: errorMessage(failure) };
}

const errorMessage = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);

function WorkspaceCommitShortcut({ commitAll }: { commitAll: WorkspaceGitSync['commitAll']; }) {
  useRegisterCommands([{ id: COMMIT_AND_SYNC_COMMAND, run: () => commitAll(true) }]);
  return null;
}

interface WorkspaceGitSyncProps {
  enabled: boolean;
  targets: readonly SyncTarget[];
  onSynced: () => Promise<void>;
  flushEditors: () => Promise<boolean>;
  onRevealChanges?: () => void;
  children: ReactNode;
}

/** One action and result per local repository, shared by the header and the Changes panel. */
export function WorkspaceGitSyncProvider({ enabled, targets, onSynced, flushEditors, onRevealChanges, children }: WorkspaceGitSyncProps) {
  const panel = usePanelContext();
  const { t } = useTranslation();
  const [states, setStates] = useState<ReadonlyMap<string, SyncState>>(() => new Map());
  const [reveal, setReveal] = useState<{ repository?: string; } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const inFlight = useRef(new Set<string>());
  const batch = useRef(false);
  const changedCount = useUncommittedCount(enabled ? targets : NO_TARGETS);
  const update = (id: string, state: SyncState) => setStates(previous => new Map(previous).set(id, state));
  const revealChanges = (repository?: string) => {
    onRevealChanges?.();
    panel.showTool('changes');
    setReveal({ repository });
  };

  const syncRepository = async (id: string, strategy?: Strategy): Promise<SyncState> => {
    update(id, { kind: 'busy' });
    try {
      return { kind: 'done', result: await syncGitWorkspace(strategy, id) };
    } catch (failure) {
      return failureState(failure);
    }
  };

  const run = async ({ id, gitStatus }: SyncTarget, strategy?: Strategy) => {
    if (!enabled || batch.current || inFlight.current.has(id) || !gitStatus?.upstream) return;
    if (hasTrackedChanges(gitStatus)) {
      update(id, { kind: 'dirty' });
      return;
    }
    inFlight.current.add(id);
    const outcome = await syncRepository(id, strategy);
    try {
      await onSynced();
    } finally {
      inFlight.current.delete(id);
      update(id, outcome);
    }
  };

  const commitAll = async (andSync: boolean) => {
    if (!enabled || batch.current || inFlight.current.size) return;
    batch.current = true;
    setCommitting(true);
    setCommitError('');
    try {
      if (!await flushEditors()) throw new Error(t('panel.flushBeforeCommitFailed'));
      const failed = new Set<string>();
      for (const { id } of targets) {
        try {
          if (await commitWorkspaceChanges(id)) {
            setStates(previous => {
              if (!previous.has(id)) return previous;
              const next = new Map(previous);
              next.delete(id);
              return next;
            });
          }
        } catch (failure) {
          failed.add(id);
          update(id, { kind: 'error', message: errorMessage(failure) });
        }
      }
      if (andSync || failed.size) revealChanges();
      if (andSync) {
        // The rendered status predates the flush and commits. The existing sync route checks
        // the worktree again, refusing any tracked changes left over or made during the batch.
        for (const { id, gitStatus } of targets) {
          if (!failed.has(id) && gitStatus?.upstream) update(id, await syncRepository(id));
        }
      }
      await onSynced();
    } catch (failure) {
      setCommitError(errorMessage(failure));
      revealChanges();
    } finally {
      batch.current = false;
      setCommitting(false);
    }
  };

  return <WorkspaceGitSyncContext.Provider value={enabled ? { targets, states, changedCount, committing, commitError, commitAll, run, resolveManually: id => update(id, { kind: 'manual' }), canReveal: !panel.hasOpenNote, reveal, revealChanges, didReveal: () => setReveal(null) } : null}>{enabled && <WorkspaceCommitShortcut commitAll={commitAll} />}{children}</WorkspaceGitSyncContext.Provider>;
}
