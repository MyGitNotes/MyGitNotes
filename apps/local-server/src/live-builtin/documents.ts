import { type Document, Hocuspocus, type LocalTransactionOrigin } from '@hocuspocus/server';
import { LIVE_MAX_BYTES, liveContentHash, LiveNotLiveError, LiveTooLargeError, LiveUnavailableError, normalizeLiveText, rebaseLiveText, type RepositoryId, type TextEdit, textEdits } from '@mygitnotes/core';
import * as Y from 'yjs';
import type { EditorRef, LiveStore, MergeRecord, StoredDocument, StoredLink } from './store.js';

/*
 * The Yjs documents of the built-in editor's live links in one process (docs/specs/2026-11-15-builtin-live-editor §4).
 * The store is the authority: an update is appended to it before any document takes it, so a document held here is a
 * copy that can be thrown away, and the state and log of the store always give the text at its sequence. One
 * Hocuspocus instance, used as a library, holds the documents: it loads one from the store when a server write or a
 * socket (`socket.ts`) first needs it, and compacts it into the store a moment after its last change.
 */

/** The text of a live link at one sequence of its store. */
export interface LiveSnapshot {
  text: string;
  /** sha256 hex of the text in normal form. */
  hash: string;
  /** The store sequence the text is exactly at: every update appended up to it, and none after. */
  seq: number;
}

/** A link's document held in this process, as a socket holds it; `close` lets it go. */
export interface OpenLiveDocument {
  document: Y.Doc;
  close(): Promise<void>;
}

export interface LiveDocuments {
  /**
   * The link's text exactly at a sequence of the store. Throws `LiveNotLiveError` when its epoch is no longer the live
   * one, and `LiveUnavailableError` when the store lost its state.
   */
  snapshot(link: StoredLink): Promise<LiveSnapshot>;
  /** The hash of the link's current text, for its row. */
  contentHash(link: StoredLink): Promise<string>;
  /**
   * A server-side write: `change` turns the current text into the new one, and the difference is appended to the store
   * before the document takes it. Writes of one document run one after another.
   *
   * With `merge`, the write is a merge that may be asked for again: its append leaves `merge.answer(hash of the new
   * text)` under `merge.key` in the same step, and the write answers it as `answer`. When the store already holds an
   * answer under that key (another process, or an earlier request, landed the same merge), nothing is appended or
   * applied, and that answer comes back as `merged`.
   */
  edit(link: StoredLink, editor: EditorRef | null, change: (current: string, hash: string) => string, merge?: LiveMergeWrite): Promise<{ text: string; hash: string; changed: boolean; answer?: string; merged?: string; }>;
  /** Loads the link's document from the store when this process does not hold it, brings it up to the link, and holds it. */
  open(link: StoredLink): Promise<OpenLiveDocument>;
  /**
   * Takes one Yjs update of a document this process holds, as a socket sends it: appended to the store for `editor`,
   * then applied, so whoever is told it is saved was told the truth. An update the document already holds (a tab
   * sending it again after a reconnect) is taken without an append, and answers false. A `\r` or NUL it typed is taken
   * out again by an update of the server's own, so the text stays in normal form. An update that is not typing in the
   * note's text is refused with `LiveUpdateRefusedError`, and nothing of it is stored. Typing that builds on what the
   * document lacks first has the document brought up to the store; when the store lacks it too (it is still on its way
   * from the tab), `LiveUpdateWaitingError` is thrown, and nothing of it is stored.
   */
  accept(link: LiveEpoch, update: Uint8Array, editor: EditorRef): Promise<boolean>;
  /** Keeps a text that was handed out, so a write can name it as its base. */
  remember(link: StoredLink, text: { text: string; hash: string; }): void;
  /** A text handed out for the link's epoch, by hash. */
  recall(link: StoredLink, hash: string): string | undefined;
  /** Forgets the handed-out texts of the repository's links that are not among `live`. */
  forget(repository: RepositoryId, live: readonly StoredLink[]): void;
  /** Everyone left the link's document: it is compacted and let go, with the texts handed out. */
  unload(link: LiveEpoch): Promise<void>;
  /** The link's epoch ended: the sockets on its document are told `released` and closed, it is let go, and nothing of it is stored. */
  drop(link: LiveEpoch): Promise<void>;
  /**
   * The link may lie elsewhere now (a move or rename recorded its target, §20.4): the sockets on its document, if this
   * process holds it, are told `moved` when the path reads know it by changed, so each tab reads the note again and
   * follows it. Another process finds the change at its next catch-up.
   */
  relocated(link: StoredLink): void;
  /**
   * Brings every document that sockets hold up to the store (§4.5): what another process appended reaches them, and a
   * document whose epoch another process ended is dropped. One process finds nothing new.
   */
  catchUp(): Promise<void>;
  /** Compacts and lets go every document this process holds. */
  shutdown(): Promise<void>;
  /** The server the documents live in: the socket hands it connections and hooks into it. */
  readonly hocuspocus: Hocuspocus;
}

