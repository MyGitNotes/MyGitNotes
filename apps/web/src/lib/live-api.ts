import type { LiveCheckInReason, LiveConflict, LiveEditorInfo } from '@mygitnotes/core';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { isOutlinePath } from '@mygitnotes/core/outline';
import { ApiError, responseError } from './api.js';

/*
 * The browser's side of the live editor routes (docs/specs/2026-11-15-live-notes/spec.md §6, §8): check a note out,
 * create a live note, and check one in now. The browser never writes a live note's text; the editor does.
 */

/** A live note as the checkout and new routes answer it: the path reads know it by (a pending note's is virtual). */
export interface LiveCheckoutView {
  id: string;
  notebookId: string;
  path: string;
  pending: boolean;
  editorUrl: string;
  /** A framed editor only. */
  embedUrl?: string;
  since: string;
  activeEditors: number;
  conflict: LiveConflict | null;
}

/** What 「立即簽回」 answers. */
export interface LiveCheckInAnswer {
  id: string;
  path: string | null;
  committed: boolean;
  commit?: string;
  released: boolean;
  reason?: LiveCheckInReason;
  activeEditors?: number;
  conflict?: LiveConflict;
  skippedEditors?: string[];
  filed?: true;
  /** A pending note that was an empty draft and was discarded, with `reason: 'empty'`: nothing was committed. */
  discarded?: true;
  revision: string;
}

/** What a repository's live editor can do beyond 0.19: discard a pending note (「捨棄草稿」), and move or rename one. */
export type LiveEditorAbilities = LiveEditorInfo & { discard?: true; retarget?: true; };

/** What a note opened in a repository with a live editor carries to its editor. */
export interface LiveNoteEditing {
  editor: LiveEditorAbilities;
  /** Reads the notes again: the live text changed, or the note was checked in. */
  onRefetch: () => void;
  /** A Focus pane, a graph card or a compilation's section: opens the note in zoom, where its editor is framed. */
  openZoom?: () => void;
  /** The note was checked in (`answer` when this page did it): the repository moved, and a pending note was filed at `answer.path`. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
  /** The note was checked in by someone else while this page's editor still offers its unsaved text: the live state is read again. */
  onReleased?: () => void;
  /** A pending note was discarded, by 「捨棄草稿」 or by a check-in that found it empty: it is gone, and the view leaves it. */
  onDiscarded?: () => void;
  /**
   * Where the editor is the built-in one, a checked-out note's own editor checks it in before it moves, renames or deletes
   * it (collab-first A7), then runs the action here: the folder picker, the rename dialog, the deletion. `revision` is the
   * head the check-in answered; none when the note was no longer live and nothing was checked in.
   */
  fileActions?: LiveFileActions;
}

/** The file actions a collab-first note's own editor runs once its check-in released the note. */
export interface LiveFileActions {
  move?: (revision?: string) => void;
  rename?: (revision?: string) => void;
  remove?: (revision?: string) => Promise<void> | void;
}

/** A ticket to open a live note's document over the built-in editor's socket: single use, valid 60 s. */
export interface LiveSocketTicket {
  ticket: string;
  /** The Yjs document it opens: `<link id>.<epoch>`. */
  document: string;
}

/** What 「捨棄草稿」 answers: the draft is gone, or why it was kept. A typed draft without `confirm` is refused 409 `has-edits`. */
export type LiveDiscardAnswer = { discarded: true; } | { discarded: false; reason: 'leased' | 'released' | 'active' | 'changed' | 'not-synced'; activeEditors?: number; };

/** What a move or rename of a pending note answers: its row and where its check-in now files it. */
export interface LiveRetargetAnswer {
  checkout: LiveCheckoutView & { pathRule: string; };
  destination: { folder: string; name: string; };
}

const post = async <T>(url: string, body: unknown, fallback: string): Promise<T> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await responseError(res, fallback);
  return res.json() as Promise<T>;
};

/** Checks a note out to the live editor, or joins its live note; a pending note's virtual path answers its own link. */
export const checkOutLive = (notebookId: string, path: string) => post<{ checkout: LiveCheckoutView; outcome: 'created' | 'joined' | 'reopened'; }>('/api/live/checkout', { notebookId, path }, 'Failed to open the live editor');

