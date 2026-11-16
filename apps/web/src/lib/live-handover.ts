import type { LiveCheckoutView } from './live-api.js';
import type { WorkingNote } from './working-notes.js';

/*
 * Offline handover, draft → live (docs/specs/2026-11-16-collab-first-self-host A3.2). Not implemented yet.
 */

/** The `blocked` reason of a draft whose merge into the live note conflicted: it stays until the person picks what to keep. */
export const LIVE_MERGE_CONFLICT = 'live-merge-conflict';

/** What handing a draft over to the live note did. */
export type LiveHandover = { kind: 'applied'; } | { kind: 'created'; checkout: LiveCheckoutView; } | { kind: 'conflict'; } | { kind: 'failed'; error: unknown; };

/** Merges a draft of a covered note into its live note, or files a new note made offline as a pending live note. */
export async function handOverDraft(_entry: WorkingNote, _context: { scope: string; notebookRoot: string; }): Promise<LiveHandover> {
  return { kind: 'failed', error: new Error('Not implemented.') };
}
