import { createHash } from 'node:crypto';
import type { CommitAuthor } from './commit-author.js';
import { isNotebookContent } from './folders.js';
// The frontmatter block a note opens with, as `parseNoteContent` finds it.
import { FRONTMATTER_REGEX } from './frontmatter-patch.js';
import { parseNoteContent } from './frontmatter.js';
import { LIVE_DEFAULT_DRAFT_LINES, LIVE_DEFAULT_DRAFT_TITLES } from './live-default-draft.js';
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

/** How many of a live note's {@link LiveCheckout.formerPaths} count: the latest. */
export const LIVE_FORMER_PATHS = 8;

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
  /**
   * Filed only, where the adapter can retarget: the repository path the next check-in moves the note to, in one commit
   * with the links to it rewritten (docs/specs/2026-11-15-builtin-live-editor §20.4). Reads know the note by it meanwhile.
   */
  target?: string;
  /**
   * With `target`: who moved the note there, where the adapter keeps it. The check-in that moves it lists them as a
   * co-author (the owner's rule: a move is credited to whoever moved it), unless they author that commit.
   */
  movedBy?: LiveIdentity;
  /**
   * Filed only: a target the last check-in did not move the note to, since Git held that path, or as `unmovedReason`
   * says; the next move clears it.
   */
  unmoved?: string;
  /** With `unmoved`, why the note stayed when not because Git held its target: `too-large`, the move would change too much. */
  unmovedReason?: LiveUnmovedReason;
  /**
   * Filed only, where the adapter can retarget: the repository paths reads knew the note by earlier while it was live and
   * no longer do, oldest first, at most {@link LIVE_FORMER_PATHS}: each target a later move replaced, and the path a
   * check-in moved it from. A tab, address or open editor still at one finds the note where it is now, as long as Git
   * holds no file there and no other live note is read there. Left out by an adapter that keeps none.
   */
  formerPaths?: string[];
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
  /**
   * How many people other than the one asking have the live note open now, connected, whether or not they typed lately:
   * a move from the mover's own editor is checked in at once only when this is 0 (§20.4 of the built-in editor spec).
   * An adapter without it is judged by `activeEditors`, the mover counted among them when they edit it.
   */
  othersEditing?(repository: RepositoryId, id: string): Promise<number>;
  /** Fresh. A pending note may carry its `initialText`, as in {@link LiveDetail}, for the discard precheck to judge it by. */
  read(repository: RepositoryId, id: string): Promise<LiveText & { initialText?: string; }>;
  write(repository: RepositoryId, id: string, change: { content: string; baseRevision: string; agent: boolean; }): Promise<{ liveRevision: string; changed: boolean; }>;
  append(repository: RepositoryId, id: string, change: { text: string; agent: boolean; }): Promise<{ liveRevision: string; }>;
  checkout(repository: RepositoryId, request: { notebook: NotebookKey; path: string; base: { commit: string; blob: string; content: string; }; }): Promise<{ checkout: LiveCheckout; outcome: 'created' | 'joined' | 'reopened'; }>;
  createPending(repository: RepositoryId, request: { notebook: NotebookKey; pathRule: string; content: string; }): Promise<LiveCheckout>;
  /** Where a link that is no longer live was filed; null when unknown. */
  filed(repository: RepositoryId, id: string): Promise<string | null>;
  /**
   * The id of the link, live or no longer live, that reads knew at the repository path `path` and that left it last:
   * a target a later move replaced, or the path a check-in moved it from (its {@link LiveCheckout.formerPaths}, also
   * after its release, a reopen, and beyond the latest few). A tab, address or open editor still at `path` then finds
   * the note where it is now, live or where it was filed, as long as Git holds no file at `path`. Null for none, and
   * while that link is read at `path` again. An adapter without it is asked only for its live links' `formerPaths`, and
   * a path that is no longer live leads nowhere.
   */
  leftFrom?(repository: RepositoryId, path: string): Promise<string | null>;
  /**
   * Forgets that link `id` left `path`, once Git holds a file there: the path is that file's, and stops leading to the
   * note for good, also once the file is deleted or moved away. A record another link left there later is kept. Part of
   * `leftFrom`; an adapter with it has this too.
   */
  forgetLeft?(repository: RepositoryId, path: string, id: string): Promise<void>;
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
  /**
   * What a built-in editor tab typed `text` in: the Yjs document of an epoch that has ended (`<link id>.<epoch>`), and the
   * tab's whole update of it. An adapter that still knows the text that document ended with takes it as the base, and
   * the update applied to it as the text, so typing the server stored before the tab heard so lands once; one that no
   * longer knows it merges on `base` as an uncertain one (`rebaseLiveText`'s `uncertainBase`).
   */
  typedIn?: LiveTypedIn;
}
/** See {@link LiveMergeRequest.typedIn}. */
export interface LiveTypedIn {
  document: string;
  update: Uint8Array;
}
/** Whether a value is a {@link LiveTypedIn}: a live document's name and a Yjs update. */
export function isLiveTypedIn(value: unknown): value is LiveTypedIn {
  const typed = value as LiveTypedIn | null;
  return typeof typed === 'object' && typed !== null && typeof typed.document === 'string' && LIVE_DOCUMENT_PATTERN.test(typed.document) && typed.update instanceof Uint8Array;
}
/** A merge landed, the note then reading the text `contentHash` names; or it changed what the live note changed too, and nothing was taken. */
export type LiveMergeAnswer = { applied: true; contentHash: string; } | { conflict: true; };

