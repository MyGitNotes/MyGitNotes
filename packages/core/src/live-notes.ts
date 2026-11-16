import { createHash } from 'node:crypto';
import type { CommitAuthor } from './commit-author.js';
import { isNotebookContent } from './folders.js';
import { LIVE_DEFAULT_DRAFT_LINES } from './live-default-draft.js';
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

/**
 * How live editing shows and credits a person: the name other editors see, and the email a check-in commit names them
 * by. The email is one the identity verified as theirs, or left out; a person without one is shown by name, may author
 * a check-in through their own credential, and is nobody's co-author.
 */
export interface LiveIdentity {
  name: string;
  email?: string;
}

/** Who a person-side call acts for. */
export interface LiveContext {
  person: WorkspacePerson;
  /** As SignedIn.author / BearerGrant.author. */
  author?: CommitAuthor;
  /** As SignedIn.live / BearerGrant.live: how live editing shows and credits the person. Left out, `author` does. */
  live?: LiveIdentity;
  /** The request as the configuration source saw it (for /mcp: the grant's request, no cookie). */
  request: WorkspaceRequest;
}

/** How the web app frames one repository's external editor (0.19). Static configuration. `kind` is left out, as 0.19 writes it. */
export interface LiveFrameEditorInfo {
  kind?: 'frame';
  /** Origin of every editorUrl and embedUrl: https (http only on a loopback host), with no path. */
  origin: string;
  /** `type` of the status messages the embedded editor posts; the app posts `<messageType>:theme` back. */
  messageType: string;
  /** Query parameter that takes `light` or `dark` on the embed URL. Left out, none is added. */
  themeParam?: string;
}
/** The built-in editor: MyGitNotes' own editor over `/live/socket` on the app's origin. */
export interface LiveBuiltinEditorInfo {
  kind: 'builtin';
}
/** A repository's live editor: a framed external one, or the built-in one. */
export type LiveEditorInfo = LiveFrameEditorInfo | LiveBuiltinEditorInfo;
export const isBuiltinEditor = (info: LiveEditorInfo): info is LiveBuiltinEditorInfo => info.kind === 'builtin';

/** How live editing shows and credits the person of a context: its `live`, else its `author`. */
export const liveIdentityOf = (context: Pick<LiveContext, 'author' | 'live'>): LiveIdentity | undefined => context.live ?? context.author;

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
  /** Present, and on the editor's origin, exactly for a framed editor. */
  editorUrl?: string;
  embedUrl?: string;
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
  /** The editor's verified email, as `SignedIn.author` gives it; check-in commits are authored by it. */
  email?: string;
  agent: boolean;
  firstAt: string;
  lastAt: string;
  /**
   * Who the editor signed in as, where the adapter's check-ins commit with the editors' own credentials: the engine
   * opens the repository as one of them (`service.open`'s `as`). Left out, as a 0.20 adapter leaves it, the
   * deployment's own credential commits.
   */
  person?: WorkspacePerson;
}

/** What a signed-in person, or a write grant, may ask of the adapter. */
export interface LivePersonCalls {
  /** Live links only; the adapter may cache the list up to 10 s. */
  checkouts(repository: RepositoryId): Promise<LiveCheckout[]>;
  /** Fresh. A pending note may carry its `initialText`, as in {@link LiveDetail}, for the discard precheck to judge it by. */
  read(repository: RepositoryId, id: string): Promise<LiveText & { initialText?: string; }>;
  write(repository: RepositoryId, id: string, change: { content: string; baseRevision: string; agent: boolean; }): Promise<{ liveRevision: string; changed: boolean; }>;
  append(repository: RepositoryId, id: string, change: { text: string; agent: boolean; }): Promise<{ liveRevision: string; }>;
  checkout(repository: RepositoryId, request: { notebook: NotebookKey; path: string; base: { commit: string; blob: string; content: string; }; }): Promise<{ checkout: LiveCheckout; outcome: 'created' | 'joined' | 'reopened'; }>;
  createPending(repository: RepositoryId, request: { notebook: NotebookKey; pathRule: string; content: string; }): Promise<LiveCheckout>;
  /** Where a link that is no longer live was filed; null when unknown. */
  filed(repository: RepositoryId, id: string): Promise<string | null>;
  /**
   * Merges `request.text`, written on `request.base`, into the live note over the typing since, as a three-way merge,
   * and lists the person among its editors; texts come in normal form. A conflict takes nothing. A repeat of the same
   * `mergeId` by the same person for the same link answers what the first answered for at least a day, also after the
   * note was released and reopened, and takes nothing again. An adapter without it keeps 0.20's behavior: a text made
   * off the live note is committed by hand, or copied.
   */
  merge?(repository: RepositoryId, id: string, request: LiveMergeRequest): Promise<LiveMergeAnswer>;
}