/** What makes a server-side write a merge that a repeat finds again. */
export interface LiveMergeWrite extends Pick<MergeRecord, 'key' | 'until'> {
  /** The answer to keep, given the hash of the text the merge made. */
  answer(hash: string): string;
}

export interface LiveDocumentsOptions {
  store: LiveStore;
  clock: () => number;
  /** The largest live text, in UTF-8 bytes. */
  maxBytes: number;
  /** The texts handed out that one document keeps: at most this many, and at most `ringBytes` of UTF-8; the newest always. */
  ringTexts: number;
  ringBytes: number;
}

/** The Y.Text of a document that holds the note's text. */
const CONTENT = 'content';
/** How an update read from the store is applied: it is nothing new, so no compaction is asked for. */
const FROM_STORE: LocalTransactionOrigin = { source: 'local', skipStoreHooks: true };
/** How an update just appended to the store is applied: a compaction is due. */
const APPENDED: LocalTransactionOrigin = { source: 'local' };
const NAME = /^([A-Za-z0-9_-]{1,64})\.([1-9][0-9]{0,9})$/;

/** One epoch of a link: what a document, a socket and a ticket are bound to. */
export type LiveEpoch = Pick<StoredLink, 'id' | 'epoch'>;

/** The name of the document of a link's epoch: `<id>.<epoch>`. A tab of an earlier epoch names another document. */
export const liveDocumentName = (link: LiveEpoch) => `${link.id}.${link.epoch}`;

/** What every socket on a document is told when its epoch ended (§6.5). */
export const RELEASED = JSON.stringify({ type: 'released' });
/** What every socket on a document is told when its note lies elsewhere now: a move or rename recorded its target (§20.4). */
export const MOVED = JSON.stringify({ type: 'moved' });

/** Where reads know a link's note: its target while it waits to move there, else its path. */
const placeOf = (link: Pick<StoredLink, 'path' | 'target'>) => link.target ?? link.path;

/** A socket sent an update that is not typing in the note's text; nothing of it was stored. */
export class LiveUpdateRefusedError extends Error {
  constructor() {
    super('The update is not typing in the note.');
  }
}

/**
 * A socket sent typing that builds on typing neither the document nor the store has: the tab typed on before it sent
 * what it typed offline, or before its sync. Nothing of it was stored; the tab sends all of it once it connects again.
 */
export class LiveUpdateWaitingError extends Error {
  constructor() {
    super('The update builds on typing the server does not have yet.');
  }
}

/** The Yjs state an epoch is seeded with: one document that holds `text`. */
export function seedLiveState(text: string): Uint8Array {
  const document = new Y.Doc();
  try {
    document.getText(CONTENT).insert(0, text);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

/** Applies edits that are in order and apart to a Y.Text, the last first so the offsets of the earlier ones hold. */
function applyTextEdits(text: Y.Text, edits: readonly TextEdit[]) {
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i];
    if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from);
    if (edit.text) text.insert(edit.from, edit.text);
  }
}

/**
 * The one Yjs update that turns the text of `document` into `next`, made on a copy as a client that holds the document
 * would make it; the document itself is not touched. Null when the text is `next` already.
 */
export function textUpdate(document: Y.Doc, next: string): Uint8Array | null {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(document));
    const made: Uint8Array[] = [];
    copy.on('update', (update: Uint8Array) => void made.push(update));
    const text = copy.getText(CONTENT);
    const edits = textEdits(text.toString(), next);
    copy.transact(() => applyTextEdits(text, edits));
    return made[0] ?? null;
  } finally {
    copy.destroy();
  }
}

