import { createHash } from 'node:crypto';
import type { CommitAuthor } from './commit-author.js';
import { isNotebookContent } from './folders.js';
import { SourceError } from './github-api.js';
import type { NotebookKey } from './notebook-key.js';
import { isOutlinePath } from './outline.js';
import type { RemoteSource } from './remote-source.js';
import type { RepositoryId } from './repository.js';
import type { NotebookConfig } from './types.js';
import type { WorkspacePerson, WorkspaceRequest } from './workspace-config-source.js';

/*
 * The seam an edition fills to hand a remote repository's notes to an external live (co-)editor
 * (docs/specs/2026-11-15-live-notes/spec.md §1). The community edition names no particular editor: it holds the
 * contract, the checks on every value an adapter returns, and the helpers both sides share.
 */

/** Who a person-side call acts for. */
export interface LiveContext {
  person: WorkspacePerson;
  /** As SignedIn.author / BearerGrant.author. */
  author?: CommitAuthor;
  /** The request as the configuration source saw it (for /mcp: the grant's request, no cookie). */
  request: WorkspaceRequest;
}

/** How the web app frames one repository's editor. Static configuration. */
export interface LiveEditorInfo {
  /** Origin of every editorUrl and embedUrl: https (http only on a loopback host), with no path. */
  origin: string;
  /** `type` of the status messages the embedded editor posts; the app posts `<messageType>:theme` back. */
  messageType: string;
  /** Query parameter that takes `light` or `dark` on the embed URL. Left out, none is added. */
  themeParam?: string;
}

/** What a check-in overwrote: Git changes that lost to the live text, or a note deleted in Git and written back. */
export interface LiveConflict {
  kind: 'overwrote' | 'deleted';
  /** The newest commit whose change the check-in overwrote. */
  overwritten: string;
  /** The check-in's own commit. */
  commit: string;
  at: string;
}

/** One live link: a note checked out to the editor, or a pending note created there. */
export interface LiveCheckout {
  /** Matches {@link LIVE_ID_PATTERN}. */
  id: string;
  /** As checkout/createPending was given it. */
  notebook: NotebookKey;
  /** Repository-relative; null while pending. */
  path: string | null;
  /** Pending only: the notebook-relative path pattern the first check-in files the note at. */
  pathRule?: string;
  /** ISO: when this checkout or reopen began. */
  since: string;
  editorUrl: string;
  embedUrl: string;
  /** sha256 hex of the current text in normal form. */
  contentHash: string;
  /** Connected, non-idle editors. */
  activeEditors: number;
  lastEditAt: string | null;
  syncedAt: string | null;
  /** The Git state the live text was last synced with; null for a pending note never synced. */
  base: { commit: string; blob: string; contentHash: string; } | null;
  conflict: LiveConflict | null;
}
export interface LiveText {
  content: string;
  liveRevision: string;
  contentHash: string;
}
export interface LiveEditor {
  name: string;
  email?: string;
  agent: boolean;
  firstAt: string;
  lastAt: string;
}

/** What a signed-in person, or a write grant, may ask of the adapter. */
export interface LivePersonCalls {
  /** Live links only; the adapter may cache the list up to 10 s. */
  checkouts(repository: RepositoryId): Promise<LiveCheckout[]>;
  /** Fresh. */
  read(repository: RepositoryId, id: string): Promise<LiveText>;
  write(repository: RepositoryId, id: string, change: { content: string; baseRevision: string; agent: boolean; }): Promise<{ liveRevision: string; changed: boolean; }>;
  append(repository: RepositoryId, id: string, change: { text: string; agent: boolean; }): Promise<{ liveRevision: string; }>;
  checkout(repository: RepositoryId, request: { notebook: NotebookKey; path: string; base: { commit: string; blob: string; content: string; }; }): Promise<{ checkout: LiveCheckout; outcome: 'created' | 'joined' | 'reopened'; }>;
  createPending(repository: RepositoryId, request: { notebook: NotebookKey; pathRule: string; content: string; }): Promise<LiveCheckout>;
  /** Where a link that is no longer live was filed; null when unknown. */
  filed(repository: RepositoryId, id: string): Promise<string | null>;
}

export interface LiveLease {
  token: string;
  until: string;
}
/** The live text with its row and the editors since the last sync, with their email. */
export interface LiveDetail extends LiveText {
  checkout: LiveCheckout;
  editors: LiveEditor[];
}
export type LiveRelease = { released: true; } | { released: false; reason: 'active' | 'changed' | 'not-synced'; activeEditors?: number; };