export interface LiveLease {
  token: string;
  until: string;
}
/**
 * Why a check-in kept a moving note where it lies though its target was free: `too-large`, the move would change more
 * files or bytes than a commit takes (§20.4 of the built-in editor spec). A target Git holds needs no reason.
 */
export type LiveUnmovedReason = 'too-large';
export const isLiveUnmovedReason = (value: unknown): value is LiveUnmovedReason => value === 'too-large';
/** What `retarget` sets: a pending note's path rule, or where a filed note moves at its next check-in. */
export type LiveRetargetRequest = { pathRule: string; } | { target: string | null; movedBy?: LiveIdentity; };
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
  /**
   * `mergeIn`, taken at most once per `key` for the link: the merge and the record that `key` was taken are one step,
   * kept for at least a day, also past a release and a reopen, so a repeat under the same key takes nothing and answers
   * `repeated`. A check-in writes the rewrite of a moved note's own links back into its live text this way, keyed by the
   * move, so the check-in after a write-back that failed or lost its answer knows whether to take it (LMR-F001): taken,
   * it is not taken twice; not taken, it is taken then, on the text as typed since. An adapter without it leaves the
   * check-in to tell by the text's lines.
   */
  mergeInOnce?(repository: RepositoryId, id: string, lease: LiveLease, change: { content: string; baseRevision: string; key: string; }): Promise<{ liveRevision: string; repeated: boolean; }>;
  /**
   * Records a check-in's commit. A receipt for a note moving elsewhere names its target (moved there) or its path (kept
   * there, its target recorded as `unmoved`, with `unmovedReason` when it is not that Git held the target).
   */
  synced(repository: RepositoryId, id: string, lease: LiveLease, receipt: { commit: string; blob: string; contentHash: string; path: string; conflict: LiveConflict | null; unmovedReason?: LiveUnmovedReason; }): Promise<void>;
  release(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease>;
  /**
   * Drops a pending note (no path) and its live text without a commit; refused like `release` when someone is editing
   * (`active`) or the text is not the one checked (`changed`). The link is gone after it: `filed` answers nothing for it.
   * An adapter without it keeps every pending note until a check-in files it, as in 0.19.
   */
  discard?(repository: RepositoryId, id: string, lease: LiveLease, check: { contentHash: string; }): Promise<LiveRelease>;
  /**
   * Sets the path rule a pending note (no path) is filed by at its first check-in, or with `target` the repository path
   * a filed note moves to at its next check-in (null: it stays where it is), and answers its row with that `pathRule` or
   * `target`; a target also clears `unmoved`. Nothing is committed and its text is not touched, so open editors do not
   * hold it. A path rule for a note with a path, or a target for a pending note, is refused with
   * {@link LiveNotLiveError}. The lease ends with the call, whether it retargets or refuses, so it never holds a check-in
   * off. The check-in then commits the move and names the target in its receipt (`synced`), which moves the link there;
   * a receipt that names the note's path instead keeps it there and records the target as `unmoved`. An adapter without
   * it keeps each pending note's rule as it was created, as in 0.19, and a filed note cannot move while it is live.
   */
  retarget?(repository: RepositoryId, id: string, lease: LiveLease, request: LiveRetargetRequest): Promise<LiveCheckout>;
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

/** A commit a check-in made, as {@link LiveNotes.committed} hears it. */
export interface LiveCommit {
  repository: RepositoryId;
  /** The note's Git path. */
  path: string;
  /** The text committed, frontmatter included. */
  content: string;
  commit: string;
  /** The repository as the check-in opened it for this commit (`service.open`); it reads the commit from now on. */
  source: RemoteSource;
  /** Whom the commit is authored by, when an editor could be named; without one, the credential's account. */
  author?: CommitAuthor;
  /**
   * The person whose own credential made the commit (`service.open` with `{ person }`): an editor, or whoever asked for
   * the check-in. Left out when the deployment's credential made it.
   */
  person?: WorkspacePerson;
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
  /**
   * Hears of each commit a check-in makes, right after it landed, whoever started the check-in: a person, a sweep or a
   * schedule. The check-in does not wait for it, and what it throws or rejects is logged by the note's path and
   * changes nothing. `createApp` listens beside it ({@link withLiveCommits}) to publish the note.
   */
  committed?(commit: LiveCommit): void | Promise<void>;
  /** Required when `editors` declares a builtin editor: a ticket for the person to open the link's live document. */
  socketTicket?(context: LiveContext, repository: RepositoryId, id: string): Promise<LiveSocketTicket>;
}

/** Runs one listener of a check-in commit; whatever it throws or rejects is logged by the note's path, never by its text. */
function hearLiveCommit(listener: (commit: LiveCommit) => void | Promise<void>, commit: LiveCommit) {
  const failed = () => console.warn(`[live-notes] a listener of the check-in commit of ${commit.repository}/${commit.path} failed`);
  try {
    void Promise.resolve(listener(commit)).catch(failed);
  } catch {
    failed();
  }
}

/** Tells the adapter's `committed` of a commit a check-in just made; the check-in goes on whatever comes of it. */
export function announceLiveCommit(liveNotes: LiveNotes, commit: LiveCommit): void {
  if (typeof liveNotes.committed === 'function') hearLiveCommit(heard => liveNotes.committed!(heard), commit);
}

/**
 * The adapter as an app uses it once the app itself listens to check-in commits: `listener` hears each commit, and
 * then the adapter's own `committed` does. Every other member is read through from `liveNotes`, which is not changed,
 * so a member a later version adds is still there.
 */
export function withLiveCommits(liveNotes: LiveNotes, listener: (commit: LiveCommit) => void | Promise<void>): LiveNotes {
  const committed = (commit: LiveCommit) => {
    hearLiveCommit(listener, commit);
    announceLiveCommit(liveNotes, commit);
  };
  return Object.create(liveNotes, { committed: { value: committed, enumerable: true } }) as LiveNotes;
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

/** What makes a line content: a letter, a digit, or an image or embed. */
const DRAFT_CONTENT = /[\p{L}\p{N}]|!\[|<(img|iframe|video)\b/iu;

/** The frontmatter title a live text names, trimmed; undefined without one. */
function draftTitle(text: string): string | undefined {
  const { metadata } = parseNoteContent(normalizeLiveText(text));
  return typeof metadata.title === 'string' && metadata.title.trim() ? metadata.title.trim() : undefined;
}

/**
 * Whether a pending note is an empty draft (docs/specs/2026-11-15-builtin-live-editor §19.1): once the lines of its
 * initial body, or without `initialText` the web's default new-note lines ({@link LIVE_DEFAULT_DRAFT_LINES}), are taken
 * out of its body, one each, what is left holds no letter, digit, image or embed. Whitespace, punctuation, Markdown
 * markers and emoji alone are empty, and lines are compared whole, without the whitespace around them. The default lines
 * are never taken out on top of an initial text's, so a line typed a second time counts. Of the frontmatter only the
 * title counts: a note someone gave a title is not empty (設了標題就算有內容), which is a title other than the initial
 * text's, or without `initialText` one other than the web's default titles ({@link LIVE_DEFAULT_DRAFT_TITLES}).
 */
export function isEmptyLiveDraft(text: string, initialText?: string): boolean {
  const title = draftTitle(text);
  if (title !== undefined && (initialText === undefined ? !LIVE_DEFAULT_DRAFT_TITLES.includes(title) : title !== draftTitle(initialText))) return false;
  const lines = (value: string) => normalizeLiveText(value).replace(FRONTMATTER_REGEX, '').split('\n').map(line => line.trim());
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
/** A live document's name: `<link id>.<epoch>`. */
const LIVE_DOCUMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}\.[1-9][0-9]{0,15}$/;
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

/** Whether a value is a repository path of a note of `notebook` the live editor takes. */
const isNoteOf = (value: unknown, notebook: NotebookConfig): value is string => typeof value === 'string' && isRelativePath(value) && value.startsWith(`${notebook.root}/`) && isLiveNotePath(value.slice(notebook.root.length + 1), notebook);

/** Why a row is not a valid checkout; undefined when it is. */
function checkoutProblem(row: Record<string, unknown>, context: LiveRowContext): string | undefined {
  const { notebook: key, path, pathRule, since, editorUrl, embedUrl, contentHash, activeEditors, lastEditAt, syncedAt } = row;
  if (typeof key !== 'string') return 'no notebook';
  const notebook = context.notebook(key);
  if (!notebook) return 'an unknown notebook';
  if (path === null) {
    if (typeof pathRule !== 'string' || !isRelativePath(pathRule)) return 'a pending note without a valid path rule';
  } else if (!isNoteOf(path, notebook)) return 'a path that is not a note of its notebook';
  else if (row.target !== undefined && !isNoteOf(row.target, notebook)) return 'a target that is not a note of its notebook';
  else if (row.unmoved !== undefined && !isNoteOf(row.unmoved, notebook)) return 'an unmoved target that is not a note of its notebook';
  else if (row.unmovedReason !== undefined && (row.unmoved === undefined || !isLiveUnmovedReason(row.unmovedReason))) return 'an unknown reason a note did not move';
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

/** A row's `movedBy`, when it is a name with an optional email; anything else is left out. */
function movedByOf(value: unknown): LiveIdentity | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { name, email } = value as { name?: unknown; email?: unknown; };
  if (typeof name !== 'string' || !name || (email !== undefined && typeof email !== 'string')) return undefined;
  return { name, ...(email ? { email } : {}) };
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
  // Paths it was read at are a courtesy to tabs still there: one that is no note of its notebook, or its path or target now, is left out.
  const notebook = context.notebook(value.notebook as string)!;
  const former = !pending && Array.isArray(value.formerPaths) ? [...new Set(value.formerPaths.filter((entry): entry is string => isNoteOf(entry, notebook) && entry !== value.path && entry !== value.target))].slice(-LIVE_FORMER_PATHS) : [];
  return { id: value.id, notebook: value.notebook as string, path: value.path as string | null, ...(pending ? { pathRule: value.pathRule as string } : {}), ...(!pending && value.target !== undefined ? { target: value.target as string, ...(movedByOf(value.movedBy) ? { movedBy: movedByOf(value.movedBy)! } : {}) } : {}), ...(!pending && value.unmoved !== undefined ? { unmoved: value.unmoved as string, ...(value.unmovedReason !== undefined ? { unmovedReason: value.unmovedReason as LiveUnmovedReason } : {}) } : {}), ...(former.length ? { formerPaths: former } : {}), since: value.since as string, ...(isBuiltinEditor(context.editor) ? {} : { editorUrl: value.editorUrl as string, embedUrl: value.embedUrl as string }), contentHash: value.contentHash as string, activeEditors: value.activeEditors as number, lastEditAt: value.lastEditAt as string | null, syncedAt: value.syncedAt as string | null, base: baseOf(value.base)!, conflict: conflictOf(value.conflict)! };
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