/**
 * The most units one update may add to a live document, and the most a merge walks, for a text of at most `maxBytes`:
 * clocks of every client, deleted runs included. A deleted run is stored as its length alone, so a few bytes of an update
 * can claim any length; an update that claims more is refused (cfx-F001). The server's own rewrites add units a document
 * never sheds, so a document may grow past this; a merge then does not walk it (cfx2-F001).
 */
export const liveMaxUnits = (maxBytes: number = LIVE_MAX_BYTES) => 4 * maxBytes;

/** The units a state vector names: the sum of its clocks. */
const unitsOf = (vector: Map<number, number>) => {
  let units = 0;
  for (const clock of vector.values()) units += clock;
  return units;
};

/** The units a document holds once it takes `update`, without taking it; Infinity for an update that cannot be read. */
function unitsAfter(document: Y.Doc, update: Uint8Array): number {
  const ends = Y.decodeStateVector(Y.encodeStateVector(document));
  try {
    for (const struct of Y.decodeUpdate(update).structs) ends.set(struct.id.client, Math.max(ends.get(struct.id.client) ?? 0, struct.id.clock + struct.length));
  } catch {
    return Infinity;
  }
  return unitsOf(ends);
}

/** What a live text never holds (`normalizeLiveText`). */
const CONTROL = /[\r\0]/;

/** Whether a Yjs update inserts text that holds a `\r` or a NUL. */
function insertsControl(update: Uint8Array): boolean {
  return Y.decodeUpdate(update).structs.some(struct => struct instanceof Y.Item && struct.content instanceof Y.ContentString && CONTROL.test(struct.content.str));
}

/**
 * Whether a Yjs update is what typing in a tab makes (it reads to its end, and holds only text put into the `content`
 * text or taken out of it), and whether the document can take all of it: `whole` when it waits for nothing the
 * document lacks, `waiting` when it does. Only whole typing of a socket is stored. One that cannot be read would keep
 * the note from loading ever again; other content, or text left waiting for an update that never comes, would grow the
 * stored state past any limit on the text.
 */
function typing(document: Y.Doc, update: Uint8Array): 'whole' | 'waiting' | 'not-typing' {
  let structs, deletes;
  try {
    ({ structs, ds: deletes } = Y.decodeUpdate(update));
  } catch {
    return 'not-typing';
  }
  /** The next clock of each client, in the document. */
  const known = Y.decodeStateVector(Y.encodeStateVector(document));
  /** The same once the update is taken, for the clients it names. */
  const ends = new Map<number, number>();
  // Whether everything the update builds on is in the document, or earlier in the update's run of the same client.
  let whole = true, current: number | undefined;
  for (const struct of structs) {
    const { client, clock } = struct.id;
    if (client !== current) {
      // Yjs keeps one run of a client and drops the others.
      if (ends.has(client)) return 'not-typing';
      current = client;
    }
    if (struct instanceof Y.Item) {
      const parent: unknown = struct.parent;
      if (!(struct.content instanceof Y.ContentString || struct.content instanceof Y.ContentDeleted) || struct.parentSub !== null || (parent !== null && parent !== CONTENT)) return 'not-typing';
      for (const before of [struct.origin, struct.rightOrigin]) if (before && before.clock >= (known.get(before.client) ?? 0) && !(before.client === client && before.clock < clock)) whole = false;
    } else if (!(struct instanceof Y.GC)) return 'not-typing';
    const end = ends.get(client) ?? known.get(client) ?? 0;
    if (clock > end) whole = false;
    ends.set(client, Math.max(end, clock + struct.length));
  }
  for (const [client, ranges] of deletes.clients) for (const range of ranges) if (range.clock + range.len > (ends.get(client) ?? known.get(client) ?? 0)) whole = false;
  if (whole) return 'whole';
  // Not plain to see, as when a tab brings what tabs of another process typed: a copy of the document takes it, and shows whether anything is left waiting.
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(copy, update);
    return copy.store.pendingStructs === null && copy.store.pendingDs === null ? 'whole' : 'waiting';
  } catch {
    return 'not-typing';
  } finally {
    copy.destroy();
  }
}