/** What the check-in engine asks of the adapter, with the deployment's own credential. */
export interface LiveServiceCalls {
  /** Repositories with live links. */
  repositories(): Promise<RepositoryId[]>;
  checkouts(repository: RepositoryId): Promise<LiveCheckout[]>;
  /** The repository with the deployment's own write credential; its commits are authored by `author` (none: the credential's account). */
  open(repository: RepositoryId, author?: CommitAuthor): Promise<RemoteSource>;
  lease(repository: RepositoryId, id: string): Promise<LiveLease>;
  detail(repository: RepositoryId, id: string, lease: LiveLease): Promise<LiveDetail>;
  mergeIn(repository: RepositoryId, id: string, lease: LiveLease, change: { content: string; baseRevision: string; }): Promise<{ liveRevision: string; }>;
  synced(repository: RepositoryId, id: string, lease: LiveLease, receipt: { commit: string; blob: string; contentHash: string; path: string; conflict: LiveConflict | null; }): Promise<void>;
  release(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease>;
}

export interface LiveNotice {
  kind: 'conflict' | 'deleted' | 'unfiled';
  repository: RepositoryId;
  notebook: NotebookKey;
  path: string | null;
  id: string;
  commit?: string;
  overwritten?: string;
  editors: { name: string; }[];
  message: string;
}

/** An edition's live editor (`AppServices.liveNotes`). */
export interface LiveNotes {
  /**
   * Every editor configuration `editor()` may answer. `createApp` validates each at start, so a bad origin stops the
   * deployment before anyone frames it, and an answer of `editor()` outside this list is refused ({@link liveEditorOf}).
   */
  readonly editors: readonly LiveEditorInfo[];
  /** The editor a repository's notes go to; null for a repository the adapter does not cover. */
  editor(repository: RepositoryId): LiveEditorInfo | null;
  person(context: LiveContext): LivePersonCalls;
  service: LiveServiceCalls;
  notify?(notice: LiveNotice): Promise<void>;
}

/** What a live link id may be. */
export const LIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** The largest live text, in UTF-8 bytes, as for other writes. */
export const LIVE_MAX_BYTES = 5 * 1024 * 1024;
/** The dot folder of a notebook root that holds pending notes' virtual paths. */
export const LIVE_PENDING_FOLDER = '.live';

/** The base text can no longer be reconstructed: the caller reads again. */
export class LiveStaleError extends SourceError {
  constructor(message = 'The note changed in the live editor. Read it again.') {
    super(message, 409);
  }
}
/** Someone else holds the link's lease, or the lease given is not the link's. */
export class LiveLeasedError extends SourceError {
  constructor(message = 'The live note is being checked in elsewhere.') {
    super(message, 409);
  }
}
/** The link was released: the note is no longer live. */
export class LiveNotLiveError extends SourceError {
  constructor(message = 'The note is no longer open in the live editor.') {
    super(message, 409);
  }
}
/** The editor refuses a text this large. */
export class LiveTooLargeError extends SourceError {
  constructor(message = 'The note is too large for the live editor.') {
    super(message, 413);
  }
}
/** Any other adapter failure: it names no adapter detail. */
export class LiveUnavailableError extends SourceError {
  constructor() {
    super('Live editor unavailable.', 502);
  }
}
/** A Git write that would touch notes checked out to the live editor (編輯中). */
export class CheckedOutError extends SourceError {
  readonly code = 'checked-out';
  readonly paths: string[];
  constructor(paths: readonly string[], message?: string) {
    const shown = paths.slice(0, 20).join(', ') + (paths.length > 20 ? ` and ${paths.length - 20} more` : '');
    super(message ?? `Checked out to the live editor (編輯中): ${shown}. Read the note again, or check it in with check_in_note first.`, 409);
    this.paths = [...paths];
  }
}

const LIVE_ERRORS = [LiveStaleError, LiveLeasedError, LiveNotLiveError, LiveTooLargeError, LiveUnavailableError, CheckedOutError];

/** An adapter failure as the community reports it: one of the live errors as thrown, anything else a 502 that names no detail. */
export function liveAdapterError(error: unknown): SourceError {
  return LIVE_ERRORS.some(type => error instanceof type) ? error as SourceError : new LiveUnavailableError();
}

/** The text in normal form: every `\r` and NUL removed. The community sends, and compares, live texts only in it. */
export function normalizeLiveText(text: string): string {
  return text.replace(/[\r\0]/g, '');
}

/** sha256 hex of the UTF-8 normal form. */
export function liveContentHash(text: string): string {
  return createHash('sha256').update(Buffer.from(normalizeLiveText(text), 'utf8')).digest('hex');
}

export function isLiveId(value: unknown): value is string {
  return typeof value === 'string' && LIVE_ID_PATTERN.test(value);
}

/** Printable ASCII, 1 to 256 characters. */
export function isLiveRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[\x20-\x7e]{1,256}$/.test(value);
}

