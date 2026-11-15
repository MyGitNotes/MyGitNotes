import { type BuiltinLiveNotes, type BuiltinLiveNotesOptions, createBuiltinLiveNotes } from './adapter.js';

/*
 * The built-in live editor (docs/specs/2026-11-15-builtin-live-editor): a second `LiveNotes`, whose notes are co-edited
 * in MyGitNotes' own editor as Yjs documents kept in a live store. An edition builds it with its own write credential:
 *
 *   const live = builtinLiveNotes({ covers, open, store: redisLiveStore({ url: process.env.REDIS_URL! }) });
 *   const app = createApp(base, { …, liveNotes: live });
 */

export { type BuiltinLiveLimits, type BuiltinLiveNotes, type BuiltinLiveNotesOptions } from './adapter.js';
export { memoryLiveStore } from './memory-store.js';
export { liveStorePrefix, redisLiveStore } from './redis-store.js';
export { type EditorRef, type LinkInit, type LiveStore, type StoredDocument, type StoredEditor, type StoredLink, type StoredTicket, type SyncReceipt } from './store.js';

/** The built-in live editor over a live store, for the repositories `covers` names. */
export function builtinLiveNotes(options: BuiltinLiveNotesOptions): BuiltinLiveNotes {
  return createBuiltinLiveNotes(options).liveNotes;
}