const textOf = (document: Y.Doc) => {
  const text = document.getText(CONTENT).toString();
  return { text, hash: liveContentHash(text) };
};

/** A document of exactly what one read of the store returned: its state, then its log in order. */
function storedDocument(stored: StoredDocument): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, stored.state);
  for (const update of stored.log) Y.applyUpdate(document, update);
  return document;
}

/** The UTF-16 units of each client's live string items in a document's text, by clock, for reading a unit by its id. */
function liveUnits(text: Y.Text): (client: number, clock: number) => string | undefined {
  const runs = new Map<number, { clock: number; str: string; }[]>();
  for (let item = text._start; item; item = item.right) {
    if (item.deleted || !(item.content instanceof Y.ContentString)) continue;
    const list = runs.get(item.id.client) ?? [];
    list.push({ clock: item.id.clock, str: item.content.str });
    runs.set(item.id.client, list);
  }
  for (const list of runs.values()) list.sort((a, b) => a.clock - b.clock);
  return (client, clock) => {
    const list = runs.get(client);
    if (!list) return undefined;
    let low = 0, high = list.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, run = list[middle];
      if (clock < run.clock) high = middle - 1;
      else if (clock >= run.clock + run.str.length) low = middle + 1;
      else return run.str[clock - run.clock];
    }
    return undefined;
  };
}

/**
 * How a tab's typing kept of a released epoch merges (`LiveMergeRequest.typedIn`), from the document that epoch ended with
 * (`ended`) and the tab's whole Yjs update of it: `base` is the text the document ended with and `text` the tab's typing on
 * it; Yjs takes what the document already holds once, so typing the server stored before the tab heard so is in the base,
 * not the change (cf16-F001).
 *
 * Where the ended document holds changes the tab never had (someone else typed while it was cut off), Yjs would string two
 * replacements of one line together, so the tab's text is instead merged by character (A4) on what both had: the units
 * both documents know that not both deleted. Two insertions at one point then conflict, since the span between them may
 * have been replaced on both sides (spec A3.1, S6 (c)).
 * Null for an update that cannot be read or that claims more than `maxUnits` (`liveMaxUnits`) units the ended document
 * does not hold (cfx-F001); `unwalked` for an ended document past `maxUnits`, which server rewrites can make (cfx2-F001)
 * and whose units would take too long to walk: the typing then merges on the base the tab names.
 */
export function typedInTexts(ended: Pick<StoredDocument, 'state' | 'log'>, update: Uint8Array, maxUnits = liveMaxUnits()): { base: string; text: string; } | { conflict: true; } | 'unwalked' | null {
  const server = storedDocument({ ...ended, gen: 0, seq: 0 });
  const tab = new Y.Doc();
  try {
    try {
      Y.applyUpdate(tab, update);
    } catch {
      return null;
    }
    const serverText = server.getText(CONTENT), tabText = tab.getText(CONTENT);
    const base = serverText.toString(), mine = tabText.toString();
    const serverKnows = Y.decodeStateVector(Y.encodeStateVector(server)), tabKnows = Y.decodeStateVector(Y.encodeStateVector(tab));
    // The first walk below is bounded by the server's units, the second by those plus what only the tab claims.
    let excess = 0;
    for (const [client, clock] of tabKnows) excess += Math.max(0, clock - (serverKnows.get(client) ?? 0));
    if (excess > maxUnits) return null;
    if (unitsOf(serverKnows) > maxUnits) return 'unwalked';
    const serverDeleted = Y.createDeleteSetFromStructStore(server.store), tabDeleted = Y.createDeleteSetFromStructStore(tab.store);
    const knownTo = (vector: Map<number, number>, client: number, clock: number) => clock < (vector.get(client) ?? 0);
    // Changes the tab never had: units the server made it never heard of, or deleted where the tab still has them.
    let unseen = [...serverKnows].some(([client, clock]) => clock > (tabKnows.get(client) ?? 0));
    for (let item = serverText._start; item && !unseen; item = item.right) {
      if (!item.deleted) continue;
      for (let unit = 0; unit < item.length && !unseen; unit++) {
        const id = Y.createID(item.id.client, item.id.clock + unit);
        unseen = knownTo(tabKnows, id.client, id.clock) && !Y.isDeleted(tabDeleted, id);
      }
    }
    if (!unseen) {
      try {
        Y.applyUpdate(server, update);
      } catch {
        return null;
      }
      return { base, text: serverText.toString() };
    }
    // What both had, in the tab's order: each unit both know that not both deleted, read from whichever still holds it.
    const serverUnit = liveUnits(serverText);
    let ancestor = '';
    for (let item = tabText._start; item; item = item.right) {
      const str = !item.deleted && item.content instanceof Y.ContentString ? item.content.str : null;
      for (let unit = 0; unit < item.length; unit++) {
        const id = Y.createID(item.id.client, item.id.clock + unit);
        if (!knownTo(serverKnows, id.client, id.clock)) continue;
        if (str !== null) ancestor += str[unit];
        else if (!Y.isDeleted(serverDeleted, id)) ancestor += serverUnit(id.client, id.clock) ?? '';
      }
    }
    const text = rebaseLiveText(ancestor, base, mine, undefined, { uncertainBase: true });
    return text === null ? { conflict: true } : { base, text };
  } finally {
    server.destroy();
    tab.destroy();
  }
}