export function isLiveContentHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

const GIT_OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** The editor configuration as written, or a thrown Error saying what is wrong with it. */
export function validateLiveEditorInfo(value: unknown): LiveEditorInfo {
  const refuse = (why: string) => new Error(`Invalid live editor configuration: ${why}`);
  if (!value || typeof value !== 'object') throw refuse('it is not an object.');
  const { origin, messageType, themeParam } = value as Record<string, unknown>;
  if (typeof origin !== 'string') throw refuse('origin is not a string.');
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw refuse('origin is not a URL.');
  }
  // `url.origin` drops a path, query, credentials and a trailing slash and lowercases the host, so only a bare canonical origin equals it.
  if (url.origin !== origin || url.username || url.password) throw refuse('origin must be a bare origin with no path, such as https://editor.example.com.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname))) throw refuse('origin must use https (http only on a loopback host).');
  if (typeof messageType !== 'string' || !TOKEN.test(messageType)) throw refuse('messageType must be 1 to 64 letters, digits, _ or -.');
  if (themeParam !== undefined && (typeof themeParam !== 'string' || !TOKEN.test(themeParam))) throw refuse('themeParam must be 1 to 64 letters, digits, _ or -.');
  return { origin, messageType, ...(themeParam !== undefined ? { themeParam } : {}) };
}

/**
 * The editor of a repository, checked: null where the adapter covers none, and a thrown Error for an answer that is
 * not one of the editors the adapter declared (a deployment fault, never served).
 */
export function liveEditorOf(liveNotes: Pick<LiveNotes, 'editors' | 'editor'>, repository: RepositoryId): LiveEditorInfo | null {
  const info = liveNotes.editor(repository);
  if (info === null) return null;
  const declared = liveNotes.editors.find(editor => editor.origin === info.origin && editor.messageType === info.messageType && editor.themeParam === info.themeParam);
  if (!declared) throw new Error('The live editor of a repository is not one the adapter declared in `editors`.');
  return declared;
}

/** Whether a notebook-relative path is a note the live editor takes: Markdown notebook content that is no outline. */
export function isLiveNotePath(relative: string, notebook: NotebookConfig): boolean {
  return /\.(md|markdown)$/i.test(relative) && !isOutlinePath(relative) && isNotebookContent(relative, notebook);
}

/** The virtual path of a pending note: `<root>/.live/<id>.md`. A dot folder is never notebook content, so it cannot be a Git note. */
export function livePendingPath(notebookRoot: string, id: string): string {
  if (!isLiveId(id)) throw new Error('Invalid live link id.');
  return `${notebookRoot}/${LIVE_PENDING_FOLDER}/${id}.md`;
}

/** The notebook and id of a pending note's virtual path; null for any other path. */
export function parseLivePendingPath<T extends { root: string; }>(file: string, notebooks: readonly T[]): { notebook: T; id: string; } | null {
  const notebook = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(entry => file.startsWith(`${entry.root}/`));
  if (!notebook) return null;
  const match = /^\.live\/([A-Za-z0-9_-]{1,64})\.md$/.exec(file.slice(notebook.root.length + 1));
  return match ? { notebook, id: match[1] } : null;
}

const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
const isRelativePath = (value: string) => value.length <= 1024 && !/[\\\p{Cc}]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');

/** Where a URL an adapter gave may point: the editor's origin, with no credentials. */
function onOrigin(value: unknown, editor: LiveEditorInfo): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin === editor.origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

function conflictOf(value: unknown): LiveConflict | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const { kind, overwritten, commit, at } = value as Record<string, unknown>;
  if ((kind !== 'overwrote' && kind !== 'deleted') || typeof overwritten !== 'string' || !GIT_OBJECT_ID.test(overwritten) || typeof commit !== 'string' || !GIT_OBJECT_ID.test(commit) || !isTime(at)) return undefined;
  return { kind, overwritten, commit, at };
}

