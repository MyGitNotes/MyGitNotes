import type { RepositoryId } from '@mygitnotes/core';
import type * as Y from 'yjs';
import type { EditorRef, StoredLink } from './store.js';

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

/** The Yjs documents of the built-in editor's live links in one process (docs/specs/2026-11-15-builtin-live-editor §4). */
export interface LiveDocuments {
  /** The link's text exactly at a sequence of the store; null when its epoch is no longer the live one. */
  snapshot(link: StoredLink): Promise<LiveSnapshot | null>;
  /** The hash of the link's current text, for its row. */
  contentHash(link: StoredLink): Promise<string>;
  /**
   * A server-side write: `change` turns the current text into the new one, and the difference is appended to the store
   * before the document takes it. Writes of one document run one after another.
   */
  edit(link: StoredLink, editor: EditorRef | null, change: (current: string, hash: string) => string): Promise<{ text: string; hash: string; changed: boolean; }>;
  /** Loads the link's document from the store when this process does not hold it, and holds it. */
  open(link: StoredLink): Promise<OpenLiveDocument>;
  /**
   * Takes one Yjs update of a document this process holds, as a socket sends it: appended to the store for `editor`,
   * then applied. An update the document already holds is taken without an append.
   */
  accept(link: StoredLink, update: Uint8Array, editor: EditorRef): Promise<void>;
  /** Keeps a text that was handed out, so a write can name it as its base. */
  remember(link: StoredLink, text: { text: string; hash: string; }): void;
  /** A text handed out for the link's epoch, by hash. */
  recall(link: StoredLink, hash: string): string | undefined;
  /** Forgets the handed-out texts of the repository's links that are not among `live`. */
  forget(repository: RepositoryId, live: readonly StoredLink[]): void;
  /** Everyone left the link's document: it is compacted and let go, with the texts handed out. */
  unload(link: StoredLink): Promise<void>;
  /** The link's epoch ended: its document is let go without storing anything. */
  drop(link: StoredLink): Promise<void>;
  /** Compacts and lets go every document this process holds. */
  shutdown(): Promise<void>;
}
