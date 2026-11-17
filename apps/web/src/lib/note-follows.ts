import { noteRefKey } from '@mygitnotes/core/note-query';
import { useState } from 'react';
import { isLivePendingPath } from './live-api.js';

/*
 * The notes this page followed to where they lie now: another person moved or renamed a live note one has open
 * (docs/specs/2026-11-15-builtin-live-editor §20.4), and its editor, its Focus tabs and the address went after it. A view
 * that shows the note and changes from the path it lay at to the one it lies at in place shows the same note: it keeps
 * its editor, with the session, caret, selection, scroll and focus the person types in. Any other change of path in place
 * is another note, which gets an editor of its own.
 */

/** How long a follow is news: the views that showed the note follow it within a render or two of the page hearing it. */
const FOLLOW_MS = 60_000;
/** How many follows the page holds, the latest last. */
const LIMIT = 64;
/** Each follow by the `noteRefKey` the note lies at now: the key it lay at before, and when the page heard it. */
const follows = new Map<string, { from: string; at: number; }>();

/**
 * The page heard that the note at `from` lies at `to` now. A pending note's virtual path once it is filed is not followed:
 * its session ended with its check-in, and the filed note opens as a note of its own.
 */
export function noteFollowed(notebookId: string, from: string, to: string): void {
  if (from === to || isLivePendingPath(from)) return;
  const key = noteRefKey({ notebookId, path: to });
  follows.delete(key);
  follows.set(key, { from: noteRefKey({ notebookId, path: from }), at: Date.now() });
  while (follows.size > LIMIT) follows.delete(follows.keys().next().value!);
}

/** The keys the note at `key` lay at before the page followed it here, the latest first: one per recent move. */
export function followedFrom(key: string): string[] {
  const keys: string[] = [], now = Date.now();
  for (let step = follows.get(key); step && now - step.at < FOLLOW_MS && step.from !== key && !keys.includes(step.from); step = follows.get(step.from)) keys.push(step.from);
  return keys;
}

/** Whether the note shown at `from` is the one the page followed to `to`. */
export const followsNote = (from: string, to: string): boolean => from !== to && followedFrom(to).includes(from);

/**
 * A React key for the note at `key` that stays the same while the page follows the note to where it moved, so that what
 * it keys (an editor) stays mounted; another note shown in its place gets a key of its own.
 */
export function useFollowedKey(key: string): string {
  const [shown, setShown] = useState({ key, stable: key });
  if (shown.key === key) return shown.stable;
  const next = { key, stable: followsNote(shown.key, key) ? shown.stable : key };
  setShown(next);
  return next.stable;
}
