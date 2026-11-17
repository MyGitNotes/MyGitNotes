import { SourceError } from './github-api.js';
import { checkInLink, discardLink, type LiveCheckInOptions, type LiveCheckInResult, type LiveDiscardResult, type LiveRetarget, retargetLink, retargetLivePathRule } from './live-checkin.js';
import { CheckedOutError, isBuiltinEditor, isEmptyLiveDraft, isLiveContentHash, isLiveId, isLiveMergeId, isLiveRevision, isLiveTypedIn, liveAdapterError, type LiveCheckout, liveCheckoutOf, type LiveContext, type LiveEditorInfo, liveEditorOf, liveIdentityOf, liveInitialTextOf, type LiveMergeAnswer, liveMergeAnswerOf, type LiveMergeRequest, type LiveNotes, LiveNotLiveError, livePendingPath, type LivePersonCalls, type LiveSocketTicket, liveSocketTicketOf, type LiveText, liveTextOf, LiveUnavailableError, normalizeLiveText } from './live-notes.js';
import { localIdIn, type NotebookKey } from './notebook-key.js';
import type { RepositoryId } from './repository.js';
import type { LiveNoteState, NotebookConfig } from './types.js';
import { noteWebPath } from './workspace-links.js';

/*
 * One request's view of a repository's live editor (docs/specs/2026-11-15-live-notes/spec.md §2): the person-side
 * calls of the adapter for that repository, every answer checked, and the request's list of live links read once.
 */

/** A live note as a request last read or wrote it: what a hosted revision token carries for it. */
export interface LiveRecord {
  id: string;
  liveRevision: string;
  contentHash: string;
}

/**
 * A live link with the notebook it belongs to and the path reads know it by: its Git path, the target a filed note
 * moves to at its next check-in (§20.4 of the built-in editor spec), or a pending note's virtual path.
 */
export interface LiveLink {
  checkout: LiveCheckout;
  notebook: NotebookConfig;
  path: string;
}

