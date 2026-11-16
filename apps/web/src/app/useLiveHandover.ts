import { useCallback, useEffect, useRef } from 'react';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { handOverDraft, LIVE_MERGE_CONFLICT, type LiveHandover } from '../lib/live-handover.js';
import { withClaim } from '../lib/live-claims.js';
import { onReachable } from '../lib/live-reachability.js';
import { sameValue } from '../lib/merge-note.js';
import type { LiveCheckoutView } from '../lib/live-api.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';

export interface LiveHandoverParams {
  /** The workspace is loaded: its drafts and repositories are known. */
  ready: boolean;
  /** The working changes of the open repositories, by `noteRefKey`. */
  drafts: Record<string, WorkingNote>;
  /** Where a note's drafts go to the live editor: its repository's draft scope and notebook root, or null when the note is not covered. */
  covered: (note: NoteItem) => { scope: string; notebookRoot: string; } | null;
  updateDraft: (notebookId: string, path: string, entry: WorkingNote | null) => void;
  /** The note's draft as the browser holds it now, which another tab may have handed over or changed meanwhile. */
  readDraft?: (notebookId: string, path: string) => WorkingNote | undefined;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null, blocked?: string) => NoteItem;
  invalidateNotes: () => void;
  /** A note made offline became a pending live note. */
  onCreated?: (draft: NoteItem, checkout: LiveCheckoutView) => void;
}

/** Whether a draft goes to the live editor by itself: a note's text, not a deletion, and not a conflict waiting for the person. */
const handsOver = (entry: WorkingNote) => !entry.deleted && !entry.blocked;

/**
 * Offline handover at the workspace (docs/specs/2026-11-16-collab-first-self-host A3.2): when the browser is back online,
 * and when the workspace loads online (after a reload made offline), every draft of a note the live editor covers is
 * handed over to its live note. A merged draft is cleared only once the merge is stored; one that conflicts stays,
 * blocked, until the person picks what to keep; one the server could not take stays as it is for the next time.
 * Deletions and notes the live editor does not cover keep the manual commit. One note's handover runs once at a time:
 * the note's open editor (`handOver`) shares a handover the workspace started.
 */
export function useLiveHandover(params: LiveHandoverParams) {
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });
  const running = useRef(new Map<string, Promise<LiveHandover | 'pending' | null>>());

  /**
   * Hands one draft over, or joins the handover of it already running; null when there is none to hand over, 'pending'
   * when another tab is handing it over or it changed since it was listed, so it is still to be handed over (cfx-F005).
   */
  const handOverEntry = useCallback((key: string): Promise<LiveHandover | 'pending' | null> => {
    const current = running.current.get(key);
    if (current) return current;
    const listed = latest.current.drafts[key];
    const context = listed && handsOver(listed) ? latest.current.covered(listed.note) : null;
    if (!listed || !context) return Promise.resolve(null);
    // One tab at a time hands a draft over, and reads it again first: the drafts reach every tab, and every tab hears
    // `online`, so a note made offline would be filed once per tab (cf16-F005). A draft another tab is handing over is left to it.
    const { notebookId, path } = listed.note;
    // A claim another tab holds answers null: that tab hands the draft over, and it is still pending here.
    const work = withClaim(`mygitnotes-live-handover:${context.scope}\n${notebookId}\n${path}`, async () => {
      const entry = latest.current.readDraft ? latest.current.readDraft(notebookId, path) : listed;
      if (!entry || !handsOver(entry)) return 'none' as const;
      // Newer than the list this render saw: the next try hands the newer one over.
      if (!sameValue(entry, listed)) return 'pending' as const;
      const answer = await handOverDraft(entry, context);
      // Settled while the claim is held, so the next tab to take it finds the draft gone or blocked.
      const { updateDraft, stageWorkingNote, invalidateNotes, onCreated } = latest.current;
      if (answer.kind === 'applied' || answer.kind === 'created') {
        updateDraft(entry.note.notebookId, entry.note.path, null);
        invalidateNotes();
        if (answer.kind === 'created') onCreated?.(entry.note, answer.checkout);
      } else if (answer.kind === 'conflict') stageWorkingNote(entry.note, entry.base, LIVE_MERGE_CONFLICT);
      return answer;
    }).then(answer => (answer === 'none' ? null : answer ?? 'pending' as const)).finally(() => running.current.delete(key));
    running.current.set(key, work);
    return work;
  }, []);

  const sweep = useCallback(async () => {
    if (!latest.current.ready || !navigator.onLine) return;
    for (const key of Object.keys(latest.current.drafts)) await handOverEntry(key);
  }, [handOverEntry]);

  const { ready } = params;
  useEffect(() => {
    if (!ready) return;
    void sweep();
    // Not only on `online`: once a live request gets through, or the page shows again (cf16-F007).
    return onReachable(() => void sweep());
  }, [ready, sweep]);

  /**
   * Hands the draft of `note` over for its open editor: true once the note itself can open in the collab editor (merged,
   * kept as a conflict draft, or no draft left); false when the draft stays, is being handed over by another tab or
   * changed meanwhile, or became a pending note `onCreated` opens.
   */
  const handOver = useCallback(async (note: NoteItem) => {
    const answer = await handOverEntry(noteRefKey(note));
    return answer === null || (answer !== 'pending' && (answer.kind === 'applied' || answer.kind === 'conflict'));
  }, [handOverEntry]);

  return { handOver };
}
