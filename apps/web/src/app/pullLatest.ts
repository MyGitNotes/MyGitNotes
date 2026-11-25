import { syncGitWorkspace } from '../lib/api.js';

interface Params {
  remote: boolean;
  /** Whether the local default worktree has an upstream to pull main from. */
  upstream: boolean;
  /** `fresh` reads each branch head past the server's cache. */
  refreshWorkspace: (fresh?: boolean) => Promise<void>;
  invalidateNotes: () => void;
  refreshDocuments: () => Promise<void>;
  onError: (message: string) => void;
}

/**
 * What a phone's pull on the list does: brings the latest Git state in through the app's existing paths. A hosted workspace reads each
 * branch head afresh (the lists follow the new revisions) and refetches its notes and documents; a local one first pulls main from its
 * upstream without pushing, as the Changes panel's 只拉取 does, then reloads. A failure is reported and the page still reloads.
 */
export async function pullLatest({ remote, upstream, refreshWorkspace, invalidateNotes, refreshDocuments, onError }: Params): Promise<void> {
  if (remote) {
    await refreshWorkspace(true);
    invalidateNotes();
    await refreshDocuments().catch(error => onError(error instanceof Error ? error.message : String(error)));
    return;
  }
  if (upstream) {
    try {
      await syncGitWorkspace(undefined, undefined, true);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  await refreshWorkspace();
  invalidateNotes();
  await refreshDocuments().catch(error => onError(error instanceof Error ? error.message : String(error)));
}
