import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type CommitAuthor, isLiveId, LIVE_MAX_BYTES, type LiveBuiltinEditorInfo, type LiveCheckout, liveContentHash, type LiveContext, type LiveEditor, type LiveLease, LiveLeasedError, type LiveNotes, type LiveNotice, LiveNotLiveError, type LivePersonCalls, type LiveRelease, type LiveServiceCalls, type LiveSocketTicket, LiveStaleError, LiveTooLargeError, LiveUnavailableError, normalizeLiveText, rebaseLiveText, type RemoteSource, type RepositoryId, SourceError } from '@mygitnotes/core';
import { liveDocumentName, type LiveDocuments, liveDocuments, type LiveSnapshot, seedLiveState } from './documents.js';
import { liveSocket, type LiveSocketLimits } from './socket.js';
import { type EditorRef, LIVE_TICKET_MS, type LiveStore, type StoredLink } from './store.js';

/*
 * The built-in live editor as a `LiveNotes` (docs/specs/2026-11-15-builtin-live-editor §2, §5): the seam's calls over
 * the live store and the documents of this process. A revision is `t:<sha256 of the text>`, so it survives reloads and
 * needs no session; a write names one as its base and is rebased by character over the typing since. People type
 * through the socket of `socket.ts`, which the adapter hands on as `upgrade`.
 */

/** The limits of the built-in editor (§4.6): the adapter's own, and the socket's. */
export interface BuiltinLiveLimits extends LiveSocketLimits {
  /** The largest live text, in UTF-8 bytes. */
  maxBytes: number;
  /** How long after their last activity a connected person still counts as editing. */
  idleMs: number;
  /** How long a check-in's lease holds. */
  leaseMs: number;
  /** The texts handed out that a document keeps as bases for writes: at most this many. */
  ringTexts: number;
  /** And at most this many UTF-8 bytes of them; the newest is always kept. */
  ringBytes: number;
}

export interface BuiltinLiveNotesOptions {
  /** Whether the built-in editor covers a repository. */
  covers(repository: RepositoryId): boolean;
  /**
   * `service.open`: the repository with the deployment's own write credential, its commits authored by `author`
   * (none: the credential's account). The check-in engine is its only caller.
   */
  open(repository: RepositoryId, author?: CommitAuthor): Promise<RemoteSource>;
  /** `redisLiveStore({ url })`, or `memoryLiveStore()` for a deployment that accepts losing live text on restart. */
  store: LiveStore;
  notify?(notice: LiveNotice): Promise<void>;
  /** The app's origin, the only one a socket may come from; left out, `APP_URL`. */
  appUrl?: string;
  /** Tests only: the clock of every time the adapter records, in milliseconds. */
  clock?: () => number;
  limits?: Partial<BuiltinLiveLimits>;
}

/** The built-in live editor as `AppServices.liveNotes` takes it. */
export interface BuiltinLiveNotes extends LiveNotes {
  service: Required<LiveServiceCalls>;
  socketTicket(context: LiveContext, repository: RepositoryId, id: string): Promise<LiveSocketTicket>;
  /**
   * Resolves once the store passed its start-up check, and rejects with the store's refusal (an eviction policy that
   * could drop typing). A composition may await it before it listens; one that does not is stopped by the unhandled
   * rejection. Until it resolves every call waits, and after a refusal every call fails.
   */
  readonly started: Promise<void>;
  /**
   * For `server.on('upgrade')`: takes the request when its path is `/live/socket` and returns true; false otherwise, and
   * the caller handles it. A socket opens only from the app's origin, and a document on it only for a socket ticket.
   */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /**
   * Stops new sockets, compacts every document this process holds into the store, and closes the sockets with 1012, so
   * their tabs connect again to whichever process serves then. Resolves within 15 s.
   */
  shutdown(): Promise<void>;
}

/** The adapter with what drives it from inside: its documents, store and clock. */
export interface BuiltinLiveParts {
  liveNotes: BuiltinLiveNotes;
  documents: LiveDocuments;
  store: LiveStore;
  clock: () => number;
  /** This process's name among those that share the store. */
  process: string;
}