/** Creates a pending live note in `folder`: from a notebook template (`templateId`, with path `values`), or from the browser's own text. */
export const createLiveNote = (params: { notebookId: string; folder: string; title: string; templateId?: string; values?: Record<string, string>; content?: string; clock?: { date: string; time: string; }; }) => post<{ checkout: LiveCheckoutView; }>('/api/live/new', params, 'Failed to create the live note');

/** 「立即簽回」: commits the live text and closes the live note, or says why it stayed open. */
export const checkInLive = (notebookId: string, path: string) => post<LiveCheckInAnswer>('/api/live/checkin', { notebookId, path }, 'Failed to check the note in');

/** A ticket for the built-in editor's socket, for a note that is live already; 409 `not-live` once it was checked in. */
export const socketTicket = (notebookId: string, path: string) => post<LiveSocketTicket>('/api/live/socket-ticket', { notebookId, path }, 'Failed to open the live editor');

/** 「捨棄草稿」 of a pending note, by its virtual path; `confirm` drops what someone typed in it. Nothing is committed. */
export const discardLive = (notebookId: string, path: string, confirm = false) => post<LiveDiscardAnswer>('/api/live/discard', { notebookId, path, ...(confirm ? { confirm: true } : {}) }, 'Failed to discard the draft');

/** Moves (`folder`, relative to the notebook root, '' for the root) or renames (`name`) where a pending note is filed. */
export const retargetLive = (notebookId: string, path: string, change: { folder?: string; name?: string; }) => post<LiveRetargetAnswer>('/api/live/retarget', { notebookId, path, ...change }, 'Failed to move the draft');

/** Whether a discard was refused because someone typed in the draft, which the person confirms first. */
export const hasLiveEdits = (error: unknown): boolean => error instanceof ApiError && error.code === 'has-edits';

/** Whether the live editor answered that a note is no longer live: checked in, or never opened. */
export const isNotLive = (error: unknown): boolean => error instanceof ApiError && error.code === 'not-live';

/** Whether the live editor refused a note it cannot take, which then opens in the direct editor. */
export const keepsDirectEditor = (error: unknown): boolean => error instanceof ApiError && (error.code === 'too-large' || error.code === 'not-live');

/** Whether a note is of a kind the live editor takes: Markdown, and no outline or compilation. Template files are told apart by their notebook. */
export const liveEditableKind = (path: string): boolean => /\.(md|markdown)$/i.test(path) && !isOutlinePath(path) && !isCompilationPath(path);

/** Whether a note is checked out (編輯中) or pending, so that file operations on it are refused until check-in. */
export const isLiveNote = (note: { live?: unknown; }): boolean => Boolean(note.live);

/*
 * A note a Focus pane, card or section asked to edit live, waiting for zoom to open it: zoom checks it out on mount.
 * Keyed by `noteRefKey`; read once.
 */
const requested = new Set<string>();
export const requestLiveEdit = (key: string) => void requested.add(key);
export const takeLiveEditRequest = (key: string): boolean => requested.delete(key);

/*
 * Notes this page just checked in, so that 「已簽回」 outlives the editor: the check-in moves the repository's head, and
 * the zoom that showed the frame reloads its note and mounts a new editor, which says it once. Keyed by `noteRefKey`
 * (a filed pending note under both its paths); a mark older than CHECKED_IN_MS is forgotten.
 */
const CHECKED_IN_MS = 30_000;
/** A mark: when it was set, and for a check-in that committed but left the note open, how many were still editing. */
interface CheckInMark {
  at: number;
  stillOpen?: number;
}
const checkedIn = new Map<string, CheckInMark>();
export const markCheckedIn = (keys: readonly string[], stillOpen?: number, now = Date.now()) => {
  for (const key of keys) checkedIn.set(key, stillOpen === undefined ? { at: now } : { at: now, stillOpen });
};
/** The note's recent mark, if any: `stillOpen` when the check-in was committed but did not release the note. */
export const recentCheckIn = (key: string, now = Date.now()): Omit<CheckInMark, 'at'> | undefined => {
  const mark = checkedIn.get(key);
  return mark && now - mark.at < CHECKED_IN_MS ? (mark.stillOpen === undefined ? {} : { stillOpen: mark.stillOpen }) : undefined;
};
export const forgetCheckedIn = (key: string) => void checkedIn.delete(key);

/** A pending live note's virtual path (`<root>/.live/<id>.md`), which a check-in files at a Git path. */
export const isLivePendingPath = (path: string): boolean => /\/\.live\/[A-Za-z0-9_-]{1,64}\.md$/.test(path);
