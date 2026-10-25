import type { HistoryEntry, NoteVersion } from '@mygitnotes/core/note-versions';
import { parseNoteFile } from '@mygitnotes/core/note-file';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { demoExpired, demoScope, demoScopeOfNotebook, demoScopeOfRepository, demoScopes, noteDemoWrite } from './demo-storage.js';
import type { NoteItem } from './types.js';
import { draftScope } from './workspace-repositories.js';

/** The most commits one demo scope keeps in this browser, and the most localStorage bytes its log may take. */
export const MAX_LOCAL_COMMITS = 200;
export const MAX_LOCAL_COMMIT_BYTES = 1024 * 1024;

const KEY_PREFIX = 'gh_notes_local_commits:';
export const localCommitsKey = (scope: string) => KEY_PREFIX + scope;

/** The note as the server holds it (without its text), kept so counts and facets can subtract it while a local commit replaces it. */
export type ServerNote = Omit<NoteItem, 'content'>;

/** One note a local commit changed: its new stored text, or its deletion. */
export type LocalNoteChange = { notebookId: string; server: ServerNote | null; } & ({ raw: string; blob: string; } | { deleted: true; });

/** A commit recorded in this browser only. */
export interface LocalCommit {
  /** 40 hex digits, SHA-1 over the parent, date, message and changes, so it passes the object-id checks shared code makes. */
  id: string;
  /** The server head, or the previous local commit. */
  parent: string;
  /** ISO time; also the `authored` of the version it names. */
  date: string;
  author: string;
  message: string;
  notes: Record<string, LocalNoteChange>;
  /** Workspace document pages (Focus) by path. */
  documents: Record<string, unknown>;
  version?: { path: string; version: NoteVersion; };
}

export interface LocalCommitLog {
  version: 1;
  /** The server head when the first local commit was made. */
  base: string;
  commits: LocalCommit[];
}

/** The commit would pass what a scope may keep. */
export class LocalCommitLimitError extends Error {
  constructor() {
    super(`This demo keeps at most ${MAX_LOCAL_COMMITS} commits (1 MB) in your browser. Reset the demo to keep going.`);
  }
}

/** The scope's 24 hours had passed: its data was cleared and nothing was written. */
export class DemoExpiredError extends Error {
  constructor() {
    super("This demo's data was cleared after 24 hours. Nothing was committed; the page reloads.");
  }
}

