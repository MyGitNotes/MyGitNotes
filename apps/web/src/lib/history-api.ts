import type { HistoryEntry, NoteVersion } from '@mygitnotes/core/note-versions';
import { responseError } from './api.js';
import { followPage } from './page-events.js';
import { localCommitFiles, localHistoryEntries, localTextAt, localTextOfBlob, localVersions, scopeOfTarget } from './local-commits.js';

const API_BASE = '/api';

/** Which file a history request is about: a note through its notebook, or an agent file through its repository. */
export interface HistoryTarget {
  path: string;
  notebookId?: string;
  repository?: string;
}

/** A history entry; `local` marks a commit recorded in this browser only (demo mode). */
export type HistoryRow = HistoryEntry & { local?: true; };

export interface HistoryPage {
  path: string;
  repository: string;
  entries: HistoryRow[];
  more: boolean;
  versions: NoteVersion[];
  writable: boolean;
  /** Demo mode: commits recorded in this browser join this history, so a version may be recorded on them. */
  localCommits?: true;
}

/** A file's content in a past commit, or why it is not shown. */
export type HistoryContent = { blob: string; content: string; } | { blob: string; notice: 'binary' | 'too-large'; };

/** The name and note a person gives a version, and their day for its date number. */
export interface VersionText {
  name?: string;
  note?: string;
}

/** A version recorded in the same commit as the note's changes, from the quick note commit. */
export interface NewVersionRequest extends VersionText {
  path: string;
  today: string;
}

function query(target: HistoryTarget, extra: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ path: target.path, notebookId: target.notebookId, repository: target.repository, ...extra })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** This device's day, which names a version's date number. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function fetchServerHistory(target: HistoryTarget, page: number): Promise<HistoryPage> {
  const res = await fetch(`${API_BASE}/history?${query(target, { page })}`);
  if (!res.ok) throw await responseError(res, 'History could not be loaded.');
  return res.json();
}

/**
 * The file's history: the repository's commits, and in demo mode the commits recorded in this browser on top of them
 * (first page only), with the versions they recorded.
 */
export async function fetchHistory(target: HistoryTarget, page = 1): Promise<HistoryPage> {
  const history = await fetchServerHistory(target, page);
  const demo = scopeOfTarget(target);
  if (!demo) return history;
  const local = localHistoryEntries(demo.scope, target.path);
  return { ...history, entries: page === 1 ? [...local, ...history.entries] : history.entries, versions: [...history.versions, ...localVersions(demo.scope, target.path)], localCommits: true };
}

/** The versions the server holds for a file; what a demo version's numbers count on. */
export async function fetchServerVersions(target: HistoryTarget): Promise<NoteVersion[]> {
  return (await fetchServerHistory(target, 1)).versions;
}

async function fetchServerContent(target: HistoryTarget, at: { commit: string; path?: string; } | { blob: string; }): Promise<HistoryContent> {
  const extra = 'blob' in at ? { blob: at.blob } : { commit: at.commit, at: at.path && at.path !== target.path ? at.path : undefined };
  const res = await fetch(`${API_BASE}/history/file?${query(target, extra)}`);
  if (!res.ok) throw await responseError(res, 'This version could not be loaded.');
  return res.json();
}

/**
 * The file as one commit held it (`at` is its path then), or the content a version recorded. In demo mode a commit or
 * blob recorded in this browser is read from here; a local commit that did not change the file shows the repository head's text.
 */
export async function fetchHistoryContent(target: HistoryTarget, at: { commit: string; path?: string; } | { blob: string; }): Promise<HistoryContent> {
  const demo = scopeOfTarget(target);
  if (!demo) return fetchServerContent(target, at);
  if ('blob' in at) {
    const text = localTextOfBlob(demo.scope, at.blob);
    return text !== undefined ? { blob: at.blob, content: text } : fetchServerContent(target, at);
  }
  const file = at.path ?? target.path;
  const text = localTextAt(demo.scope, at.commit, file);
  if (text === null) throw new Error('This version could not be loaded.');
  if (text !== undefined) return { blob: localHistoryEntries(demo.scope, file).find(candidate => candidate.commit === at.commit)?.blob ?? '', content: text };
  return fetchServerContent(target, localCommitFiles(demo.scope, at.commit) ? { commit: demo.revision, path: at.path } : at);
}

/** The other files the commit changed that can join a version recorded on it. */
export async function fetchCommitFiles(target: HistoryTarget, commit: string): Promise<string[]> {
  const demo = scopeOfTarget(target);
  const local = demo ? localCommitFiles(demo.scope, commit) : undefined;
  if (local) return local.filter(other => other !== target.path);
  const res = await fetch(`${API_BASE}/history/commit?${query(target, { commit })}`);
  if (!res.ok) throw await responseError(res, 'The commit could not be loaded.');
  return (await res.json() as { files: string[]; }).files;
}

export type VersionChange = { action: 'create'; commit: string; at?: string; include: string[]; } & VersionText | { action: 'update'; sequence: number; } & VersionText | { action: 'delete'; sequence: number; };

export async function changeVersion(target: HistoryTarget, change: VersionChange): Promise<NoteVersion[]> {
  const res = await fetch(`${API_BASE}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...change, ...(change.action === 'create' ? { today: today() } : {}) }) });
  if (!res.ok) throw await responseError(res, 'The version could not be saved.');
  return (await res.json() as { versions: NoteVersion[]; }).versions;
}

/** A commit in the workspace that may change a file's history: the repositories it touched and, when known, the paths it changed. */
export interface HistoryChange {
  repositories: string[];
  paths?: string[];
}

const historyListeners = new Set<(change: HistoryChange) => void>();
/** Tells every open history panel of a change made here, such as a commit recorded in this browser. */
export function announceHistoryChange(change: HistoryChange): void {
  for (const each of historyListeners) each(change);
}
/** Ends the shared stream and stops following the page. */
let stopHistoryEvents: (() => void) | undefined;
/** The server closed the stream for good, as a serverless deployment does with 204; panels then read again only after the app's own saves. */
let historyStreamEnded = false;

/** Hears of commits from the server's history stream, which every open history panel shares; returns the unsubscribe. */
export function onHistoryChanged(listener: (change: HistoryChange) => void): () => void {
  historyListeners.add(listener);
  if (!stopHistoryEvents && !historyStreamEnded && typeof EventSource !== 'undefined') {
    stopHistoryEvents = followPage(restored => {
      // A server that ended the stream for good has nothing to reopen.
      if (restored && historyStreamEnded) return { close() {} };
      const events = new EventSource(`${API_BASE}/history/events`);
      // EventSource retries a dropped connection itself and gives up only on an answer such as 204, which needs no error shown.
      events.addEventListener('error', () => {
        if (events.readyState !== EventSource.CLOSED) return;
        historyStreamEnded = true;
      });
      events.addEventListener('history', event => {
        // An event that cannot be read still names a commit, so every panel reads its history again.
        let change: HistoryChange = { repositories: [] };
        try {
          change = JSON.parse((event as MessageEvent<string>).data) as HistoryChange;
        } catch {
          console.warn('[history] unreadable history event');
        }
        for (const each of historyListeners) each(change);
      });
      // A page restored from the back/forward cache missed the commits made while it was away: every panel reads its history again.
      if (restored) { for (const each of historyListeners) each({ repositories: [] }); }
      return events;
    });
  }
  return () => {
    historyListeners.delete(listener);
    if (historyListeners.size) return;
    stopHistoryEvents?.();
    stopHistoryEvents = undefined;
  };
}