/**
 * A text to take into a live note (docs/specs/2026-11-16-collab-first-self-host A4): `text`, written on `base`, such as
 * a draft made offline on the text Git held, or what a tab typed after its note was released. The writer names the
 * base; it only decides how their own text lands, and they could write any text anyway.
 */
export interface LiveMergeRequest {
  base: string;
  text: string;
  /** Names this merge for its writer ({@link isLiveMergeId}): asked again under the same id, the first answer is given and nothing is taken twice. */
  mergeId: string;
}
/** A merge landed, the note then reading the text `contentHash` names; or it changed what the live note changed too, and nothing was taken. */
export type LiveMergeAnswer = { applied: true; contentHash: string; } | { conflict: true; };

export interface LiveLease {
  token: string;
  until: string;
}
/** The live text with its row and the editors since the last sync, with their email. */
export interface LiveDetail extends LiveText {
  checkout: LiveCheckout;
  editors: LiveEditor[];
  /** A pending note: the text its link was created with. Left out, a draft's whole body is judged ({@link isEmptyLiveDraft}). */
  initialText?: string;
}
export type LiveRelease = { released: true; } | { released: false; reason: 'active' | 'changed' | 'not-synced'; activeEditors?: number; };

/** Whom `service.open` opens a repository as. */
export interface LiveOpenAs {
  /** The editor whose own credential the check-in commits with; left out, the deployment's own. */
  person?: WorkspacePerson;
}