export interface LiveRepository {
  readonly repository: RepositoryId;
  readonly editor: LiveEditorInfo;
  /** Whether the adapter can discard a pending note (§19): its `service.discard`. */
  readonly discards: boolean;
  /** Whether the adapter can move and rename a pending note (§20.2): its `service.retarget`. */
  readonly retargets: boolean;
  /** Whether the adapter can merge a text written off the live note into it: its person calls' `merge`. Asking makes no adapter call. */
  readonly merges: boolean;
  /** The repository's live links, checked; read from the adapter once per request. */
  checkouts(): Promise<LiveCheckout[]>;
  /** Those links with their notebooks and paths. */
  links(): Promise<LiveLink[]>;
  /** The live text of a link, fresh from the adapter and checked. */
  read(id: string): Promise<LiveText>;
  /**
   * How many people other than the one asking have the link open now, idle or not; null where the adapter cannot tell
   * (no `othersEditing`) or answers no count.
   */
  othersEditing(id: string): Promise<number | null>;
  /** Writes a whole text on `baseRevision`, which the editor rebases over typing since; the text is sent in normal form. */
  write(id: string, content: string, baseRevision: string, agent: boolean): Promise<{ liveRevision: string; changed: boolean; }>;
  append(id: string, text: string, agent: boolean): Promise<{ liveRevision: string; }>;
  /** Checks a note out to the editor on its Git text (sent in normal form), or joins the live note it already has. */
  checkout(notebook: NotebookKey, path: string, base: { commit: string; blob: string; content: string; }): Promise<{ checkout: LiveCheckout; outcome: 'created' | 'joined' | 'reopened'; }>;
  /** Creates a pending note, filed at the first check-in by `pathRule` (relative to the notebook root). */
  createPending(notebook: NotebookKey, pathRule: string, content: string): Promise<LiveCheckout>;
  /** Where a link that is no longer live was filed: its repository path, or null when unknown. */
  filed(id: string): Promise<string | null>;
  /**
   * 「立即簽回」: checks the live note at `path` (a Git path, a moving note's target or Git path, or a pending note's
   * virtual path) in now (spec §5.3), as a manual check-in unless `mode` says otherwise.
   */
  checkIn(path: string, mode?: 'manual' | 'scheduled'): Promise<LiveCheckInResult>;
  /**
   * 「捨棄草稿」: drops the pending note at its virtual `path` without a commit. A draft someone typed content in is kept
   * (`has-edits`) unless `confirm`. Throws {@link LiveNotLiveError} where the adapter cannot discard or `path` is no
   * pending note that is live.
   */
  discard(path: string, confirm: boolean): Promise<LiveDiscardResult>;
  /**
   * Moves or renames the pending note at its virtual `path`: sets the rule its check-in files it by, built from the old
   * one ({@link retargetLivePathRule}), and answers its row. Nothing is committed. Throws a 400 for a folder or name
   * that is refused, {@link LiveNotLiveError} where the adapter cannot retarget or `path` is no pending note that is
   * live, and {@link LiveLeasedError} while a check-in keeps the lease.
   */
  retarget(path: string, change: LiveRetarget): Promise<LiveCheckout>;
  /**
   * Sets where the filed live note at `path` (as reads know it, or its Git path while it moves) moves at its next
   * check-in (§20.4): `target`, a repository path the caller checked, or null to keep it where it lies. Nothing is
   * committed, and open editors keep working. Throws {@link LiveNotLiveError} where the adapter cannot retarget or `path`
   * is no filed live note, and {@link LiveLeasedError} while a check-in keeps the lease.
   */
  move(path: string, target: string | null): Promise<LiveCheckout>;
  /** A ticket for the person to open a link's live document over the built-in editor's socket. */
  socketTicket(id: string): Promise<LiveSocketTicket>;
  /**
   * Merges a text written on `base` into a live link (texts sent in normal form), and answers whether it landed. Throws
   * {@link LiveNotLiveError} where the adapter cannot merge, and a 400 for a `mergeId` that is none.
   */
  merge(id: string, request: LiveMergeRequest): Promise<LiveMergeAnswer>;
}

export interface LiveRepositoryOptions {
  liveNotes: LiveNotes;
  /** Who the calls act for: a signed-in person, or a write grant's person. Signed out, no view is made. */
  context: LiveContext;
  repository: RepositoryId;
  /** The repository's alias in the workspace: links name notebooks by key (`<alias>~<id>`). */
  alias: string;
  /** The notebooks the repository serves, with their local ids. */
  notebooks(): Promise<NotebookConfig[]>;
  /** How a manual check-in runs: its clock, its time zone for a pending note's date, and its wait between release retries. */
  checkIn?: Omit<LiveCheckInOptions, 'mode'>;
  /** The app's origin (`APP_URL`): a built-in editor's notes are edited on their own page there. Required for one. */
  appUrl?: string;
}

/** The page of a note in the app, where the built-in editor edits it: the `APP_URL` origin and the note's web path. */
export function liveNotePageUrl(appUrl: string, key: NotebookKey, relative: string): string {
  return new URL(appUrl).origin + noteWebPath(key, relative);
}

const call = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw liveAdapterError(error);
  }
};

const revisionOf = (value: unknown): string => {
  const liveRevision = (value as { liveRevision?: unknown; } | null)?.liveRevision;
  if (!isLiveRevision(liveRevision)) throw new LiveUnavailableError();
  return liveRevision;
};

/**
 * The view of a repository's live editor for one request; null where the adapter covers no editor for it. The
 * adapter's person calls are asked for only on first use, so a request that reads nothing live makes no adapter call.
 */
