import type { NoteMetadata } from '../types.js';
import type { LiveCheckInResult } from '../live-checkin.js';

export interface RemoteEntry {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
}
export interface RepositoryInfo {
  private: boolean;
  permissions?: { push?: boolean; };
  default_branch: string;
}
export interface RemoteSnapshot {
  sha: string;
  treeSha: string;
  entries: RemoteEntry[];
  info: RepositoryInfo;
}
export type RemoteChange = { path: string; content?: string; base64?: string; sha?: string | null; };
/**
 * A live note a relocation could not wholly take along ({@link RemoteSource.followLiveRelocation}): by the path reads
 * know it by, where it was to go, and why, in words. `linksBroken`: its own links to the relocated files still lead to
 * where those were. `moved`: it goes to `destination` all the same; without it, it stays where it lies.
 */
export interface LiveRelocationLeft {
  path: string;
  destination?: string;
  reason: string;
  linksBroken?: true;
  moved?: true;
}

/**
 * What a move of a filed live note answers (docs/specs/2026-11-15-builtin-live-editor §20.4): its Git path now, where its
 * next check-in moves it (null: nowhere, as it lies there or the move was taken back), and the check-in it got at once
 * when nobody else edits it, with the head that check-in left.
 */
export interface LiveMoveResult {
  path: string;
  target: string | null;
  checkIn?: LiveCheckInResult & { revision: string; };
}
/** What a reader's commit listener hears beside the changes ({@link RemoteSource.onCommit}). */
export interface RemoteCommitHeard {
  /** The commit's id. */
  revision: string;
}
/** A commit as a provider lists it in a file's history. */
export interface RemoteCommit {
  sha: string;
  parents: string[];
  date: string;
  author: string;
  message: string;
}
/** A file's content in a past commit, or why it is not shown. */
export type HistoryRead = { blob: string; content: string; } | { blob: string; notice: 'binary' | 'too-large'; };
/** A working note to write in `commitNotes`. */
export interface CommitNoteWrite {
  path: string;
  content: string;
  metadata: NoteMetadata;
  createOnly?: boolean;
  delete?: false;
}
/** A working note's deletion in `commitNotes`. */
export interface CommitNoteDeletion {
  path: string;
  delete: true;
}
export type CommitNoteChange = CommitNoteWrite | CommitNoteDeletion;
