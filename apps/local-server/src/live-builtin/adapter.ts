import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type CommitAuthor, isLiveId, LIVE_MAX_BYTES, type LiveBuiltinEditorInfo, type LiveCheckout, liveContentHash, type LiveContext, type LiveEditor, liveIdentityOf, type LiveLease, LiveLeasedError, type LiveMergeAnswer, liveMergeAnswerOf, type LiveNotes, type LiveNotice, LiveNotLiveError, type LiveOpenAs, type LivePersonCalls, type LiveRelease, type LiveServiceCalls, type LiveSocketTicket, LiveStaleError, LiveTooLargeError, LiveUnavailableError, type LiveTypedIn, normalizeLiveText, rebaseLiveText, type RemoteSource, type RepositoryId, SourceError } from '@mygitnotes/core';
import { liveDocumentName, type LiveDocuments, liveDocuments, type LiveSnapshot, seedLiveState, typedInTexts } from './documents.js';
import { liveSocket, type LiveSocketLimits } from './socket.js';
import { type EditorRef, LIVE_MERGE_MS, LIVE_TICKET_MS, type LiveStore, type StoredLink } from './store.js';

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
   * `service.open`: the repository a check-in commits through, its commits authored by `author` (none: the credential's
   * account). `as.person` is the editor the engine commits as: an edition that commits with the editors' own
   * credentials opens the repository with that person's and throws `LiveCredentialError` when they cannot commit there,
   * so the engine asks as the next editor; one that commits with a credential of its own may ignore it. Without `as`
   * (a note whose editors were recorded without a person) there is nobody to commit as. The check-in engine is its only
   * caller.
   */
  open(repository: RepositoryId, author?: CommitAuthor, as?: LiveOpenAs): Promise<RemoteSource>;
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
const DEFAULT_LIMITS: BuiltinLiveLimits = { maxBytes: LIVE_MAX_BYTES, idleMs: 10 * 60_000, leaseMs: 5 * 60_000, ringTexts: 64, ringBytes: 16 * 1024 * 1024, maxPayload: 8 * 1024 * 1024, maxDocuments: 200, maxConnections: 50, maxUnseated: 100, maxUnseatedPerAddress: 10, maxAwarenessBytes: 4096, pollMs: 5000, beatMs: 15_000, shutdownMs: 15_000, socketMs: 10 * 60_000 };
const REVISION = /^t:([0-9a-f]{64})$/;
/** A merge changed what the live note changed too: nothing of it is taken. */
class MergeConflict extends Error {}
/**
 * The store key of a merge's answer: one per person, link and merge id, so nobody answers, or forestalls, someone else's
 * merge by naming its id, and a repeat finds the answer in the reopened note too.
 */
const mergeKey = ({ person }: LiveContext, id: string, mergeId: string) => createHash('sha256').update(JSON.stringify([person.realm, person.userId, id, mergeId]), 'utf8').digest('hex');
const iso = (time: number) => new Date(time).toISOString();

/**
 * Who an edit is recorded for: a person or an agent, by their verified email in lower case, else by their sign-in, with
 * the person they signed in as, whose own credential a check-in may commit with. The name and email are the identity's
 * (`LiveContext.live`, else `LiveContext.author`), never a client's word, and no email is made up where there is none.
 */
export function liveEditorRef(context: LiveContext, agent: boolean): EditorRef {
  const { person } = context, shown = liveIdentityOf(context);
  const signIn = `${person.realm}:${person.userId}`;
  return { key: `${agent ? 'agent' : 'person'}:${shown?.email ? shown.email.toLowerCase() : signIn}`, name: editorName(shown?.name || signIn), ...(shown?.email ? { email: shown.email } : {}), agent, person: { realm: person.realm, userId: person.userId } };
}