function baseOf(value: unknown): LiveCheckout['base'] | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const { commit, blob, contentHash } = value as Record<string, unknown>;
  if (typeof commit !== 'string' || !GIT_OBJECT_ID.test(commit) || typeof blob !== 'string' || !GIT_OBJECT_ID.test(blob) || !isLiveContentHash(contentHash)) return undefined;
  return { commit, blob, contentHash };
}

/** Why a row is not a valid checkout; undefined when it is. */
function checkoutProblem(row: Record<string, unknown>, context: LiveRowContext): string | undefined {
  const { notebook: key, path, pathRule, since, editorUrl, embedUrl, contentHash, activeEditors, lastEditAt, syncedAt } = row;
  if (typeof key !== 'string') return 'no notebook';
  const notebook = context.notebook(key);
  if (!notebook) return 'an unknown notebook';
  if (path === null) {
    if (typeof pathRule !== 'string' || !isRelativePath(pathRule)) return 'a pending note without a valid path rule';
  } else if (typeof path !== 'string' || !isRelativePath(path) || !path.startsWith(`${notebook.root}/`) || !isLiveNotePath(path.slice(notebook.root.length + 1), notebook)) return 'a path that is not a note of its notebook';
  if (!isTime(since)) return 'an invalid since';
  if (!onOrigin(editorUrl, context.editor) || !onOrigin(embedUrl, context.editor)) return 'a URL off the editor origin';
  if (!isLiveContentHash(contentHash)) return 'an invalid content hash';
  if (typeof activeEditors !== 'number' || !Number.isInteger(activeEditors) || activeEditors < 0 || activeEditors > 10_000) return 'an invalid editor count';
  if (lastEditAt !== null && !isTime(lastEditAt)) return 'an invalid lastEditAt';
  if (syncedAt !== null && !isTime(syncedAt)) return 'an invalid syncedAt';
  if (baseOf(row.base) === undefined) return 'an invalid base';
  if (conflictOf(row.conflict) === undefined) return 'an invalid conflict';
  return undefined;
}

/** What a row is checked against: the repository's editor, and its notebooks by key. */
export interface LiveRowContext {
  editor: LiveEditorInfo;
  notebook(key: NotebookKey): NotebookConfig | undefined;
}

/**
 * A row an adapter returned, checked before use and reduced to the contract's fields; null for a bad row, which is
 * logged by its id (or as an invalid id) and nothing else, since a row may hold anything.
 */
export function liveCheckoutOf(row: unknown, context: LiveRowContext): LiveCheckout | null {
  if (!row || typeof row !== 'object') {
    console.warn('[live-notes] dropped a live link row that is not an object');
    return null;
  }
  const value = row as Record<string, unknown>;
  if (!isLiveId(value.id)) {
    console.warn('[live-notes] dropped a live link row with an invalid id');
    return null;
  }
  const problem = checkoutProblem(value, context);
  if (problem) {
    console.warn(`[live-notes] dropped live link ${value.id}: ${problem}`);
    return null;
  }
  const pending = value.path === null;
  return { id: value.id, notebook: value.notebook as string, path: value.path as string | null, ...(pending ? { pathRule: value.pathRule as string } : {}), since: value.since as string, editorUrl: value.editorUrl as string, embedUrl: value.embedUrl as string, contentHash: value.contentHash as string, activeEditors: value.activeEditors as number, lastEditAt: value.lastEditAt as string | null, syncedAt: value.syncedAt as string | null, base: baseOf(value.base)!, conflict: conflictOf(value.conflict)! };
}

/**
 * A text an adapter returned, checked: a printable ASCII revision of at most 256 characters, and a hash that is the
 * text's own. A bad one is a {@link LiveUnavailableError}; one past {@link LIVE_MAX_BYTES} a {@link LiveTooLargeError}.
 */
export function liveTextOf(value: unknown): LiveText {
  if (!value || typeof value !== 'object') throw new LiveUnavailableError();
  const { content, liveRevision, contentHash } = value as Record<string, unknown>;
  if (typeof content !== 'string' || !isLiveRevision(liveRevision) || !isLiveContentHash(contentHash)) throw new LiveUnavailableError();
  if (Buffer.byteLength(content, 'utf8') > LIVE_MAX_BYTES) throw new LiveTooLargeError();
  if (liveContentHash(content) !== contentHash) throw new LiveUnavailableError();
  return { content, liveRevision, contentHash };
}