const listeners = new Set<() => void>();
const announce = () => listeners.forEach(listener => listener());
/** Hears of every local commit and of storage changes made in another tab; returns the unsubscribe. */
export function subscribeLocalCommits(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(KEY_PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** One scope's log; null when there is none. */
export function readLocalCommits(scope: string): LocalCommitLog | null {
  const raw = localStorage.getItem(localCommitsKey(scope));
  if (!raw) return null;
  const value = JSON.parse(raw) as LocalCommitLog;
  if (value?.version !== 1 || !Array.isArray(value.commits)) throw new Error('Local demo commits could not be read. Reset the demo to continue.');
  return value;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha1 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-1', bytes as BufferSource));
/** The Git object id of a text file. */
export async function blobId(text: string): Promise<string> {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const bytes = new Uint8Array(head.length + body.length);
  bytes.set(head);
  bytes.set(body, head.length);
  return sha1(bytes);
}

/** A change as the caller gives it: a note's new stored text, or its deletion. */
export type NoteChangeInput = { notebookId: string; server: ServerNote | null; } & ({ raw: string; } | { deleted: true; });

export interface LocalCommitInput {
  message: string;
  author: string;
  notes: Record<string, NoteChangeInput>;
  documents: Record<string, unknown>;
  /** The version to record on this commit, given the file's numbers by `numberVersion` once the commit's id is known. */
  version?: { path: string; numberVersion(commit: { id: string; date: string; blob: string; }): NoteVersion; };
  now?: Date;
}

/**
 * Appends a commit to a demo scope's log and starts the scope's 24-hour clock. Refuses, before writing anything, a commit
 * that would pass 200 commits or 1 MB; `base` is the server head the log starts from.
 */
export async function appendLocalCommit(scope: string, base: string, input: LocalCommitInput): Promise<LocalCommit> {
  if (demoExpired(scope)) throw new DemoExpiredError();
  const log = readLocalCommits(scope) ?? { version: 1 as const, base, commits: [] };
  if (log.commits.length >= MAX_LOCAL_COMMITS) throw new LocalCommitLimitError();
  const notes: Record<string, LocalNoteChange> = {};
  for (const [path, change] of Object.entries(input.notes)) notes[path] = 'raw' in change ? { notebookId: change.notebookId, server: change.server, raw: change.raw, blob: await blobId(change.raw) } : { notebookId: change.notebookId, server: change.server, deleted: true };
  const parent = log.commits.at(-1)?.id ?? base, date = (input.now ?? new Date()).toISOString();
  const id = await sha1(new TextEncoder().encode(JSON.stringify([parent, date, input.message, notes, input.documents])));
  const versionBlob = input.version && notes[input.version.path] && 'blob' in notes[input.version.path] ? (notes[input.version.path] as { blob: string; }).blob : undefined;
  const commit: LocalCommit = { id, parent, date, author: input.author, message: input.message, notes, documents: input.documents, ...(input.version && versionBlob ? { version: { path: input.version.path, version: input.version.numberVersion({ id, date, blob: versionBlob }) } } : {}) };
  const text = JSON.stringify({ ...log, commits: [...log.commits, commit] });
  if (new TextEncoder().encode(text).length > MAX_LOCAL_COMMIT_BYTES) throw new LocalCommitLimitError();
  if (!noteDemoWrite(scope)) throw new DemoExpiredError();
  localStorage.setItem(localCommitsKey(scope), text);
  announce();
  return commit;
}

/** A note the commits folded to: the newest text and the server's note it replaces, or the deletion of the server's. */
export interface CommittedEntry {
  note: NoteItem;
  /** The note as the server holds it; null for a note made in the demo. */
  server: NoteItem | null;
  deleted?: true;
}
/** Committed notes by `noteRefKey`. */
export type CommittedLayer = Record<string, CommittedEntry>;

/** The note a stored text makes, in the shape the server answers with. */
export function noteFromRaw(raw: string, path: string, notebookId: string, revision?: string): NoteItem {
  const { metadata, content, title, lineNumberOffset, extra } = parseNoteFile(raw, path);
  return { id: typeof metadata.id === 'string' ? metadata.id : path, path, notebookId, title, metadata, content, lineNumberOffset, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], status: typeof metadata.status === 'string' ? metadata.status : undefined, size: raw.length, ...(revision ? { revision } : {}), ...extra };
}

const lightened = (server: ServerNote | null): NoteItem | null => server ? { ...server, content: '' } : null;

/** The commits of a log folded into the committed note of each path. */
export function committedLayer(log: LocalCommitLog | null): CommittedLayer {
  const layer: CommittedLayer = {};
  for (const commit of log?.commits ?? []) {
    for (const [path, change] of Object.entries(commit.notes)) {
      const key = noteRefKey({ notebookId: change.notebookId, path });
      const server = layer[key]?.server ?? lightened(change.server);
      layer[key] = 'raw' in change ? { note: noteFromRaw(change.raw, path, change.notebookId, commit.id), server } : { note: layer[key]?.note ?? server ?? noteFromRaw('', path, change.notebookId), server, deleted: true };
    }
  }
  return layer;
}

/** The committed Focus (and other document) pages of a log by path, the newest. */
export function committedDocuments(log: LocalCommitLog | null): Record<string, unknown> {
  return Object.assign({}, ...(log?.commits ?? []).map(commit => commit.documents));
}

/** The committed layer of the demo repositories among `repositories`. */
export function demoCommittedLayer(repositories: readonly { id: string; branch: string; demo?: true; }[]): CommittedLayer {
  return Object.assign({}, ...repositories.filter(repository => repository.demo).map(repository => committedLayer(readLocalCommits(draftScope(repository)))));
}

/** The committed entry of a note path in the demo scope serving `notebookId` (or, without one, in any demo scope). */
export function localCommittedEntry(path: string, notebookId?: string): CommittedEntry | undefined {
  const scopes = notebookId ? [demoScopeOfNotebook(notebookId)].filter(candidate => candidate !== undefined) : demoScopes();
  for (const candidate of scopes) {
    const entry = Object.values(committedLayer(readLocalCommits(candidate.scope))).find(item => item.note.path === path && (!notebookId || item.note.notebookId === notebookId));
    if (entry) return entry;
  }
  return undefined;
}

/** The scope behind a history target: by its notebook key, else by repository id. */
export function scopeOfTarget(target: { notebookId?: string; repository?: string; }) {
  return (target.notebookId ? demoScopeOfNotebook(target.notebookId) : undefined) ?? (target.repository ? demoScopeOfRepository(target.repository) : undefined) ?? (target.repository ? demoScope(target.repository) : undefined);
}

/** The commits of a scope that changed `path`, newest first, as history entries. */
export function localHistoryEntries(scope: string, path: string): (HistoryEntry & { local: true; })[] {
  const log = readLocalCommits(scope);
  return [...log?.commits ?? []].reverse().filter(commit => path in commit.notes || path in commit.documents).map(commit => {
    const change = commit.notes[path];
    const [subject, ...rest] = commit.message.split('\n');
    return { commit: commit.id, parents: [commit.parent], date: commit.date, author: commit.author, subject: subject ?? '', body: rest.join('\n').trim(), path, ...(change && 'blob' in change ? { blob: change.blob } : {}), agent: false, local: true as const };
  });
}

/** The versions the local commits of a scope recorded for `path`. */
export function localVersions(scope: string, path: string): NoteVersion[] {
  return (readLocalCommits(scope)?.commits ?? []).flatMap(commit => commit.version?.path === path ? [commit.version.version] : []);
}

/**
 * The text of `path` as local commit `commitId` held it: `null` when that commit (or the last one before it that changed
 * the path) deleted it, `undefined` when no local commit up to it changed the path (the server's text applies).
 */
export function localTextAt(scope: string, commitId: string, path: string): string | null | undefined {
  let text: string | null | undefined;
  for (const commit of readLocalCommits(scope)?.commits ?? []) {
    const change = commit.notes[path];
    if (change) text = 'raw' in change ? change.raw : null;
    if (commit.id === commitId) return text;
  }
  return undefined;
}
/** The text a local version blob names, in any local commit of a scope. */
export function localTextOfBlob(scope: string, blob: string): string | undefined {
  for (const commit of readLocalCommits(scope)?.commits ?? []) for (const change of Object.values(commit.notes)) if ('blob' in change && change.blob === blob) return change.raw;
  return undefined;
}
/** Whether a commit id belongs to a scope's local log, and the paths it changed. */
export function localCommitFiles(scope: string, commitId: string): string[] | undefined {
  const commit = readLocalCommits(scope)?.commits.find(candidate => candidate.id === commitId);
  return commit ? Object.keys(commit.notes) : undefined;
}

/** The newest stored text of `path` in a scope's local commits; undefined when none changed it, null when the last one deleted it. */
export function localCurrentRaw(scope: string, path: string): string | null | undefined {
  const commits = readLocalCommits(scope)?.commits ?? [];
  return commits.length ? localTextAt(scope, commits.at(-1)!.id, path) : undefined;
}