/** The longest editor name the check-in engine takes, in UTF-16 units; a longer one is cut, never split in a surrogate pair. */
const EDITOR_NAME_MAX = 256;
const editorName = (name: string) => {
  if (name.length <= EDITOR_NAME_MAX) return name;
  let cut = '';
  for (const point of name) {
    if (cut.length + point.length > EDITOR_NAME_MAX) break;
    cut += point;
  }
  return cut;
};

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

  /** The base and text of typing a tab kept of an earlier epoch of `link`, from the document that epoch ended with; null once the store no longer has it. */
  const typedIn = async (link: StoredLink, { document, update }: LiveTypedIn) => {
    const at = document.lastIndexOf('.');
    const epoch = Number(document.slice(at + 1));
    if (document.slice(0, at) !== link.id || !Number.isSafeInteger(epoch) || epoch < 1 || epoch >= link.epoch) return null;
    const ended = await store.ended(link.id, epoch, clock());
    if (!ended) return null;
    const texts = typedInTexts(ended, update);
    if (!texts) throw new SourceError('typedIn.update is not a Yjs update of its document.', 400);
    return { base: fits(normalizeLiveText(texts.base)), text: fits(normalizeLiveText(texts.text)) };
  };

  const person = (context: LiveContext): LivePersonCalls =>
    afterCheck<LivePersonCalls>({
      checkouts: rows,
      async read(repository, id) {
        const link = await live(repository, id);
        const shot = await documents.snapshot(link);
        documents.remember(link, shot);
        const initial = link.path === null ? await store.initialText(link.id) : null;
        return { ...textOf(shot), ...(initial !== null ? { initialText: initial } : {}) };
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
      /*
       * A text written on a base the writer names, merged by character over what the note became since (A4 of the
       * collab-first spec). It is one more server write on the document's queue, in the writer's name, so they are
       * credited and their credential may commit the check-in. A conflict, or a diff that ran out of time, takes nothing.
       */
      async merge(repository, id, request): Promise<LiveMergeAnswer> {
        const link = await live(repository, id);
        let base = fits(normalizeLiveText(request.base)), mine = fits(normalizeLiveText(request.text));
        const key = mergeKey(context, link.id, request.mergeId);
        // A repeat is answered before anything is computed; the append's own check decides between two that race.
        const known = await store.mergeAnswer(key, clock());
        if (known !== null) return liveMergeAnswerOf(JSON.parse(known));
        // Typing a tab kept of an epoch that ended: merged on the text that epoch ended with, which holds whatever of it the
        // server stored; once that is gone, the base the tab names may lack some of it, and two insertions at one point conflict.
        let uncertainBase = false;
        if (request.typedIn) {
          const typed = await typedIn(link, request.typedIn);
          if (typed) ({ base, text: mine } = typed);
          else uncertainBase = true;
        }
        let written;
        try {
          written = await documents.edit(link, liveEditorRef(context, false), current => {
            const next = rebaseLiveText(base, current, mine, undefined, { uncertainBase });
            if (next === null) throw new MergeConflict();
            return fits(next);
          }, { key, until: clock() + LIVE_MERGE_MS, answer: hash => JSON.stringify({ applied: true, contentHash: hash }) });
        } catch (error) {
          if (error instanceof MergeConflict) return { conflict: true };
          throw error;
        }
        if (written.merged !== undefined) return liveMergeAnswerOf(JSON.parse(written.merged));
        documents.remember(link, written);
        // Nothing to take (the note holds the text already) is applied too, and leaves no edit.
        return written.answer !== undefined ? liveMergeAnswerOf(JSON.parse(written.answer)) : { applied: true, contentHash: written.hash };
      },
    });

  const service = afterCheck<Required<LiveServiceCalls>>({
    async repositories() {
      return (await store.repositories()).filter(covers);
    },
    checkouts: rows,
    async open(repository, author, as) {
      covered(repository);
      return options.open(repository, author, as);
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
      return { ...textOf(shot), checkout: rowOf(link, shot.hash, activeEditors), editors: editors.map((editor): LiveEditor => ({ name: editor.name, ...(editor.email !== undefined ? { email: editor.email } : {}), agent: editor.agent, firstAt: iso(editor.firstAt), lastAt: iso(editor.lastAt), ...(editor.person !== undefined ? { person: editor.person } : {}) })), ...(initial !== null ? { initialText: initial } : {}) };
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
    async unlease(repository, id, lease) {
      const link = await live(repository, id);
      await store.unlease(link.id, tokenOf(lease), clock());
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