export function liveRepository({ liveNotes, context, repository, alias, notebooks, checkIn, appUrl }: LiveRepositoryOptions): LiveRepository | null {
  const editor = liveEditorOf(liveNotes, repository);
  if (!editor) return null;
  const builtin = isBuiltinEditor(editor);
  if (builtin && !appUrl) throw new Error('The built-in live editor needs APP_URL.');
  /** A checked row as the community hands it on: a built-in editor's link gets its note page in the app as `editorUrl`. */
  const withPage = (checkout: LiveCheckout, notebook: NotebookConfig): LiveCheckout => {
    if (!builtin) return checkout;
    const relative = (checkout.target ?? checkout.path ?? livePendingPath(notebook.root, checkout.id)).slice(notebook.root.length + 1);
    return { ...checkout, editorUrl: liveNotePageUrl(appUrl!, checkout.notebook, relative) };
  };
  let person: LivePersonCalls | undefined;
  const calls = () => person ??= liveNotes.person(context);
  /** The notebook a link's key names among those the repository serves. */
  const notebookOf = async () => {
    const served = await notebooks();
    return (key: string) => {
      const local = localIdIn(alias, key);
      return local === null ? undefined : served.find(entry => entry.id === local);
    };
  };
  /** A row the adapter answered for a call, checked; a bad one is a 502. */
  const checkedRow = async (row: unknown) => {
    const notebook = await notebookOf();
    const checkout = liveCheckoutOf(row, { editor, notebook });
    if (!checkout) throw new LiveUnavailableError();
    return withPage(checkout, notebook(checkout.notebook)!);
  };
  let listed: Promise<LiveLink[]> | undefined;
  const links = () => {
    listed ??= (async () => {
      const [rows, notebook] = await Promise.all([call(() => calls().checkouts(repository)), notebookOf()]);
      if (!Array.isArray(rows)) throw new LiveUnavailableError();
      const checked: LiveLink[] = [];
      // One link per path and per id: a second row for either (an adapter fault) is dropped.
      const seen = new Set<string>();
      for (const row of rows) {
        const valid = liveCheckoutOf(row, { editor, notebook });
        if (!valid) continue;
        const owner = notebook(valid.notebook)!;
        const checkout = withPage(valid, owner);
        const path = checkout.target ?? checkout.path ?? livePendingPath(owner.root, checkout.id);
        if (seen.has(path) || seen.has(`id:${checkout.id}`)) {
          console.warn(`[live-notes] dropped live link ${checkout.id}: a second link for its path or id`);
          continue;
        }
        seen.add(path).add(`id:${checkout.id}`);
        checked.push({ checkout, notebook: owner, path });
      }
      return checked;
    })();
    // A failed list is asked again by the next read rather than remembered.
    listed.catch(() => (listed = undefined));
    return listed;
  };
  /** The link at `path`: the path reads know it by, or the Git path of a note moving elsewhere. */
  const linkAt = async (path: string) => {
    const all = await links();
    return all.find(entry => entry.path === path) ?? all.find(entry => entry.checkout.target !== undefined && entry.checkout.path === path);
  };
  return {
    repository,
    editor,
    discards: typeof liveNotes.service.discard === 'function',
    retargets: typeof liveNotes.service.retarget === 'function',
    get merges() {
      return typeof calls().merge === 'function';
    },
    links,
    checkouts: async () => (await links()).map(link => link.checkout),
    async read(id) {
      if (!isLiveId(id)) throw new LiveUnavailableError();
      return liveTextOf(await call(() => calls().read(repository, id)));
    },
    async othersEditing(id) {
      const ask = calls().othersEditing?.bind(calls());
      if (!ask || !isLiveId(id)) return null;
      const answer = await call(() => ask(repository, id));
      return typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer <= 10_000 ? answer : null;
    },
    async write(id, content, baseRevision, agent) {
      const answer = await call(() => calls().write(repository, id, { content: normalizeLiveText(content), baseRevision, agent }));
      return { liveRevision: revisionOf(answer), changed: (answer as { changed?: unknown; }).changed !== false };
    },
    async append(id, text, agent) {
      return { liveRevision: revisionOf(await call(() => calls().append(repository, id, { text: normalizeLiveText(text), agent }))) };
    },
    async checkout(notebook, path, base) {
      const answer = await call(() => calls().checkout(repository, { notebook, path, base: { ...base, content: normalizeLiveText(base.content) } }));
      const { checkout: row, outcome } = (answer ?? {}) as { checkout?: unknown; outcome?: unknown; };
      if (outcome !== 'created' && outcome !== 'joined' && outcome !== 'reopened') throw new LiveUnavailableError();
      const checkout = await checkedRow(row);
      if (checkout.path !== path) throw new LiveUnavailableError();
      listed = undefined;
      return { checkout, outcome };
    },
    async createPending(notebook, pathRule, content) {
      const checkout = await checkedRow(await call(() => calls().createPending(repository, { notebook, pathRule, content: normalizeLiveText(content) })));
      if (checkout.path !== null) throw new LiveUnavailableError();
      listed = undefined;
      return checkout;
    },
    async filed(id) {
      if (!isLiveId(id)) return null;
      const answer = await call(() => calls().filed(repository, id));
      return typeof answer === 'string' && answer.length <= 1024 && !answer.startsWith('/') && !/[\\\p{Cc}]/u.test(answer) && answer.split('/').every(part => part && part !== '.' && part !== '..') ? answer : null;
    },
    async checkIn(path, mode = 'manual') {
      const link = await linkAt(path);
      if (!link) throw new LiveNotLiveError();
      try {
        // Whoever asks is the last credential tried, so a writer can check in a note whose editors no longer may.
        const shown = liveIdentityOf(context);
        return await checkInLink(liveNotes, repository, link.checkout.id, { ...checkIn, mode, requester: { person: context.person, ...(shown ? { author: shown } : {}) } });
      } finally {
        // The link may be closed or filed now; the next read in this request asks again.
        listed = undefined;
      }
    },
    async discard(path, confirm) {
      const link = (await links()).find(entry => entry.path === path);
      if (!link || link.checkout.path !== null || typeof liveNotes.service.discard !== 'function') throw new LiveNotLiveError();
      // Asked without the lease first: a lease taken only to refuse would hold the confirmed request off for minutes.
      // The service's editors and initial text decide again under the lease.
      if (!confirm && link.checkout.lastEditAt !== null) {
        const read = await call(() => calls().read(repository, link.checkout.id));
        if (!isEmptyLiveDraft(liveTextOf(read).content, liveInitialTextOf(read))) return { id: link.checkout.id, discarded: false, reason: 'has-edits' };
      }
      try {
        return await discardLink(liveNotes, repository, link.checkout.id, { confirm, ...(checkIn?.sleep ? { sleep: checkIn.sleep } : {}) });
      } finally {
        listed = undefined;
      }
    },
    async retarget(path, change) {
      const link = (await links()).find(entry => entry.path === path);
      if (!link || link.checkout.path !== null || typeof liveNotes.service.retarget !== 'function') throw new LiveNotLiveError();
      const rule = retargetLivePathRule(link.checkout.pathRule!, change, link.notebook);
      if ('invalid' in rule) throw new SourceError(rule.invalid, 400);
      try {
        const checkout = await checkedRow(await retargetLink(liveNotes, repository, link.checkout.id, { pathRule: rule.pathRule, ...(checkIn?.sleep ? { sleep: checkIn.sleep } : {}) }));
        if (checkout.id !== link.checkout.id || checkout.path !== null || checkout.pathRule !== rule.pathRule) throw new LiveUnavailableError();
        return checkout;
      } finally {
        listed = undefined;
      }
    },
    async move(path, target) {
      const link = await linkAt(path);
      if (!link || link.checkout.path === null || typeof liveNotes.service.retarget !== 'function') throw new LiveNotLiveError();
      try {
        const checkout = await checkedRow(await retargetLink(liveNotes, repository, link.checkout.id, { target, ...(checkIn?.sleep ? { sleep: checkIn.sleep } : {}) }));
        if (checkout.id !== link.checkout.id || checkout.path !== link.checkout.path || (checkout.target ?? null) !== target) throw new LiveUnavailableError();
        return checkout;
      } finally {
        listed = undefined;
      }
    },
    async merge(id, request) {
      const merge = calls().merge?.bind(calls());
      if (!merge || !isLiveId(id)) throw new LiveNotLiveError();
      if (typeof request.base !== 'string' || typeof request.text !== 'string') throw new SourceError('base and text must be text.', 400);
      if (!isLiveMergeId(request.mergeId)) throw new SourceError('mergeId must be 8 to 128 letters, digits, _ or -.', 400);
      if (request.typedIn !== undefined && !isLiveTypedIn(request.typedIn)) throw new SourceError('typedIn must name a live document and hold a Yjs update.', 400);
      const answer = liveMergeAnswerOf(await call(() => merge(repository, id, { base: normalizeLiveText(request.base), text: normalizeLiveText(request.text), mergeId: request.mergeId, ...(request.typedIn ? { typedIn: { document: request.typedIn.document, update: request.typedIn.update } } : {}) })));
      // The link's text moved: the next read in this request asks again.
      if ('applied' in answer) listed = undefined;
      return answer;
    },
    async socketTicket(id) {
      if (!builtin || typeof liveNotes.socketTicket !== 'function' || !isLiveId(id)) throw new LiveUnavailableError();
      const ticket = liveSocketTicketOf(await call(() => liveNotes.socketTicket!(context, repository, id)));
      if (!ticket) throw new LiveUnavailableError();
      return ticket;
    },
  };
}

