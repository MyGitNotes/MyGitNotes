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

/** What a note opened in a repository with a live editor carries to its editor. */
export interface LiveNoteEditing {
  editor: LiveEditorInfo;
  /** Reads the notes again: the live text changed, or the note was checked in. */
  onRefetch: () => void;
  /** A Focus pane, a graph card or a compilation's section: opens the note in zoom, where its editor is framed. */
  openZoom?: () => void;
  /** The note was checked in (`answer` when this page did it): the repository moved, and a pending note was filed at `answer.path`. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
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
const checkedIn = new Map<string, number>();
export const markCheckedIn = (keys: readonly string[], now = Date.now()) => {
  for (const key of keys) checkedIn.set(key, now);
};
export const recentlyCheckedIn = (key: string, now = Date.now()): boolean => {
  const at = checkedIn.get(key);
  return at !== undefined && now - at < CHECKED_IN_MS;
};
export const forgetCheckedIn = (key: string) => void checkedIn.delete(key);

/** A pending live note's virtual path (`<root>/.live/<id>.md`), which a check-in files at a Git path. */
export const isLivePendingPath = (path: string): boolean => /\/\.live\/[A-Za-z0-9_-]{1,64}\.md$/.test(path);
