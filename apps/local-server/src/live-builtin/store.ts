import { LIVE_MAX_BYTES, type LiveConflict, type NotebookKey, type RepositoryId, type WorkspacePerson } from '@mygitnotes/core';

/*
 * What the built-in live editor keeps between check-ins (docs/specs/2026-11-15-builtin-live-editor §3): the links, each
 * epoch's Yjs document as a compacted state plus a log of the updates since, the editors since the last sync, check-in
 * leases, presence and socket tickets. The adapter never sends raw commands: every compound step is one atomic call, so
 * the Redis and the memory store pass one contract (`store-contract.ts`). Every time is the adapter's clock in whole
 * milliseconds, passed in, so a test that moves the clock on works against Redis too.
 */

/** How long a socket ticket holds. The Redis store gives a ticket's key this lifetime, whatever `until` says. */
export const LIVE_TICKET_MS = 60_000;
/** How long the answer of a merge is kept for a repeat of it, and the document of a released epoch for a merge of typing a tab kept of it. */
export const LIVE_MERGE_MS = 24 * 60 * 60_000;
/**
 * The largest ended document kept, its state and log together, in bytes: one past it is not kept, and a merge of typing
 * kept of its epoch falls back to the base the tab names (cfx-F002).
 */
export const LIVE_ENDED_MAX_BYTES = LIVE_MAX_BYTES;
/** How long a process's presence entry counts after its last write, so a process that crashed stops counting. */
export const LIVE_PRESENCE_MS = 90_000;

/** One link: a note checked out to the built-in editor, or a pending note created there. */
export interface StoredLink {
  /** 16 random bytes in base64url: 22 characters, global across repositories. */
  id: string;
  repository: RepositoryId;
  notebook: NotebookKey;
  /** Repository-relative; null while pending. */
  path: string | null;
  /** Pending only: the path pattern the first check-in files the note at. */
  pathRule?: string;
  /** Filed only: the path the next check-in moves the note to (§20.4); the receipt that names it moves the link there. */
  target?: string;
  /** Filed only: a target the last check-in did not move the note to, since Git held that path; the next move clears it. */
  unmoved?: string;
  /** When this epoch began. */
  since: number;
  /** One per check-out or reopen, from 1. The document of an epoch is `<id>.<epoch>`. */
  epoch: number;
  /** False once released: the record stays, so the path it was filed at is known and a reopen reuses the id. */
  live: boolean;
  base: { commit: string; blob: string; contentHash: string; } | null;
  syncedAt: number | null;
  syncedHash: string | null;
  /** The last append that named an editor; a merge, which names none, leaves it. */
  lastEditAt: number | null;
  conflict: LiveConflict | null;
  /** Bumped by every append, and never reset; editors and leases record it. */
  seq: number;
  /** Bumped by every compaction of the current epoch; 0 when the epoch opens. */
  gen: number;
  /** The hash of the text at `contentSeq`, as the checkout or the last compaction gave it. */
  contentHash: string;
  contentSeq: number;
}

/** Who an append is recorded for. */
export interface EditorRef {
  key: string;
  name: string;
  email?: string;
  agent: boolean;
  /** Who the editor signed in as: a check-in may commit with this person's own credential. An entry recorded by 0.20 has none. */
  person?: WorkspacePerson;
}
/** An editor since the last sync. `lastSeq` is the sequence of their last append. */
export interface StoredEditor extends EditorRef {
  firstAt: number;
  lastAt: number;
  lastSeq: number;
}

/** The answer a merge's append leaves for a repeat of it, in the same atomic call as the append. */
export interface MergeRecord {
  /** The sha256 hex of who merged, into which link, under which merge id. */
  key: string;
  /** What the repeat is answered, as the adapter wrote it. */
  answer: string;
  /** When the answer stops counting, by the adapter's clock. */
  until: number;
}

/** A filed link's move: the path its next check-in moves it to, or null for none. */
export interface RetargetTarget {
  target: string | null;
}

