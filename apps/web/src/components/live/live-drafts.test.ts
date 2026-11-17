import { describe, expect, it } from 'vitest';
import { liveActionLocked, type LiveDrafts } from './live-drafts.js';

/*
 * The list and bulk lock of live notes (collab-first A7, owner decision on cf16-F006): the built-in editor releases a
 * note nobody typed in as soon as its last editor leaves, so a row that says nothing (nobody in it, its text Git's) is
 * not locked; the server refuses the action itself should the note still be checked out.
 */
const builtin: LiveDrafts = { discards: () => true, retargets: () => true, releasesUntouched: () => true };
const framed: LiveDrafts = { discards: () => false, retargets: () => false, releasesUntouched: () => false };
const row = (live: Record<string, unknown>) => ({ notebookId: 'notes~life', live: { since: '2026-11-16T00:00:00.000Z', editorUrl: '', activeEditors: 0, ...live } });

describe('liveActionLocked', () => {
  it('leaves a note only viewed unlocked where the built-in editor releases it on leaving', () => {
    for (const action of ['move', 'delete', 'other'] as const) expect(liveActionLocked(row({}), action, builtin), action).toBe(false);
  });

  it('locks a note someone is in, or whose text differs from Git, and every checked-out note of a framed editor', () => {
    expect(liveActionLocked(row({ activeEditors: 1 }), 'delete', builtin)).toBe(true);
    // A filed note others edit moves where the editor can retarget it: the move records where its check-in moves it.
    expect(liveActionLocked(row({ activeEditors: 1 }), 'move', builtin)).toBe(false);
    expect(liveActionLocked(row({ changed: true }), 'other', builtin)).toBe(true);
    expect(liveActionLocked(row({}), 'move', framed)).toBe(true);
    expect(liveActionLocked({ notebookId: 'notes~life' }, 'move', framed)).toBe(false);
  });
});