/** What this process knows of a document it holds. */
interface Held {
  /** Every update the store numbered up to here is in the document. */
  seen: number;
  /** The highest sequence of an update this process appended and applied itself. */
  top: number;
  /** The generation of the stored state the document last took. */
  gen: number;
  /** The document's text, kept until it next changes. */
  text?: { text: string; hash: string; };
  /** A `\r` or NUL may have reached the text since it was last tidied. */
  unclean: boolean;
  /** Where reads knew the note when its tabs were last told of it ({@link placeOf}). */
  place: string | null;
}

/** The texts handed out for one document, oldest first. */
interface Ring {
  repository: RepositoryId;
  texts: Map<string, { text: string; bytes: number; }>;
  bytes: number;
}

export function liveDocuments({ store, clock, maxBytes, ringTexts, ringBytes }: LiveDocumentsOptions): LiveDocuments {
  const states = new WeakMap<Y.Doc, Held>();
  const rings = new Map<string, Ring>();
  /** The last server write of each document that has one in flight. */
  const queues = new Map<string, Promise<unknown>>();

  /**
   * Why a live link's document cannot be read: its epoch ended meanwhile, or the store holds no state for it. That is
   * lost text: it is logged by id, and the link is never seeded again, since a tab that still holds the old state would
   * merge it with the new seed into doubled text.
   */
  const lost = async (link: Pick<StoredLink, 'id' | 'epoch'>): Promise<Error> => {
    const now = await store.link(link.id);
    if (!now?.live || now.epoch !== link.epoch) return new LiveNotLiveError();
    console.error(`[live-builtin] The stored state of live note ${link.id} (epoch ${link.epoch}) is missing: its text is lost. It is not seeded again.`);
    return new LiveUnavailableError();
  };

  /** Applies one read of the store to a held document: everything the store numbered up to that read is then in it. */
  const take = (document: Document, state: Held, stored: StoredDocument) => {
    if (document.isDestroyed) return;
    if (stored.gen !== state.gen) Y.applyUpdate(document, stored.state, FROM_STORE);
    for (const update of stored.log) Y.applyUpdate(document, update, FROM_STORE);
    state.gen = stored.gen;
    state.seen = Math.max(state.seen, stored.seq);
  };

  /**
   * Replaces the stored state by exactly what one read returned, and drops the entries of that read from the log. The
   * state is built from the store's own state and entries, never from a document held here, so the stored hash is the
   * text at that read's sequence. Not `done` when another compaction ran since the read, or the store refused this one:
   * nothing is changed then, every update is still in the log, and a later compaction takes it.
   */
  const squash = async (id: string, epoch: number, stored: StoredDocument) => {
    const document = storedDocument(stored);
    try {
      const { hash } = textOf(document);
      const done = await store.compact(id, epoch, stored.gen, stored.log.length, Y.encodeStateAsUpdate(document), hash, stored.seq).catch(error => {
        console.warn(`[live-builtin] Compacting live note ${id} failed: ${error instanceof Error ? error.constructor.name : 'error'}. Its updates stay in the log.`);
        return false;
      });
      return { hash, done };
    } finally {
      document.destroy();
    }
  };

  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce: 2000,
    maxDebounce: 10_000,
    unloadImmediately: false,
    timeout: 30_000,
    maxPendingDocuments: 1,
    maxUnauthenticatedQueueSize: 1024 * 1024,
    yDocOptions: { gc: true, gcFilter: () => true },
    /** The store is seeded at checkout and never here: a document is only ever what the store holds for its epoch. */
    async onLoadDocument({ document, documentName }) {
      const [, id, epoch] = NAME.exec(documentName) ?? [];
      const link = id ? await store.link(id) : null;
      if (!link?.live || link.epoch !== Number(epoch)) throw new LiveNotLiveError();
      const stored = await store.document(link.id, link.epoch);
      if (!stored) throw await lost(link);
      Y.applyUpdate(document, stored.state, FROM_STORE);
      for (const update of stored.log) Y.applyUpdate(document, update, FROM_STORE);
      const state: Held = { seen: stored.seq, top: 0, gen: stored.gen, unclean: CONTROL.test(document.getText(CONTENT).toString()), place: placeOf(link) };
      states.set(document, state);
      document.on('update', (update: Uint8Array) => {
        state.text = undefined;
        if (insertsControl(update)) state.unclean = true;
      });
    },
    /** A moment after a document's last change, and when it is let go: what this process read of the log is compacted. */
    async onStoreDocument({ document, documentName }) {
      const [, id, epoch] = NAME.exec(documentName) ?? [];
      if (!id) return;
      // A store that cannot be read now is read at the next compaction: nothing is lost meanwhile, every update is in its log.
      const stored = await store.document(id, Number(epoch)).catch(() => null);
      // Released meanwhile: there is nothing of this epoch to keep.
      if (!stored) return;
      const state = states.get(document);
      // What another process appended becomes visible here, before its entries leave the log.
      if (state) take(document, state, stored);
      if (!stored.log.length) return;
      const { done } = await squash(id, Number(epoch), stored);
      if (done && state) state.gen = stored.gen + 1;
    },
    /**
     * Hocuspocus asks twice to unload a document that was let go at once, the second time a moment later. By then
     * another document may be held under the name (a tab that reconnected): the late request is refused, or it would
     * take that one out of the documents while its sockets stay on it.
     */
    async beforeUnloadDocument({ instance, document, documentName }) {
      if (instance.documents.get(documentName) !== document) throw new Error();
    },
  });

  const held = (name: string) => {
    const document = hocuspocus.documents.get(name);
    const state = document && states.get(document);
    return document && state ? { document, state } : undefined;
  };
  const heldText = ({ document, state }: { document: Document; state: Held; }) => state.text ??= textOf(document);
  /** Whether the held document is exactly the store's text at `seq`: everything up to it, and nothing this process appended after. */
  const exactAt = (state: Held, seq: number) => state.seen === seq && state.top <= seq;

  /** The link's text at one sequence of the store; null when its epoch is no longer the live one or its state is missing. */
  const read = async (link: StoredLink): Promise<LiveSnapshot | null> => {
    const here = held(liveDocumentName(link));
    if (here && exactAt(here.state, link.seq)) return { ...heldText(here), seq: link.seq };
    const stored = await store.document(link.id, link.epoch);
    if (!stored) return null;
    if (here) {
      take(here.document, here.state, stored);
      if (!here.document.isDestroyed && exactAt(here.state, stored.seq)) return { ...heldText(here), seq: stored.seq };
    }
    const document = storedDocument(stored);
    try {
      return { ...textOf(document), seq: stored.seq };
    } finally {
      document.destroy();
    }
  };

  /** Holds the link's document, loaded from the store when this process had none, and brought up to the link's sequence. */
  const hold = async (link: StoredLink) => {
    const direct = await hocuspocus.openDirectConnection(liveDocumentName(link));
    // The document stays for a moment after it is let go, so writes that follow one another share it and one compaction.
    const close = () => direct.disconnect({ unloadImmediately: false });
    try {
      const document = direct.document!;
      const state = states.get(document)!;
      // Behind the link, or holding an update of its own beyond a gap another process left: the store fills it in.
      if (state.seen < link.seq || state.top > state.seen) {
        const stored = await store.document(link.id, link.epoch);
        if (!stored) throw await lost(link);
        take(document, state, stored);
      }
      return { document, state, close };
    } catch (error) {
      await close();
      throw error;
    }
  };

  /**
   * Appends an update to the store, then applies it to the held document: never the other way round. An update that
   * carries a merge record the store already holds an answer for is neither appended nor applied, and that answer is returned.
   */
  const put = async (link: LiveEpoch, document: Document, state: Held, update: Uint8Array, editor: EditorRef | null, merge?: MergeRecord): Promise<string | undefined> => {
    const appended = await store.append(link.id, link.epoch, update, editor, clock(), merge);
    if (appended === 'not-live') throw new LiveNotLiveError();
    if ('merged' in appended) return appended.merged;
    if (document.isDestroyed) return;
    Y.applyUpdate(document, update, APPENDED);
    state.top = Math.max(state.top, appended.seq);
    if (appended.seq === state.seen + 1) state.seen = appended.seq;
  };

  /**
   * Takes a `\r` or NUL that reached a held document out again, by one update of the server's own in the store: the
   * text stays in normal form whatever a socket sends. The update names the editor whose typing it tidies, or nobody.
   */
  const tidy = async (link: LiveEpoch, document: Document, state: Held, editor: EditorRef | null) => {
    if (!state.unclean || document.isDestroyed) return;
    state.unclean = false;
    const update = textUpdate(document, normalizeLiveText(document.getText(CONTENT).toString()));
    if (!update) return;
    try {
      await put(link, document, state, update, editor);
    } catch (error) {
      state.unclean = true;
      throw error;
    }
  };

  /** Runs after the document's earlier server writes, whether they landed or not. */
  const serial = <T>(name: string, run: () => Promise<T>): Promise<T> => {
    const turn = (queues.get(name) ?? Promise.resolve()).then(run, run);
    const settled = turn.then(() => {}, () => {});
    queues.set(name, settled);
    void settled.then(() => {
      if (queues.get(name) === settled) queues.delete(name);
    });
    return turn;
  };

  /** Compacts a held document now and lets it go, unless something else still holds it. */
  const letGo = async (name: string) => {
    await queues.get(name);
    if (!hocuspocus.documents.has(name)) return;
    await (await hocuspocus.openDirectConnection(name)).disconnect();
  };

  const drop = async (link: LiveEpoch) => {
    const name = liveDocumentName(link);
    rings.delete(name);
    const document = hocuspocus.documents.get(name);
    if (!document) return;
    // The tabs that hold it are told, and closed: what they hold is an epoch that ended.
    document.broadcastStateless(RELEASED);
    hocuspocus.closeConnections(name);
    await letGo(name);
  };

  /** Tells the tabs on the link's document, held here, that the note moved, once per place it moves to. */
  const relocated = (link: StoredLink) => {
    const document = hocuspocus.documents.get(liveDocumentName(link));
    const state = document && states.get(document);
    if (!document || !state || state.place === placeOf(link)) return;
    state.place = placeOf(link);
    document.broadcastStateless(MOVED);
  };

  return {
    async snapshot(link) {
      const shot = await read(link);
      if (!shot) throw await lost(link);
      return shot;
    },
    async contentHash(link) {
      if (held(liveDocumentName(link))) return (await read(link))?.hash ?? link.contentHash;
      if (link.contentSeq === link.seq) return link.contentHash;
      // Updates nobody compacted: the process that held the document died, or is another one. This one compacts them, so the stored hash is the text's again.
      const stored = await store.document(link.id, link.epoch);
      return stored ? (await squash(link.id, link.epoch, stored)).hash : link.contentHash;
    },
    edit(link, editor, change, merge) {
      return serial(liveDocumentName(link), async () => {
        const { document, state, close } = await hold(link);
        try {
          await tidy(link, document, state, null);
          const current = heldText({ document, state });
          // Computed on the text as it is now, with nothing awaited in between: typing that lands before the append merges as Yjs merges concurrent edits.
          const next = change(current.text, current.hash);
          const update = next === current.text ? null : textUpdate(document, next);
          if (!update) return { ...current, changed: false };
          const answer = merge?.answer(liveContentHash(next));
          const merged = await put(link, document, state, update, editor, merge && answer !== undefined ? { key: merge.key, answer, until: merge.until } : undefined);
          if (merged !== undefined) return { ...current, changed: false, merged };
          return { ...heldText({ document, state }), changed: true, ...(answer !== undefined ? { answer } : {}) };
        } finally {
          await close();
        }
      });
    },
    async open(link) {
      const { document, close } = await hold(link);
      return { document, close };
    },
    async accept(link, update, editor) {
      const here = held(liveDocumentName(link));
      if (!here) throw new LiveNotLiveError();
      const { document, state } = here;
      let verdict = typing(document, update);
      if (verdict === 'waiting') {
        // What it builds on may be what another process appended and this one has not read yet: the store fills it in.
        const stored = await store.document(link.id, link.epoch);
        if (!stored) throw await lost(link);
        take(document, state, stored);
        // A document let go meanwhile takes nothing: the tab connects again, and finds out why.
        verdict = document.isDestroyed ? 'waiting' : typing(document, update);
      }
      if (verdict === 'not-typing') throw new LiveUpdateRefusedError();
      if (verdict === 'waiting') throw new LiveUpdateWaitingError();
      if (Y.snapshotContainsUpdate(Y.snapshot(document), update)) return false;
      // A deleted run claims units by its length alone: an update that adds more than a live text needs is refused.
      if (unitsAfter(document, update) - unitsOf(Y.decodeStateVector(Y.encodeStateVector(document))) > liveMaxUnits(maxBytes)) throw new LiveTooLargeError();
      // Only an update that could take the text past the limit is measured, on a copy.
      if (document.getText(CONTENT).length * 3 + update.byteLength > maxBytes) {
        const copy = new Y.Doc();
        try {
          Y.applyUpdate(copy, Y.encodeStateAsUpdate(document));
          Y.applyUpdate(copy, update);
          if (Buffer.byteLength(copy.getText(CONTENT).toString(), 'utf8') > maxBytes) throw new LiveTooLargeError();
        } finally {
          copy.destroy();
        }
      }
      await put(link, document, state, update, editor);
      await tidy(link, document, state, editor);
      return true;
    },
    remember(link, { text, hash }) {
      const name = liveDocumentName(link);
      const ring = rings.get(name) ?? { repository: link.repository, texts: new Map(), bytes: 0 };
      rings.set(name, ring);
      ring.bytes -= ring.texts.get(hash)?.bytes ?? 0;
      ring.texts.delete(hash);
      const bytes = Buffer.byteLength(text, 'utf8');
      ring.texts.set(hash, { text, bytes });
      ring.bytes += bytes;
      for (const [oldest, entry] of ring.texts) {
        if (ring.texts.size <= 1 || (ring.texts.size <= ringTexts && ring.bytes <= ringBytes)) break;
        ring.texts.delete(oldest);
        ring.bytes -= entry.bytes;
      }
    },
    recall(link, hash) {
      return rings.get(liveDocumentName(link))?.texts.get(hash)?.text;
    },
    forget(repository, live) {
      const kept = new Set(live.map(liveDocumentName));
      for (const [name, ring] of rings) if (ring.repository === repository && !kept.has(name)) rings.delete(name);
    },
    async unload(link) {
      const name = liveDocumentName(link);
      rings.delete(name);
      await letGo(name);
    },
    drop,
    relocated,
    async catchUp() {
      await Promise.all([...hocuspocus.documents].map(async ([name, document]) => {
        const [, id, epoch] = NAME.exec(name) ?? [];
        const state = states.get(document);
        if (!id || !state || !document.connections.size) return;
        try {
          const link = await store.link(id);
          if (!link?.live || link.epoch !== Number(epoch)) return await drop({ id, epoch: Number(epoch) });
          relocated(link);
          // Nothing new, and nothing of this process's own beyond a gap another process left.
          if (link.seq === state.seen && link.gen === state.gen && state.top <= state.seen) return;
          const stored = await store.document(id, link.epoch);
          if (stored) take(document, state, stored);
          else await lost(link);
        } catch (error) {
          console.warn(`[live-builtin] Catching live note ${id} up with the store failed: ${error instanceof Error ? error.constructor.name : 'error'}. It is tried again.`);
        }
      }));
    },
    async shutdown() {
      await Promise.all(queues.values());
      await Promise.all([...hocuspocus.documents.keys()].map(letGo));
    },
    hocuspocus,
  };
}
