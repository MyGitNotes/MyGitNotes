import type { LiveCheckoutView } from '../lib/live-api.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';

/*
 * Offline handover at the workspace (docs/specs/2026-11-16-collab-first-self-host A3.2). Not implemented yet.
 */
export interface LiveHandoverParams {
  /** The workspace is loaded: its drafts and repositories are known. */
  ready: boolean;
  /** The working changes of the open repositories, by `noteRefKey`. */
  drafts: Record<string, WorkingNote>;
  /** Where a note's drafts go to the live editor: its repository's draft scope and notebook root, or null when the note is not covered. */
  covered: (note: NoteItem) => { scope: string; notebookRoot: string; } | null;
  updateDraft: (notebookId: string, path: string, entry: WorkingNote | null) => void;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null, blocked?: string) => NoteItem;
  invalidateNotes: () => void;
  /** A note made offline became a pending live note. */
  onCreated?: (draft: NoteItem, checkout: LiveCheckoutView) => void;
}

export function useLiveHandover(_params: LiveHandoverParams) {
  return { handOver: async (_note: NoteItem): Promise<boolean> => false };
}
