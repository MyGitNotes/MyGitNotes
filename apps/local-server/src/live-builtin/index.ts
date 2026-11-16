import { type BuiltinLiveNotes, type BuiltinLiveNotesOptions, createBuiltinLiveNotes } from './adapter.js';

/*
 * The built-in live editor (docs/specs/2026-11-15-builtin-live-editor): a second `LiveNotes`, whose notes are co-edited
 * in MyGitNotes' own editor as Yjs documents kept in a live store. The community's own server builds it from the
 * environment (`live-env.ts`, `MYGITNOTES_LIVE_EDITOR=builtin`); an edition builds it with its own `open`:
 *
 *   const live = builtinLiveNotes({ covers, open, store: redisLiveStore({ url: process.env.REDIS_URL! }) });
 *   const app = createApp(base, { …, liveNotes: live });
 *   const server = app.listen(port, host);
 *   server.on('upgrade', (req, socket, head) => { if (!live.upgrade(req, socket, head)) socket.destroy(); });
 *   process.once('SIGTERM', async () => { await live.shutdown(); server.close(); });
 *
 * A server that already handles upgrades asks each handler in turn.
 */

export { type BuiltinLiveLimits, type BuiltinLiveNotes, type BuiltinLiveNotesOptions } from './adapter.js';
export { memoryLiveStore } from './memory-store.js';
export { liveStorePrefix, redisLiveStore } from './redis-store.js';
export { type EditorRef, type LinkInit, type LiveStore, type MergeRecord, type StoredDocument, type StoredEditor, type StoredLink, type StoredTicket, type SyncReceipt } from './store.js';

/** The built-in live editor over a live store, for the repositories `covers` names. */
export function builtinLiveNotes(options: BuiltinLiveNotesOptions): BuiltinLiveNotes {
  return createBuiltinLiveNotes(options).liveNotes;
}