/** What the check-in engine asks of the adapter, with the deployment's own credential. */
export interface LiveServiceCalls {
  /** Repositories with live links. */
  repositories(): Promise<RepositoryId[]>;
  checkouts(repository: RepositoryId): Promise<LiveCheckout[]>;
  /**
   * The repository to commit a check-in through; its commits are authored by `author` (none: the credential's
   * account). With `as.person`, an adapter that lists its editors' persons opens it with that person's own credential,
   * and throws {@link LiveCredentialError} when they cannot commit there; the engine then asks as the next editor.
   * Without `as`, and in an adapter that takes none (0.20), it is the deployment's own write credential.
   */
  open(repository: RepositoryId, author?: CommitAuthor, as?: LiveOpenAs): Promise<RemoteSource>;
  lease(repository: RepositoryId, id: string): Promise<LiveLease>;
  detail(repository: RepositoryId, id: string, lease: LiveLease): Promise<LiveDetail>;
  mergeIn(repository: RepositoryId, id: string, lease: LiveLease, change: { content: string; baseRevision: string; }): Promise<{ liveRevision: string; }>;
  synced(repository: RepositoryId, id: string, lease: LiveLease, receipt: { commit: string; blob: string; contentHash: string; path: string; conflict: LiveConflict | null; }): Promise<void>;
  release(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease>;
  /**
   * Drops a pending note (no path) and its live text without a commit; refused like `release` when someone is editing
   * (`active`) or the text is not the one checked (`changed`). The link is gone after it: `filed` answers nothing for it.
   * An adapter without it keeps every pending note until a check-in files it, as in 0.19.
   */
  discard?(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease>;
  /**
   * Sets the path rule a pending note (no path) is filed by at its first check-in, and answers its row with that
   * `pathRule`; nothing is committed and its text is not touched, so open editors do not hold it. A note with a path is
   * refused with {@link LiveNotLiveError}. The lease ends with the call, whether it retargets or refuses, so it never
   * holds a check-in off. An adapter without it keeps each pending note's rule as it was created, as in 0.19.
   */
  retarget?(repository: RepositoryId, id: string, lease: LiveLease, request: { pathRule: string; }): Promise<LiveCheckout>;
  /**
   * Ends `lease` while the note stays live: a check-in that did not release the note (refused, unfiled, or failed) calls
   * it, so the next check-in, such as 「立即簽回」 again, need not wait for the lease to run out. A lease another holder
   * took meanwhile is left alone. An adapter without it keeps each such lease until it runs out, as in 0.19.
   */
  unlease?(repository: RepositoryId, id: string, lease: LiveLease): Promise<void>;
}

export interface LiveNotice {
  /** `uncommittable`: no credential the check-in could try may commit the note; it stays live and is tried again. */
  kind: 'conflict' | 'deleted' | 'unfiled' | 'uncommittable';
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
  /** Required when `editors` declares a builtin editor: a ticket for the person to open the link's live document. */
  socketTicket?(context: LiveContext, repository: RepositoryId, id: string): Promise<LiveSocketTicket>;
}

/** What opens a link's live document over the built-in editor's socket. */
export interface LiveSocketTicket {
  /** Opaque, single use, valid 60 s. */
  ticket: string;
  /** The Yjs document to open: `<link id>.<epoch>`. */
  document: string;
}
const SOCKET_TICKET = /^[A-Za-z0-9_-]{32,128}$/;
const SOCKET_DOCUMENT = /^[A-Za-z0-9_-]{1,64}\.[1-9][0-9]{0,9}$/;

/** A socket ticket an adapter returned, checked and reduced to its fields; null for a bad one. */
export function liveSocketTicketOf(value: unknown): LiveSocketTicket | null {
  if (!value || typeof value !== 'object') return null;
  const { ticket, document } = value as Record<string, unknown>;
  return typeof ticket === 'string' && SOCKET_TICKET.test(ticket) && typeof document === 'string' && SOCKET_DOCUMENT.test(document) ? { ticket, document } : null;
}

/** The frontmatter block a note opens with, as `parseNoteContent` finds it. */
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
/** What makes a line content: a letter, a digit, or an image or embed. */
const DRAFT_CONTENT = /[\p{L}\p{N}]|!\[|<(img|iframe|video)\b/iu;

/**
 * Whether a pending note is an empty draft (docs/specs/2026-11-15-builtin-live-editor §19.1): once the lines of its
 * initial body, or without `initialText` the web's default new-note lines ({@link LIVE_DEFAULT_DRAFT_LINES}), are taken
 * out of its body, one each, what is left holds no letter, digit, image or embed. Whitespace, punctuation, Markdown
 * markers and emoji alone are empty; the frontmatter never counts, and lines are compared whole, without the whitespace
 * around them. The default lines are never taken out on top of an initial text's, so a line typed a second time counts.
 */
export function isEmptyLiveDraft(text: string, initialText?: string): boolean {
  const lines = (value: string) => normalizeLiveText(value).replace(FRONTMATTER_BLOCK, '').split('\n').map(line => line.trim());
  const initial = new Map<string, number>();
  for (const line of initialText === undefined ? LIVE_DEFAULT_DRAFT_LINES : lines(initialText)) initial.set(line, (initial.get(line) ?? 0) + 1);
  return lines(text).every(line => {
    const left = initial.get(line) ?? 0;
    if (left > 0) {
      initial.set(line, left - 1);
      return true;
    }
    return !DRAFT_CONTENT.test(line);
  });
}

/** The initial text a detail or read gave a pending note, if a usable one. */
export function liveInitialTextOf(value: unknown): string | undefined {
  const initial = (value as { initialText?: unknown; } | null)?.initialText;
  return typeof initial === 'string' && Buffer.byteLength(initial, 'utf8') <= LIVE_MAX_BYTES ? initial : undefined;
}

/** What names a merge: 8 to 128 letters, digits, `_` or `-`, such as a hash of the draft it merges. */
export function isLiveMergeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

/** A merge answer an adapter returned, checked and reduced to its fields; anything else is a {@link LiveUnavailableError}. */
export function liveMergeAnswerOf(value: unknown): LiveMergeAnswer {
  const { applied, conflict, contentHash } = (value ?? {}) as Record<string, unknown>;
  if (applied === true && isLiveContentHash(contentHash)) return { applied: true, contentHash };
  if (conflict === true && applied === undefined) return { conflict: true };
  throw new LiveUnavailableError();
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
/**
 * The person `service.open` was asked to open a repository as cannot commit there: their credential is missing,
 * refused, revoked or expired, or it may not write. The check-in tries the next editor; it names no credential detail.
 */
export class LiveCredentialError extends SourceError {
  constructor(message = "This person's credential cannot commit to the repository.") {
    super(message, 403);
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

/** The fields a JSON error answer adds for a {@link CheckedOutError}: its code and the checked-out paths. */
export function checkedOutFields(error: unknown): { code?: 'checked-out'; paths?: string[]; } {
  return error instanceof CheckedOutError ? { code: error.code, paths: error.paths } : {};
}

const LIVE_ERRORS = [LiveStaleError, LiveLeasedError, LiveNotLiveError, LiveTooLargeError, LiveCredentialError, LiveUnavailableError, CheckedOutError];

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
  const { kind, origin, messageType, themeParam } = value as Record<string, unknown>;
  if (kind === 'builtin') {
    if (Object.keys(value).some(key => key !== 'kind')) throw refuse('a builtin editor takes no other key than kind.');
    return { kind: 'builtin' };
  }
  if (kind !== undefined && kind !== 'frame') throw refuse("kind must be 'frame' or 'builtin'.");
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
  return { ...(kind === 'frame' ? { kind } : {}), origin, messageType, ...(themeParam !== undefined ? { themeParam } : {}) };
}

/**
 * The editor of a repository, checked: null where the adapter covers none, and a thrown Error for an answer that is
 * not one of the editors the adapter declared (a deployment fault, never served).
 */
export function liveEditorOf(liveNotes: Pick<LiveNotes, 'editors' | 'editor'>, repository: RepositoryId): LiveEditorInfo | null {
  const info = liveNotes.editor(repository);
  if (info === null) return null;
  const declared = isBuiltinEditor(info) ? liveNotes.editors.find(isBuiltinEditor) : liveNotes.editors.find(editor => !isBuiltinEditor(editor) && editor.origin === info.origin && editor.messageType === info.messageType && editor.themeParam === info.themeParam);
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
function onOrigin(value: unknown, editor: LiveFrameEditorInfo): value is string {
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

/**
 * What a check-in that commits nothing reads of a row, checked without the repository's notebooks, which only an
 * opened repository gives: its notebook key, its path (null while pending) and its base. Null for a row without them.
 */
export function liveRowBase(row: unknown): { notebook: NotebookKey; path: string | null; base: LiveCheckout['base']; } | null {
  if (!row || typeof row !== 'object') return null;
  const { notebook, path, base } = row as Record<string, unknown>;
  const known = baseOf(base);
  if (typeof notebook !== 'string' || !notebook || notebook.length > 512 || (path !== null && (typeof path !== 'string' || !isRelativePath(path))) || known === undefined) return null;
  return { notebook, path, base: known };
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
  // A framed editor's rows carry both URLs on its origin; a built-in editor's URLs, if any, are ignored and dropped.
  if (!isBuiltinEditor(context.editor) && (!onOrigin(editorUrl, context.editor) || !onOrigin(embedUrl, context.editor))) return 'a URL off the editor origin';
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
  return { id: value.id, notebook: value.notebook as string, path: value.path as string | null, ...(pending ? { pathRule: value.pathRule as string } : {}), since: value.since as string, ...(isBuiltinEditor(context.editor) ? {} : { editorUrl: value.editorUrl as string, embedUrl: value.embedUrl as string }), contentHash: value.contentHash as string, activeEditors: value.activeEditors as number, lastEditAt: value.lastEditAt as string | null, syncedAt: value.syncedAt as string | null, base: baseOf(value.base)!, conflict: conflictOf(value.conflict)! };
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