/** The refusal of a Git write of one note's text while it is checked out: the writer read it before, or from Git. */
export function editedLiveError(file: string): CheckedOutError {
  return new CheckedOutError([file], `${file} is being edited live (編輯中); read it again and write with the revision that read returns, or check it in with check_in_note first.`);
}

/**
 * What reads say of a live link; its `editorUrl` is the framed editor's page, or the built-in editor's note page in the
 * app, and `changed` says its text is not the Git text it was last synced with (a note only viewed is not). A pending note names where its check-in files it (`pathRule`) only where the adapter can move it (`retargets`),
 * so an adapter without retarget answers as 0.19 did. A filed note moving at its next check-in names its Git path
 * (`movingFrom`), and one its last check-in did not move names that target (`unmoved`): one Git held, or one
 * `unmovedReason` explains.
 */
export function liveNoteState(row: LiveCheckout, retargets = false): LiveNoteState {
  return { since: row.since, activeEditors: row.activeEditors, ...(row.base && row.contentHash !== row.base.contentHash ? { changed: true as const } : {}), ...(row.path === null ? { pending: true as const } : {}), ...(row.conflict ? { conflict: row.conflict } : {}), editorUrl: row.editorUrl!, ...(retargets && row.path === null && row.pathRule !== undefined ? { pathRule: row.pathRule } : {}), ...(row.path !== null && row.target !== undefined ? { movingFrom: row.path } : {}), ...(row.path !== null && row.unmoved !== undefined ? { unmoved: row.unmoved, ...(row.unmovedReason ? { unmovedReason: row.unmovedReason } : {}) } : {}) };
}

/*
 * The internal revision a write on a live note names: `live:<id>:<contentHash>:<liveRevision>`. It is never shown to a
 * caller: the hosted token carries its parts, and the hosted router hands it on only for a note checked out under that id.
 */
const LIVE_BASE = /^live:([A-Za-z0-9_-]{1,64}):([0-9a-f]{64}):([\x20-\x7e]{1,256})$/;

export function liveBase(record: LiveRecord): string {
  return `live:${record.id}:${record.contentHash}:${record.liveRevision}`;
}

/** The parts of an internal live revision; null for any other value, such as a commit id. */
export function parseLiveBase(value: unknown): LiveRecord | null {
  if (typeof value !== 'string') return null;
  const match = LIVE_BASE.exec(value);
  if (!match || !isLiveContentHash(match[2])) return null;
  return { id: match[1], contentHash: match[2], liveRevision: match[3] };
}
