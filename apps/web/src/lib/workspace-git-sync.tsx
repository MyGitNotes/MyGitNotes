import { createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { GitSyncError, syncGitWorkspace } from './api.js';
import { usePanelContext } from './panel-context.js';
import type { GitStatus } from './types.js';

export interface SyncTarget {
  id: string;
  label: string;
  gitStatus: GitStatus | null;
}

type SyncResult = Awaited<ReturnType<typeof syncGitWorkspace>>;
type Strategy = NonNullable<Parameters<typeof syncGitWorkspace>[0]>;
export type SyncState = { kind: 'busy' | 'dirty' | 'no-upstream' | 'manual'; } | { kind: 'done'; result: SyncResult; } | { kind: 'conflict' | 'unresolved'; files: string[]; } | { kind: 'error'; message: string; };

interface WorkspaceGitSync {
  targets: readonly SyncTarget[];
  states: ReadonlyMap<string, SyncState>;
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
  return { kind: 'error', message: failure instanceof Error ? failure.message : String(failure) };
}

/** One action and result per local repository, shared by the header and the Changes panel. */
export function WorkspaceGitSyncProvider({ enabled, targets, onSynced, onRevealChanges, children }: { enabled: boolean; targets: readonly SyncTarget[]; onSynced: () => Promise<void>; onRevealChanges?: () => void; children: ReactNode; }) {
  const panel = usePanelContext();
  const [states, setStates] = useState<ReadonlyMap<string, SyncState>>(() => new Map());
  const [reveal, setReveal] = useState<{ repository?: string; } | null>(null);
  const inFlight = useRef(new Set<string>());
  const update = (id: string, state: SyncState) => setStates(previous => new Map(previous).set(id, state));

  const run = async (target: SyncTarget, strategy?: Strategy) => {
    const { id, gitStatus } = target;
    if (!enabled || inFlight.current.has(id)) return;
    if (!gitStatus?.upstream) return;
    if (hasTrackedChanges(gitStatus)) {
      update(id, { kind: 'dirty' });
      return;
    }
    inFlight.current.add(id);
    update(id, { kind: 'busy' });
    let outcome: SyncState;
    try {
      outcome = { kind: 'done', result: await syncGitWorkspace(strategy, id) };
    } catch (failure) {
      outcome = failureState(failure);
    }
    try {
      await onSynced();
    } finally {
      inFlight.current.delete(id);
      update(id, outcome);
    }
  };

  return (
    <WorkspaceGitSyncContext.Provider
      value={enabled
        ? {
          targets,
          states,
          run,
          resolveManually: id => update(id, { kind: 'manual' }),
          canReveal: !panel.hasOpenNote,
          reveal,
          revealChanges: repository => {
            onRevealChanges?.();
            panel.showTool('changes');
            setReveal({ repository });
          },
          didReveal: () => setReveal(null),
        }
        : null}
    >
      {children}
    </WorkspaceGitSyncContext.Provider>
  );
}