const BUILTIN: LiveBuiltinEditorInfo = { kind: 'builtin' };
const DEFAULT_LIMITS: BuiltinLiveLimits = { maxBytes: LIVE_MAX_BYTES, idleMs: 10 * 60_000, leaseMs: 5 * 60_000, ringTexts: 64, ringBytes: 16 * 1024 * 1024, maxPayload: 8 * 1024 * 1024, maxDocuments: 200, maxConnections: 50, maxAwarenessBytes: 4096, pollMs: 5000, beatMs: 15_000, shutdownMs: 15_000 };
const REVISION = /^t:([0-9a-f]{64})$/;
const iso = (time: number) => new Date(time).toISOString();

/**
 * Who an edit is recorded for: a person or an agent, by their verified email in lower case, else by their sign-in. The
 * email is the identity's (`LiveContext.author`), never a client's word, and no email is made up where there is none.
 */
export function liveEditorRef({ person, author }: LiveContext, agent: boolean): EditorRef {
  const signIn = `${person.realm}:${person.userId}`;
  return { key: `${agent ? 'agent' : 'person'}:${author?.email ? author.email.toLowerCase() : signIn}`, name: author?.name || signIn, ...(author?.email ? { email: author.email } : {}), agent };
}

/** The built-in adapter with its parts; `builtinLiveNotes` hands out the adapter alone. */
export function createBuiltinLiveNotes(options: BuiltinLiveNotesOptions): BuiltinLiveParts {
  const { covers, store } = options;
  const clock = options.clock ?? Date.now;
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const documents = liveDocuments({ store, clock, maxBytes: limits.maxBytes, ringTexts: limits.ringTexts, ringBytes: limits.ringBytes });
  const processName = randomBytes(8).toString('hex');

  // The store refuses a configuration that would lose live text (§3.4). `started` is left without a handler, so a
  // refusal nobody awaits stops the process; the calls wait on a handled copy of it.
  const checked = store.check();
  const started = checked.then(() => undefined);
  const passed = checked.then(() => true, () => false);
  const ready = async () => {
    if (!(await passed)) throw new LiveUnavailableError();
  };
  /** Each call of `calls`, held until the store passed its start-up check. */
  const afterCheck = <T extends object>(calls: T): T =>
    Object.fromEntries(
      Object.entries(calls).map(([name, call]) => [name, async (...given: unknown[]) => {
        await ready();
        return (call as (...args: unknown[]) => unknown)(...given);
      }]),
    ) as T;

  const fits = (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > limits.maxBytes) throw new LiveTooLargeError();
    return text;
  };
  const covered = (repository: RepositoryId) => {
    if (!covers(repository)) throw new LiveUnavailableError();
  };
  /** The live link of an id in a covered repository. Lease-bound store calls answer 'leased' for a link that is gone, so this is read first. */
  const live = async (repository: RepositoryId, id: string): Promise<StoredLink> => {
    covered(repository);
    const link = isLiveId(id) ? await store.link(id) : null;
    if (!link?.live || link.repository !== repository) throw new LiveNotLiveError();
    return link;
  };
  const socket = liveSocket({ documents, store, clock, process: processName, ready, covers, ...(options.appUrl !== undefined ? { appUrl: options.appUrl } : {}), limits });
  const tokenOf = (lease: LiveLease) => typeof lease?.token === 'string' ? lease.token : '';
  /** The live link, when `lease` holds it now. */
  const leased = async (repository: RepositoryId, id: string, lease: LiveLease): Promise<StoredLink> => {
    const link = await live(repository, id);
    if (!(await store.leaseHeld(link.id, tokenOf(lease), clock()))) throw new LiveLeasedError();
    return link;
  };
  /** The distinct people of every process whose last activity is within the idle window; what this process's sockets just did counts. */
  const active = async (link: StoredLink) => {
    await socket.settle(link);
    return store.activePeople(link.id, clock() - limits.idleMs, clock());
  };
  /** A row carries no URL: the note is edited on its own page in the app. */
  const rowOf = (link: StoredLink, contentHash: string, activeEditors: number): LiveCheckout => ({ id: link.id, notebook: link.notebook, path: link.path, ...(link.path === null && link.pathRule !== undefined ? { pathRule: link.pathRule } : {}), since: iso(link.since), contentHash, activeEditors, lastEditAt: link.lastEditAt === null ? null : iso(link.lastEditAt), syncedAt: link.syncedAt === null ? null : iso(link.syncedAt), base: link.base, conflict: link.conflict });
  const row = async (link: StoredLink) => rowOf(link, await documents.contentHash(link), await active(link));
  const rows = async (repository: RepositoryId) => {
    covered(repository);
    const links = await store.links(repository);
    documents.forget(repository, links);
    return Promise.all(links.map(row));
  };
  const textOf = ({ text, hash }: Pick<LiveSnapshot, 'text' | 'hash'>) => ({ content: text, liveRevision: `t:${hash}`, contentHash: hash });

  /**
   * Writes `content`, made on the text `baseRevision` names, over the typing since (§5.3). The base is the current text
   * when the revision is its hash, else a text this process handed out for the epoch and still keeps; any other base is
   * stale, as is a write that changed the same characters as the typing.
   */
  const rewrite = async (link: StoredLink, editor: EditorRef | null, content: string, baseRevision: string) => {
    const mine = fits(normalizeLiveText(content));
    const base = typeof baseRevision === 'string' ? REVISION.exec(baseRevision)?.[1] : undefined;
    if (!base) throw new LiveStaleError();
    const written = await documents.edit(link, editor, (current, hash) => {
      const from = hash === base ? current : documents.recall(link, base);
      const next = from === undefined ? null : rebaseLiveText(from, current, mine);
      if (next === null) throw new LiveStaleError();
      return fits(next);
    });
    documents.remember(link, written);
    return written;
  };

  const person = (context: LiveContext): LivePersonCalls =>
    afterCheck<LivePersonCalls>({
      checkouts: rows,
      async read(repository, id) {
        const link = await live(repository, id);
        const shot = await documents.snapshot(link);
        documents.remember(link, shot);
        return textOf(shot);
      },
      async write(repository, id, change) {
        const written = await rewrite(await live(repository, id), liveEditorRef(context, change.agent === true), change.content, change.baseRevision);
        return { liveRevision: `t:${written.hash}`, changed: written.changed };
      },
      async append(repository, id, change) {
        const link = await live(repository, id);
        const added = normalizeLiveText(change.text);
        const written = await documents.edit(link, liveEditorRef(context, change.agent === true), current => fits(current + added));
        documents.remember(link, written);
        return { liveRevision: `t:${written.hash}` };
      },
      async checkout(repository, { notebook, path, base }) {
        covered(repository);
        const text = fits(normalizeLiveText(base.content));
        const contentHash = liveContentHash(text);
        // The epoch is seeded in the one store call that opens it: a join leaves the live text alone.
        const { link, outcome } = await store.checkout(repository, { notebook, path, base: { commit: base.commit, blob: base.blob, contentHash }, contentHash }, seedLiveState(text), clock());
        if (outcome !== 'joined') documents.remember(link, { text, hash: contentHash });
        return { checkout: await row(link), outcome };
      },
      async createPending(repository, { notebook, pathRule, content }) {
        covered(repository);
        const text = fits(normalizeLiveText(content));
        const contentHash = liveContentHash(text);
        const link = await store.createPending(repository, { notebook, base: null, contentHash, pathRule, initialText: text }, seedLiveState(text), clock());
        documents.remember(link, { text, hash: contentHash });
        return row(link);
      },
      async filed(repository, id) {
        covered(repository);
        const link = isLiveId(id) ? await store.link(id) : null;
        return link && !link.live && link.repository === repository ? link.path : null;
      },
    });

  const service = afterCheck<Required<LiveServiceCalls>>({
    async repositories() {
      return (await store.repositories()).filter(covers);
    },
    checkouts: rows,
    async open(repository, author) {
      covered(repository);
      return options.open(repository, author);
    },
    async lease(repository, id) {
      const link = await live(repository, id);
      const token = randomBytes(16).toString('hex'), until = clock() + limits.leaseMs;
      const answer = await store.lease(link.id, token, until, clock());
      if (answer === 'not-live') throw new LiveNotLiveError();
      if (answer === 'held') throw new LiveLeasedError();
      return { token, until: iso(until) };
    },
    async detail(repository, id, lease) {
      const link = await leased(repository, id, lease);
      // The text and the sequence it is at come from one read of the store, so the receipt of a commit made from it clears exactly who is in it.
      const shot = await documents.snapshot(link);
      if (!(await store.leaseRead(link.id, tokenOf(lease), shot.seq, shot.hash, clock()))) throw new LiveLeasedError();
      documents.remember(link, shot);
      const [editors, initial, activeEditors] = await Promise.all([store.editors(link.id), link.path === null ? store.initialText(link.id) : null, active(link)]);
      return { ...textOf(shot), checkout: rowOf(link, shot.hash, activeEditors), editors: editors.map((editor): LiveEditor => ({ name: editor.name, ...(editor.email !== undefined ? { email: editor.email } : {}), agent: editor.agent, firstAt: iso(editor.firstAt), lastAt: iso(editor.lastAt) })), ...(initial !== null ? { initialText: initial } : {}) };
    },
    async mergeIn(repository, id, lease, change) {
      // A merge is nobody's edit: it names no editor and leaves lastEditAt.
      const written = await rewrite(await leased(repository, id, lease), null, change.content, change.baseRevision);
      return { liveRevision: `t:${written.hash}` };
    },
    async synced(repository, id, lease, receipt) {
      const link = await live(repository, id);
      const answer = await store.synced(link.id, tokenOf(lease), { commit: receipt.commit, blob: receipt.blob, contentHash: receipt.contentHash, path: receipt.path, conflict: receipt.conflict }, clock());
      if (answer === 'leased') throw new LiveLeasedError();
      if (answer === 'path-fixed') throw new SourceError('A live note keeps the path it was filed at.', 409);
    },
    async release(repository, id, lease, check): Promise<LiveRelease> {
      const link = await leased(repository, id, lease);
      if (link.syncedAt === null || link.syncedHash !== check.contentHash) return { released: false, reason: 'not-synced' };
      const shot = await documents.snapshot(link);
      if (shot.hash !== check.contentHash) return { released: false, reason: 'changed' };
      const activeEditors = await active(link);
      if (activeEditors > 0) return { released: false, reason: 'active', activeEditors };
      // The store releases only while the sequence is the one just read: an update that lands meanwhile keeps the note open.
      const answer = await store.release(link.id, tokenOf(lease), { seq: shot.seq, contentHash: check.contentHash }, clock());
      if (answer === 'leased') throw new LiveLeasedError();
      if (answer !== 'released') return { released: false, reason: answer };
      await documents.drop(link);
      return { released: true };
    },
    async discard(repository, id, lease, check): Promise<LiveRelease> {
      const link = await leased(repository, id, lease);
      if (link.path !== null) throw new SourceError('Only a pending note can be discarded.', 409);
      const shot = await documents.snapshot(link);
      if (shot.hash !== check.contentHash) return { released: false, reason: 'changed' };
      const activeEditors = await active(link);
      if (activeEditors > 0) return { released: false, reason: 'active', activeEditors };
      // The link goes with its document, editors, tickets and initial text: `filed` knows nothing of it afterwards.
      const answer = await store.discard(link.id, tokenOf(lease), { seq: shot.seq }, clock());
      if (answer === 'leased') throw new LiveLeasedError();
      if (answer === 'not-pending') throw new SourceError('Only a pending note can be discarded.', 409);
      if (answer === 'changed') return { released: false, reason: 'changed' };
      await documents.drop(link);
      return { released: true };
    },
    async retarget(repository, id, lease, request) {
      const link = await live(repository, id);
      // The store ends the lease with the call, retargeted or refused for a note with a path. The text is not read: open editors do not hold it.
      const answer = await store.retarget(link.id, tokenOf(lease), request.pathRule, clock());
      if (answer === 'leased') throw new LiveLeasedError();
      if (answer === 'not-pending') throw new LiveNotLiveError('Only a pending note can be moved or renamed.');
      return row({ ...link, pathRule: request.pathRule });
    },
  });

  const liveNotes: BuiltinLiveNotes = {
    editors: [BUILTIN],
    editor: repository => covers(repository) ? BUILTIN : null,
    person,
    service,
    ...(options.notify ? { notify: notice => options.notify!(notice) } : {}),
    async socketTicket(context, repository, id) {
      await ready();
      const link = await live(repository, id);
      // 32 random bytes; the store keeps only its hash, with who it is for and the one epoch it opens.
      const ticket = randomBytes(32).toString('base64url');
      const editor = liveEditorRef(context, false);
      const document = liveDocumentName(link);
      await store.putTicket(createHash('sha256').update(ticket, 'utf8').digest('hex'), { repository, id: link.id, epoch: link.epoch, document, editor, display: editor.name }, clock() + LIVE_TICKET_MS);
      return { ticket, document };
    },
    started,
    upgrade: (request, upgraded, head) => socket.upgrade(request, upgraded, head),
    shutdown: () => socket.shutdown(),
  };
  return { liveNotes, documents, store, clock, process: processName };
}