/** What a created or reopened epoch starts from. */
export interface LinkInit {
  notebook: NotebookKey;
  base: StoredLink['base'];
  /** The hash of the text the given state holds. */
  contentHash: string;
}

/** What a check-in reports once its commit is made, as `LiveServiceCalls.synced` takes it. */
export interface SyncReceipt {
  commit: string;
  blob: string;
  contentHash: string;
  path: string;
  conflict: LiveConflict | null;
}

/** What a socket ticket opens, and for whom. The store keeps it under the ticket's hash, never under the ticket. */
export interface StoredTicket {
  repository: RepositoryId;
  id: string;
  epoch: number;
  /** `<id>.<epoch>`. */
  document: string;
  editor: EditorRef;
  /** The name other people see. */
  display: string;
}

/** An epoch's document: the compacted state, and the updates appended since, oldest first. */
export interface StoredDocument {
  state: Uint8Array;
  log: Uint8Array[];
  gen: number;
  seq: number;
}

export interface LiveStore {
  /** Throws on a configuration that would lose live text (§3.4); warns about one it cannot read. */
  check(): Promise<void>;
  /** The repositories with live links. */
  repositories(): Promise<RepositoryId[]>;
  /** Live links only, oldest first. */
  links(repository: RepositoryId): Promise<StoredLink[]>;
  /** Live or released; null for an id never issued, or discarded. */
  link(id: string): Promise<StoredLink | null>;
  /**
   * One link per repository and path: created (epoch 1), joined (the live link, untouched), or a released link reopened
   * under its id with epoch + 1, its base and text replaced and its sync, conflict, editors, lease and presence cleared.
   * `state` seeds a created or reopened epoch and is ignored by a join.
   */
  checkout(repository: RepositoryId, init: LinkInit & { path: string; }, state: Uint8Array, now: number): Promise<{ link: StoredLink; outcome: 'created' | 'joined' | 'reopened'; }>;
  /** A link without a path, at epoch 1. `initialText` is kept until the link is filed or discarded. */
  createPending(repository: RepositoryId, init: LinkInit & { pathRule: string; initialText?: string; }, state: Uint8Array, now: number): Promise<StoredLink>;
  /** The text a pending link was created with; null once it is filed or discarded, and when none was given. */
  initialText(id: string): Promise<string | null>;
  /** The document of the link's live epoch, read at one instant; null for a released link, another epoch, or a missing state. */
  document(id: string, epoch: number): Promise<StoredDocument | null>;
  /**
   * Appends one Yjs update of the live epoch and records its editor (none for a merge). `seq` is the link's sequence
   * after it and `length` the log's. 'not-live' for a released or unknown link and for another epoch; nothing is kept then.
   * With `merge`, the append and the answer kept under `merge.key` until `merge.until` are one step: when that key
   * already holds an answer that still counts at `now`, nothing is appended and `{ merged }` gives that answer back.
   */
  append(id: string, epoch: number, update: Uint8Array, editor: EditorRef | null, now: number, merge?: MergeRecord): Promise<{ seq: number; length: number; } | 'not-live' | { merged: string; }>;
  /**
   * The document a released epoch ended with, its state and log as they were at the release, for {@link LIVE_MERGE_MS}
   * after it: a merge of typing a tab kept of that epoch takes it as base. Null before the release, past that time, for
   * a discarded link, and for an unknown one.
   */
  ended(id: string, epoch: number, now: number): Promise<{ state: Uint8Array; log: Uint8Array[]; } | null>;
  /** The answer a merge left under `key` that still counts at `now`; null for none. It outlives the release of its link. */
  mergeAnswer(key: string, now: number): Promise<string | null>;
  /**
   * Replaces the state and drops the first `count` log entries, if `gen` is still the live epoch's: only the entries the
   * caller read and applied go, and one appended since stays. False, with nothing changed, otherwise.
   */
  compact(id: string, epoch: number, gen: number, count: number, state: Uint8Array, contentHash: string, contentSeq: number): Promise<boolean>;
  /** The editors since the last sync, by when each first typed. */
  editors(id: string): Promise<StoredEditor[]>;
  /** Takes the link's lease for `token` until `until`; 'held' while another lease has not run out by `now`. */
  lease(id: string, token: string, until: number, now: number): Promise<'leased' | 'held' | 'not-live'>;
  /** Whether `token` holds the link's lease at `now`; false for a released or unknown link. Asking changes nothing. */
  leaseHeld(id: string, token: string, now: number): Promise<boolean>;
  /** Records what the lease's last `detail` read: its sequence and hash (for `synced`). False when `token` does not hold the lease. */
  leaseRead(id: string, token: string, seq: number, contentHash: string, now: number): Promise<boolean>;
  /**
   * Records a check-in's receipt, and clears the editors whose last append is at or before the receipt's text: the
   * sequence `leaseRead` recorded when the receipt's hash is the one that read returned; else the link's sequence when
   * the receipt's hash is the stored `contentHash` and that is current (`contentSeq === seq`); else nobody. A pending link
   * gets its path once. A filed link with a target moves there when the receipt names the target: its path becomes the
   * target, which then names the link in place of the old path; a receipt that names its path instead keeps it there and
   * records the target as `unmoved`. Either way the target is gone. 'path-fixed', with nothing recorded, for a receipt
   * that names another path. 'leased' when `token` does not hold the lease.
   */
  synced(id: string, token: string, receipt: SyncReceipt, now: number): Promise<'ok' | 'leased' | 'path-fixed'>;
  /**
   * Releases when the lease holds, the link is synced at `contentHash` and its sequence is still `seq`. Deletes the
   * epoch's editors, presence, lease and tickets, and moves its document and log to {@link LiveStore.ended} until `now`
   * plus {@link LIVE_MERGE_MS} when the epoch stored anything beyond its seed (its log holds an update, or a compaction
   * ran) and the two take at most {@link LIVE_ENDED_MAX_BYTES}; otherwise it keeps nothing of the document. Keeps the
   * link record and its path.
   */
  release(id: string, token: string, expect: { seq: number; contentHash: string; }, now: number): Promise<'released' | 'leased' | 'not-synced' | 'changed'>;
  /**
   * Drops a pending link (no path) when the lease holds and its sequence is still `seq`: the record, its document, log,
   * editors, presence, lease, tickets and initial text are all deleted, and `link` answers null for it.
   */
  discard(id: string, token: string, expect: { seq: number; }, now: number): Promise<'discarded' | 'leased' | 'not-pending' | 'changed'>;
  /**
   * Sets, when the lease holds, the path rule a pending link (no path) is filed by, or with `{ target }` the path a filed
   * link moves to at its next check-in (null takes the target away), and ends the lease: its text, editors and presence
   * stay, and a target clears `unmoved`. 'not-pending' for a path rule on a filed link and 'not-filed' for a target on a
   * pending one, with nothing set and the lease ended all the same, so the call never holds a check-in off. 'leased',
   * with the lease kept, when `token` does not hold it.
   */
  retarget(id: string, token: string, change: string | RetargetTarget, now: number): Promise<'retargeted' | 'leased' | 'not-pending' | 'not-filed'>;
  /** Ends the link's lease when `token` holds it at `now`; anything else changes nothing. */
  unlease(id: string, token: string, now: number): Promise<void>;
  /** Replaces what `process` knows of the link's connected people: person key to last activity. None removes its entry. */
  presence(id: string, process: string, people: Record<string, number>, now: number): Promise<void>;
  /** The distinct people, over every process's entry written within {@link LIVE_PRESENCE_MS} of `now`, last active at or after `since`. */
  activePeople(id: string, since: number, now: number): Promise<number>;
  /** Keeps a ticket under its hash until `until`. */
  putTicket(hash: string, ticket: StoredTicket, until: number): Promise<void>;
  /** Takes a ticket, once; null for an unknown, taken or expired one. */
  takeTicket(hash: string, now: number): Promise<StoredTicket | null>;
}
