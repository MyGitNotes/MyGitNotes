import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CloudOff, Users } from 'lucide-react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import type { Extension } from '@codemirror/state';
import type { LiveBuiltinEditorInfo } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { checkInLive, isMergeConflict, isNotLive, type LiveCheckInAnswer, type LiveCheckoutView, mergeLive, newMergeId, socketTicket } from '../../lib/live-api.js';
import { holdClaim, takeClaim } from '../../lib/live-claims.js';
import { noteLiveSocketClosing } from '../../lib/live-closing.js';
import { liveOwnerClaim, relocateUnsynced, unsyncedKey, unsyncedLiveStore, type UnsyncedLiveText, unsyncedOf } from '../../lib/live-unsynced.js';
import { isNetworkFailure } from '../../lib/api.js';
import { onReachable } from '../../lib/live-reachability.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { LiveMarkdownEditor, type LiveMarkdownHandle } from '../LiveMarkdownEditor.js';
import type { MarkdownEditorMode } from '../MarkdownEditor.js';
import { SplitView } from '../SplitView.js';
import { CollabSourceEditor } from './CollabSourceEditor.js';
import { discardDraft, keptReason } from './live-drafts.js';
import { LiveProvider } from './live-provider.js';
import { readLiveFrontmatter } from './live-frontmatter.js';
import { notCheckedInText, stillOpenText } from './useLiveEdit.js';
import './live-editor.css';

export interface LiveCollabEditorProps {
  checkout: LiveCheckoutView;
  /** The repository's built-in editor; `discard` where it can discard a pending note (「捨棄草稿」). */
  editor: LiveBuiltinEditorInfo & { discard?: true; };
  /** Reads the note again: the text was saved, the note was checked in or moved elsewhere, or the editor was closed. */
  onRefetch: () => void;
  /** Leaves the live editor for the note's read view. */
  onClose: () => void;
  /** The note was checked in: by this page (`answer`), or by someone else, which the server tells the tab. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
  /** The note stopped being live while the tab still offers its unsaved text: the app reads the live state again now. */
  onReleased?: () => void;
  /** The pending note was discarded: by 「捨棄草稿」, or by a check-in that found the draft empty. */
  onDiscarded?: () => void;
  /** The note's title, which names a downloaded copy. */
  title?: string;
  /** The repository's draft scope, which keys the typing this browser keeps unsynced. */
  scope?: string;
  /** What this tab kept could not be merged into the note: the app keeps it as a conflict draft (collab-first A3.1), or answers false when the note already has one. */
  onMergeConflict?: (mine: string) => boolean;
  /** Whether the editor holds typing the server has not stored, or kept typing it has not merged yet: a file action waits for it (cf16-F003). */
  onUnsavedChange?: (unsaved: boolean) => void;
  /**
   * The session's shared text once its document synced, and whether metadata may be written now (connected and synced,
   * collab-frontmatter Q2); null while no document is shown. The note's document panel and row read and write it.
   */
  onLive?: (live: LiveSession | null) => void;
  /** The collab Markdown editor, for the document panel's find and outline. */
  editorRef?: Ref<LiveMarkdownHandle>;
  /** The note is a slide deck: its editor labels slides as the direct editor does. */
  slides?: boolean;
  showLineNumbers?: boolean;
  /** Live, Source (the whole text, frontmatter included) or Split (Source beside the body's preview), as the direct editor's modes. */
  mode?: MarkdownEditorMode;
  /** The live body, which Split previews. */
  body?: string;
  /** Beside the editor in its body: the note's document panel. */
  children?: ReactNode;
}

/** A running collab session as the note's panel sees it. */
export interface LiveSession {
  text: Y.Text;
  online: boolean;
}

/** Why the server refused the tab's document; `other` for any reason this tab does not know. */
type RefusedReason = 'too-large' | 'busy' | 'other';

/**
 * How a session ended under the tab: the note was checked in, the server refused it, a call failed, or the person ended
 * it (kept a draft they meant to discard) with the note still open.
 */
type Ending = { kind: 'released'; } | { kind: 'refused'; reason: RefusedReason; } | { kind: 'failed'; message: string; } | { kind: 'kept'; };

type Phase =
  | { kind: 'open'; }
  | { kind: 'checking'; }
  | { kind: 'discarding'; }
  /** 「捨棄這份草稿？」 in the editor's own notice, for a draft someone typed in. */
  | { kind: 'confirm-discard'; question: string; }
  | { kind: 'released'; }
  /** The session ended while this tab held typing the server never acknowledged: its text, offered to copy or download. */
  | { kind: 'lost'; text: string; ending: Ending; }
  | { kind: 'refused'; reason: RefusedReason; }
  | { kind: 'discarded'; }
  /** The note stayed open (a check-in that did not release it, a kept draft) or a call failed: the person may go back. */
  | { kind: 'notice'; message: string; tone: 'status' | 'alert'; };

/** The socket as the provider reports it. */
interface Connection {
  status: 'connecting' | 'connected' | 'disconnected';
  /** The socket's document synced since it last connected. */
  synced: boolean;
  /** The document synced once in this session: the editor shows, and a later loss of the socket reads as offline. */
  everSynced?: boolean;
  /** The server closed the socket for a new ticket (`RENEW_CODE`) and the tab is connecting again: not offline. */
  renewing?: boolean;
  unsynced: number;
  /** The session's first ticket could not be had for want of a connection: the tab waits offline and asks again once it is back. */
  unreachable?: boolean;
  /** The tab typed something the server has not stored: what the prompts about unsaved text ask about (`unsynced` also counts a connect's own sync step). */
  dirty?: boolean;
  people: number;
}
const START: Connection = { status: 'connecting', synced: false, unsynced: 0, people: 1 };
/** How long nothing may be unsaved before the bar says 已儲存: each keystroke is stored within a few milliseconds. */
const SETTLE_MS = 300;
/** How long a pending step nobody typed (a connect's own sync step) may last before the bar says 未儲存 rather than connecting. */
const UNTYPED_PENDING_MS = 1500;
/** The close of a socket the server kept open for its time (`LIVE_RENEW_CODE` of the server's socket.ts): the provider connects again with a fresh ticket. */
const RENEW_CODE = 4000;

const REFUSALS: Record<RefusedReason, TranslationKey> = { 'too-large': 'live.tooLargeLive', busy: 'live.busy', other: 'live.socketRefused' };

/** The socket of the app's own origin, as the page reached it: `wss:` under https. */
const socketUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live/socket`;

/** How long typing waits before the browser keeps it: each keystroke is stored on the server within a few milliseconds. */
const KEEP_MS = 500;
/** The origin of a kept update applied to a new session's document: neither the tab's own typing nor the server's. */
const RESTORED = Symbol('restored');

/** Kept typing shown read-only while offline: the body alone, numbered with its file lines, as the collab editor shows it. */
function KeptText({ text, path, notebookId, label }: { text: string; path: string; notebookId: string; label: string; }) {
  const { bodyStart, lineOffset } = readLiveFrontmatter(text);
  return <LiveMarkdownEditor content={text.slice(bodyStart)} lineNumberOffset={lineOffset} notePath={path} notebookId={notebookId} readOnly onChange={() => {}} ariaLabel={label} />;
}

/** A file name for the downloaded copy of the tab's text. */
const downloadName = (title: string | undefined, path: string) => `${(title || path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'note').replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').trim() || 'note'}.md`;

/**
 * The built-in live editor of a checked-out note (docs/specs/2026-11-15-builtin-live-editor §8.2): the note is co-edited
 * here, in the app's own Markdown editor, over a Yjs document on the app's socket. Each connect asks for a single-use
 * ticket; the editor mounts once the document first synced. The bar says who is editing and whether every keystroke is
 * stored (已儲存 only once the server acknowledged it), and offers 「立即簽回」, 「捨棄草稿」 on a pending note, and 「關閉」.
 * A note checked in elsewhere ends the session: a tab with nothing unsaved reads it as checked in, one with unsaved typing
 * merges its text into the note (collab-first A3.1), and its document is never merged into the reopened note. Every
 * other end of a session (a refusal, a ticket that cannot be had) offers unsaved typing to copy or download.
 *
 * Typing the server has not stored is kept in this browser ({@link unsyncedLiveStore}) until the server stored it: the
 * next session of the note, after a reload or on the way back to the note, applies it to its document before the
 * provider connects when it opens the same document, and merges it into the note (`/api/live/merge`, on the text it was
 * typed on) when that document ended; offline meanwhile, it shows the kept text read-only. A conflicting merge goes to
 * `onMergeConflict`; a live editor that cannot merge leaves the copy or download.
 */
export function LiveCollabEditor({ checkout, editor, onRefetch, onClose, onCheckedIn, onReleased, onDiscarded, title, scope = '', onMergeConflict, onUnsavedChange, onLive, editorRef, slides, showLineNumbers, mode = 'live', body = '', children }: LiveCollabEditorProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  // Each session is one document and one provider; going back to the editor after a check-in that left it open starts a new one.
  const [session, setSession] = useState(1);
  const [connection, setConnection] = useState<Connection>(START);
  const [collab, setCollab] = useState<{ extension: Extension; text: string; shared: Y.Text; awareness: Awareness; undoManager: Y.UndoManager; } | null>(null);
  /** The Source editor's scroller, which Split keeps in step with its preview. */
  const sourceScroller = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);
  /** 「關閉」 asked while typing is unsaved: the editor stays open under the question. */
  const [leaving, setLeaving] = useState(false);
  /** Kept typing the session cannot sync or merge yet for want of a server: shown read-only, offline. */
  const [kept, setKept] = useState<string | null>(null);
  /** The session merges kept typing into the note before it opens it. */
  const [merging, setMerging] = useState(false);
  /** The store holds typing of this session that the server has not stored yet. */
  const [holding, setHolding] = useState(false);
  const live = phase.kind === 'open';
  const latest = useRef({ checkout, onRefetch, onCheckedIn, onReleased, onMergeConflict, connection, t, title });
  useEffect(() => {
    latest.current = { checkout, onRefetch, onCheckedIn, onReleased, onMergeConflict, connection, t, title };
  });
  /** Kept typing a session that just ended hands to the next one, which merges it into the note. */
  const carried = useRef<{ entry: UnsyncedLiveText; release: () => void; } | null>(null);
  /** Where the typing this session would leave is kept: its own entry, or the one whose text it offers to copy. */
  const keptKeys = useRef<string[]>([]);
  // A new session starts from nothing: no connection yet, and the editor mounts again once its document synced.
  const reopen = () => {
    setConnection(START);
    setCollab(null);
    setCopied(false);
    setLeaving(false);
    setKept(null);
    setMerging(false);
    setHolding(false);
    setSession(current => current + 1);
    setPhase({ kind: 'open' });
  };
  /** Ends the running session at once: the provider is destroyed (its socket closes), and its document read first. */
  const stopRef = useRef<() => string>(() => '');
  /** The running session's text. */
  const readRef = useRef<() => string>(() => '');
  /** Takes the running session to the path its note lies at now: another person moved or renamed it (§20.4), and the page followed it. */
  const followRef = useRef<(path: string) => void>(() => {});

  useEffect(() => {
    if (!live) return;
    let stopped = false, provider: LiveProvider | undefined;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const text = doc.getText('content');
    const { notebookId } = latest.current.checkout;
    // The path the note lies at: where the session asks for its tickets and keeps its typing. It follows the note when the
    // page follows it elsewhere, and the session goes on in the same document.
    let path = latest.current.checkout.path;
    const store = unsyncedLiveStore();
    // The session keeps its typing under an owner of its own, held while it runs, so no other tab or editor of the note
    // overwrites it or takes it (cf16-F004).
    const owner = newMergeId();
    let key = unsyncedKey(scope, notebookId, path, owner);
    const releaseOwner = holdClaim(liveOwnerClaim(owner));
    keptKeys.current = [key];
    /** What sessions that ended kept of the note, taken by this one until it merged them or holds them as its own. */
    let taken: { entry: UnsyncedLiveText; release: () => void; }[] = [];
    const letGo = (items: typeof taken) => {
      for (const item of items) item.release();
    };
    /** Takes every entry of the note whose session ended: a closed or crashed tab's, or an editor's that unmounted. */
    const adopt = async () => {
      letGo(taken);
      taken = [];
      for (const entry of await unsyncedOf(store, scope, notebookId, path).catch(() => [])) {
        if (entry.owner === owner) continue;
        const release = await takeClaim(liveOwnerClaim(entry.owner));
        if (release) taken.push({ entry, release });
      }
    };
    /** The socket as the provider last reported it, which `online` reads: a connect does nothing while it counts itself connected. */
    let status: Connection['status'] = 'connecting', synced = false, unsynced = 0, dirty = false;
    /** The document the session opened, and the text at its last full sync, which a merge of kept typing takes as its base. */
    let opened = '', base = '';
    /** Whether the store holds this session's typing, and the merge id it is kept under. */
    let keeping = false, mergeId = newMergeId();
    /** The session's typing and owner went to the next session, which merges them. */
    let handedOver = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keptEntry = (): UnsyncedLiveText => ({ key, owner, scope, notebookId, path, ...(latest.current.title ? { title: latest.current.title } : {}), document: opened, update: Y.encodeStateAsUpdate(doc), text: text.toString(), baseText: base, mergeId, savedAt: Date.now() });
    /** Keeps the typing the server has not stored in the browser. */
    const keep = (): Promise<void> => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || !opened || !dirty) return Promise.resolve();
      keeping = true;
      setHolding(true);
      return store.put(keptEntry()).catch(() => {});
    };
    /** Everything is stored on the server: the text is the next merge's base, and the browser keeps nothing. */
    const settle = () => {
      if (!synced || unsynced > 0 || dirty) return;
      base = text.toString();
      clearTimeout(timer);
      timer = undefined;
      if (!keeping) return;
      keeping = false;
      setHolding(false);
      mergeId = newMergeId();
      void store.delete(key).catch(() => {});
    };
    // The tab's own typing is kept a moment after it, unless the server stored it by then; the server's updates move the base.
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (stopped || origin === RESTORED) return;
      if (origin === provider) return settle();
      clearTimeout(timer);
      timer = setTimeout(keep, KEEP_MS);
    });
    const stop = () => {
      const content = text.toString();
      if (stopped) return content;
      // The owner is let go only once its last typing is kept, so a session that takes it finds all of it; the session the
      // typing was carried to holds it instead.
      void (dirty ? keep() : Promise.resolve()).finally(() => (handedOver ? undefined : releaseOwner()));
      letGo(taken);
      taken = [];
      clearTimeout(timer);
      stopped = true;
      // Its socket closes after this returns: a check-in of the note waits for that (VQ P1-a).
      noteLiveSocketClosing(notebookId, path, provider?.configuration.websocketProvider?.webSocket);
      provider?.destroy();
      awareness.destroy();
      doc.destroy();
      return content;
    };
    stopRef.current = stop;
    readRef.current = () => text.toString();
    followRef.current = to => {
      if (stopped || to === path) return;
      const from = key;
      path = to;
      key = unsyncedKey(scope, notebookId, to, owner);
      keptKeys.current = [key];
      // Typing kept under the path the note left goes with it, so a later session where it lies finds it.
      if (keeping) void store.move(keptEntry(), from).catch(() => {});
    };
    /** Ends the session: the tab's document is dropped, and its unsaved text merged into the note or offered, whatever ended it. */
    const end = (ending: Ending) => {
      if (stopped) return;
      const unsaved = latest.current.connection.dirty;
      if (unsaved && ending.kind === 'released' && opened) {
        // The next session merges it into the note, which its merge checks out again; the lists read the live state again now.
        carried.current = { entry: keptEntry(), release: releaseOwner };
        handedOver = true;
        stop();
        latest.current.onReleased?.();
        return reopen();
      }
      const content = stop();
      if (unsaved) {
        // The lists stop saying 編輯中 now, whether the notice is left by its 關閉 or by closing the view.
        if (ending.kind === 'released') latest.current.onReleased?.();
        return setPhase({ kind: 'lost', text: content, ending });
      }
      if (ending.kind === 'refused') return setPhase({ kind: 'refused', reason: ending.reason });
      if (ending.kind === 'failed') return setPhase({ kind: 'notice', message: ending.message, tone: 'alert' });
      setPhase({ kind: 'released' });
      latest.current.onRefetch();
      latest.current.onCheckedIn?.();
    };
    /** The note was checked in or discarded elsewhere. */
    const released = () => end({ kind: 'released' });
    const failed = (message: string) => end({ kind: 'failed', message });
    /** Set while the session waits for the connection: going online starts it again. */
    let retry: (() => void) | null = null;
    /** The browser came back online before the socket's close landed: the close connects again. */
    let reconnect = false;
    /** Waits offline for the connection, showing the kept typing meanwhile. */
    const waitOnline = (shown: UnsyncedLiveText | undefined) => {
      retry = () => void begin();
      setMerging(false);
      if (shown) setKept(shown.text);
      setConnection(current => ({ ...current, status: 'disconnected', unreachable: true }));
    };
    /**
     * Merges typing a session kept into the note, whose document it was typed in ended: on the text it was typed on, so
     * that it lands as an edit. Merged or kept as a conflict draft, the session opens the note as it is now.
     */
    const mergeKept = async (entry: UnsyncedLiveText, release: () => void) => {
      setMerging(true);
      try {
        await mergeLive({ notebookId, path, base: entry.baseText, text: entry.text, mergeId: entry.mergeId, typedIn: { document: entry.document, update: entry.update } });
      } catch (error) {
        // A conflict becomes the note's conflict draft even when the editor closed meanwhile (a release remounts it): the
        // typing is let go as if merged, and the editor that opens next shows the notice. Anything else stays kept.
        // Only a handler that says it staged the draft lets the typing go: without one, nothing holds it but this store (cfx-F004).
        const staged = isMergeConflict(error) && latest.current.onMergeConflict?.(entry.text) === true;
        if (!staged) {
          // A later session takes it again.
          if (stopped) return release();
          if (isNetworkFailure(error)) {
            // Held until the session tries again, or ends.
            taken.push({ entry, release });
            return waitOnline(entry);
          }
          // A live editor that cannot merge, a note that is gone, or a conflict draft that already waits for the person: the
          // text is offered to copy or download, and the entry stays until the person leaves it.
          taken.push({ entry, release });
          keptKeys.current = [entry.key];
          setMerging(false);
          const ending: Ending = isMergeConflict(error) ? { kind: 'failed', message: latest.current.t('live.conflictPending') } : isNotLive(error) ? { kind: 'released' } : { kind: 'failed', message: (error as Error).message };
          return setPhase({ kind: 'lost', text: entry.text, ending });
        }
      }
      await store.delete(entry.key).catch(() => {});
      release();
      if (stopped) return;
      setMerging(false);
      setKept(null);
      latest.current.onRefetch();
      void begin();
    };
    const begin = async () => {
      // Typing the last session kept when its note was released is merged at once: its document ended.
      const ended = carried.current;
      carried.current = null;
      if (ended) return void mergeKept(ended.entry, ended.release);
      // What sessions that ended kept of the note: one at a time merged when its document ended, all synced when it is this one.
      await adopt();
      if (stopped) return letGo(taken.splice(0));
      /** Merges the first entry of a document that ended, letting go of the rest, which the next round takes again. */
      const mergeFirst = (entries: typeof taken) => {
        const [next, ...rest] = entries;
        taken = taken.filter(item => item !== next && !rest.includes(item));
        letGo(rest);
        void mergeKept(next!.entry, next!.release);
      };
      let first: { ticket: string; document: string; };
      try {
        first = await socketTicket(notebookId, path);
      } catch (error) {
        if (stopped) return;
        if (isNotLive(error)) return taken.length ? mergeFirst(taken) : released();
        // No server reached, nothing ended: the tab is offline until the browser is back online.
        if (isNetworkFailure(error)) return waitOnline(taken[taken.length - 1]?.entry);
        return failed((error as Error).message);
      }
      if (stopped) return;
      // Kept typing of a document that ended is merged into the note; of the same document, Yjs syncs what the server lacks.
      const endedEntries = taken.filter(item => item.entry.document !== first.document);
      if (endedEntries.length) return mergeFirst(endedEntries);
      const same = taken.splice(0);
      opened = first.document;
      if (same.length) {
        for (const { entry } of same) Y.applyUpdate(doc, entry.update, RESTORED);
        if (!keeping) base = same[0]!.entry.baseText;
        keeping = true;
        setHolding(true);
        // Kept as this session's own before the others go, so none of it is ever out of the store.
        await store.put(keptEntry()).catch(() => {});
        for (const { entry } of same) await store.delete(entry.key).catch(() => {});
        letGo(same);
        if (stopped) return;
      }
      setKept(null);
      setConnection(current => (current.unreachable ? { ...current, status: 'connecting', unreachable: false } : current));
      let held: string | null = first.ticket;
      /** A fresh ticket for every connect; one that names another epoch's document means the note was checked in and reopened. */
      const token = async () => {
        if (held) {
          const given = held;
          held = null;
          return given;
        }
        try {
          const next = await socketTicket(notebookId, path);
          if (next.document === first.document) return next.ticket;
        } catch (error) {
          if (!isNotLive(error)) throw error;
        }
        released();
        return '';
      };
      provider = new LiveProvider({
        url: socketUrl(),
        name: first.document,
        document: doc,
        awareness,
        token,
        // The server keeps a state only past the clock it last saw of this client: 0 at first, the same after a reconnect.
        // Setting it again moves the clock, so the others count this tab from its connect, as the server's activeEditors do.
        onAuthenticated: () => awareness.setLocalState({ ...awareness.getLocalState() }),
        // A socket that is not connected has no synced document: it syncs again once it reconnects. A socket that closed
        // after the browser came back online connects again now: the provider ignored a connect while it was still open.
        onStatus: ({ status: next }) => {
          status = next as Connection['status'];
          if (status !== 'connected') synced = false;
          if (status === 'disconnected' && reconnect) {
            reconnect = false;
            if (navigator.onLine) void provider?.connect();
          }
          setConnection(current => ({ ...current, status: status, synced: status === 'connected' && current.synced }));
        },
        // After a close for a new ticket the provider connects again as usual, which reads as connecting; any other close, a failed retry included, reads as offline.
        onClose: ({ event }) => setConnection(current => ({ ...current, renewing: event.code === RENEW_CODE })),
        onSynced: ({ state }) => {
          if (!state || stopped) return;
          synced = true;
          // Synced with nothing typed, the document holds the server's text alone: the base, though the connect's own step may wait on its acknowledgement.
          if (!keeping && !dirty) base = text.toString();
          settle();
          setConnection(current => ({ ...current, synced: true, everSynced: true, renewing: false }));
          setCollab(current => {
            if (current) return current;
            const undoManager = new Y.UndoManager(text);
            return { extension: yCollab(text, awareness, { undoManager }), text: text.toString(), shared: text, awareness, undoManager };
          });
        },
        onUnsyncedChanges: ({ number }) => {
          unsynced = number;
          settle();
          setConnection(current => ({ ...current, unsynced: number }));
        },
        onDirty: ({ dirty: next }) => {
          dirty = next;
          settle();
          setConnection(current => ({ ...current, dirty: next }));
        },
        // The server writes each person's name; this tab counts itself once, and every other name once.
        onAwarenessChange: ({ states }) => setConnection(current => ({ ...current, people: 1 + new Set(states.filter(state => state.clientId !== doc.clientID && typeof state.user?.name === 'string').map(state => state.user.name as string)).size })),
        onStateless: ({ payload }) => {
          let message: { type?: unknown; reason?: unknown; };
          try {
            message = JSON.parse(payload);
          } catch {
            return;
          }
          if (message.type === 'released') released();
          // Someone moved or renamed the note (§20.4): it is read again, which says where it lies, and the page follows it there.
          else if (message.type === 'moved') latest.current.onRefetch();
          else if (message.type === 'refused') end({ kind: 'refused', reason: message.reason === 'too-large' || message.reason === 'busy' ? message.reason : 'other' });
        },
        // A refused ticket is not retried: the note was checked in meanwhile, or the server refused this tab.
        onAuthenticationFailed: () => {
          void socketTicket(notebookId, path).then(next => next.document === first.document ? failed(latest.current.t('live.socketRefused')) : released(), error => isNotLive(error) ? released() : failed((error as Error).message));
        },
      });
    };
    void begin();
    // The browser knows it is offline long before the socket's timeout does, and back online before its next retry.
    const offline = () => {
      if (stopped) return;
      reconnect = false;
      provider?.disconnect();
      setConnection(current => ({ ...current, status: 'disconnected', synced: false, renewing: false }));
    };
    const online = () => {
      if (stopped) return;
      const again = retry;
      retry = null;
      if (again) again();
      else if (status === 'connected') reconnect = true;
      else void provider?.connect();
    };
    // A page that goes away keeps its unsaved typing at once, not a moment later.
    const hide = () => {
      if (dirty) keep();
    };
    window.addEventListener('offline', offline);
    // Back online, a live request that got through, or the page shown again: kept typing waiting for the server is tried again.
    const stopReachable = onReachable(online);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('offline', offline);
      stopReachable();
      window.removeEventListener('pagehide', hide);
      // Unmounted under a running session (the person went to another note or pane): its unsaved typing stays kept for the next session.
      stop();
    };
  }, [live, session, scope]);
  // The note followed to where it moved goes on in the running session: no new document, socket or editor.
  useEffect(() => followRef.current(checkout.path), [checkout.path]);

  // 已儲存 waits until nothing was unsaved for SETTLE_MS, so typing does not flicker it, or 立即簽回 with it.
  const [settled, setSettled] = useState(true);
  if (connection.unsynced > 0 && settled) setSettled(false);
  useEffect(() => {
    if (connection.unsynced > 0 || settled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [connection.unsynced, settled]);

  // Not yet 已儲存. Typing says 未儲存 at once and until it settled; a pending step nobody typed (a reconnect's sync step)
  // says so only once it lasts, so a reconnect does not flash 未儲存, and reads as connecting until then.
  const pending = connection.unsynced > 0 || !settled;
  const [typed, setTyped] = useState(false);
  if (connection.dirty && !typed) setTyped(true);
  if (!pending && !connection.dirty && typed) setTyped(false);
  const [lasting, setLasting] = useState(false);
  if (!pending && lasting) setLasting(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setLasting(true), UNTYPED_PENDING_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  // A move, rename or deletion from the note's editor waits until nothing of this tab's typing is out of the server.
  const holdsTyping = live && (Boolean(connection.dirty) || holding || merging || kept !== null);
  const unsavedChange = useRef(onUnsavedChange);
  useEffect(() => {
    unsavedChange.current = onUnsavedChange;
  });
  useEffect(() => {
    unsavedChange.current?.(holdsTyping);
  }, [holdsTyping]);
  useEffect(() => () => unsavedChange.current?.(false), []);

  // A view built again (another mode, another frame) starts from the shared text as it is now: the binding assumes the
  // view's text equals it, and typing in a view built on the first sync's text would land at the wrong places.
  const liveBinding = useMemo(() =>
    collab && {
      extension: collab.extension,
      get text() {
        return collab.shared.toString();
      },
    }, [collab]);
  // The panel writes metadata only while the document is connected and synced (Q2).
  const shared = live && collab ? collab.shared : null;
  const writable = connection.status === 'connected' && connection.synced;
  const liveReport = useRef(onLive);
  useEffect(() => {
    liveReport.current = onLive;
  });
  useEffect(() => {
    liveReport.current?.(shared ? { text: shared, online: writable } : null);
  }, [shared, writable]);
  useEffect(() => () => liveReport.current?.(null), []);

  // Typing the server has not stored yet is lost with the page.
  const unsaved = live && !!connection.dirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const checkIn = async () => {
    // This tab counts as an active editor until its socket closes, so it goes before the check-in releases the note.
    stopRef.current();
    flushSync(() => setPhase({ kind: 'checking' }));
    try {
      const answer = await checkInLive(checkout.notebookId, checkout.path);
      if (answer.discarded) setPhase({ kind: 'discarded' });
      else {
        setPhase(answer.released ? { kind: 'released' } : { kind: 'notice', tone: 'status', message: answer.reason === 'active' && answer.committed ? stillOpenText(t, answer.activeEditors ?? 1) : notCheckedInText(t, answer.reason) });
        if (answer.committed || answer.released) onCheckedIn?.(answer);
      }
    } catch (error) {
      setPhase({ kind: 'notice', tone: 'alert', message: isNetworkFailure(error) ? t('live.checkInUnreachable') : (error as Error).message });
    }
    onRefetch();
  };
  /** Answers the editor's 「捨棄這份草稿？」. */
  const answerDiscard = useRef<(yes: boolean) => void>(() => {});
  const askDiscard = (question: string) =>
    new Promise<boolean>(resolve => {
      answerDiscard.current = yes => {
        if (yes) setPhase({ kind: 'discarding' });
        resolve(yes);
      };
      setPhase({ kind: 'confirm-discard', question });
    });
  const discard = async () => {
    // The draft is discarded whole, the tab's unsaved typing with it; a draft that stays offers that typing first.
    const dirty = connection.dirty;
    const content = stopRef.current();
    const stayed = (ending: Ending, fallback: () => void) => (dirty ? setPhase({ kind: 'lost', text: content, ending }) : fallback());
    flushSync(() => setPhase({ kind: 'discarding' }));
    try {
      const answer = await discardDraft(checkout.notebookId, checkout.path, t, askDiscard);
      if (!answer) return stayed({ kind: 'kept' }, reopen);
      if (answer.discarded) {
        // The draft is gone, and with it whatever any editor of it kept.
        void relocateUnsynced(unsyncedLiveStore(), scope, checkout.notebookId, checkout.path, null).catch(() => {});
        onRefetch();
        onDiscarded?.();
        return;
      }
      const message = keptReason(answer, t);
      stayed({ kind: 'failed', message }, () => setPhase({ kind: 'notice', tone: 'status', message }));
    } catch (error) {
      const message = isNetworkFailure(error) ? t('live.discardUnreachable') : (error as Error).message;
      stayed({ kind: 'failed', message }, () => setPhase({ kind: 'notice', tone: 'alert', message }));
    }
  };
  /** 「關閉」: asks first, in the editor, while typing is unsaved. */
  const close = () => {
    if (live && connection.dirty) return setLeaving(true);
    closeNow();
  };
  const closeNow = () => {
    setLeaving(false);
    stopRef.current();
    onRefetch();
    if (phase.kind === 'discarded') (onDiscarded ?? onClose)();
    else onClose();
  };
  /** The typing this browser keeps for the note: the person took it from the notice, or the draft is gone. */
  const forgetKept = () => {
    for (const kept of keptKeys.current) void unsyncedLiveStore().delete(kept).catch(() => {});
  };
  /** Leaves the lost text: for the read view of the checked-in note, or as 「關閉」 does when the note is still live. */
  const leaveLost = (ending: Ending) => {
    forgetKept();
    if (ending.kind !== 'released') return closeNow();
    onRefetch();
    onCheckedIn?.();
  };
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };
  const download = (text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName(title, checkout.path);
    link.click();
    URL.revokeObjectURL(url);
  };

  // Before the first sync the tab is connecting; afterwards a socket that is not connected is offline, retries included,
  // unless the server closed it for a new ticket, and one connected again is connecting until its document synced again.
  const stateKey: TranslationKey = connection.unreachable ? 'live.offline' : !connection.everSynced ? 'live.connecting' : connection.status !== 'connected' && !connection.renewing ? 'live.offline' : !connection.synced ? 'live.connecting' : !pending ? 'live.saved' : typed || connection.dirty || lasting ? 'live.unsaved' : 'live.connecting';
  const canCheckIn = connection.status === 'connected' && connection.synced && connection.unsynced === 0 && settled;
  const discardable = Boolean(checkout.pending && editor.discard) && (live || phase.kind === 'notice');
  // Discarding asks the server: a live tab offers it only connected, with its document synced, so its unsaved typing can be offered when the draft stays.
  const discardOffline = live && !(connection.status === 'connected' && connection.synced);
  return (
    <div className='live-editor-frame live-collab'>
      <div className='live-editor-bar' role='toolbar' aria-label={t('live.toolbar')}>
        {live && (
          <>
            <span className='live-editor-state live-editor-users'>
              <Users size={14} aria-hidden='true' />
              {t('live.editors', { count: connection.people })}
            </span>
            <span className='live-editor-state' data-tone={stateKey === 'live.saved' ? 'ok' : stateKey === 'live.offline' ? 'warn' : undefined}>{stateKey === 'live.offline' && <CloudOff size={14} aria-hidden='true' />}{t(stateKey)}</span>
          </>
        )}
        <div className='live-editor-actions'>{discardable && <Button size='small' variant='danger' title={t(discardOffline ? 'live.discardOffline' : 'live.discardHint')} disabled={discardOffline} onClick={() => void discard()}>{t('live.discard')}</Button>}{live && <Button size='small' variant='primary' title={t('live.checkInHint')} disabled={!canCheckIn} onClick={() => void checkIn()}>{t('live.checkIn')}</Button>}{phase.kind !== 'lost' && <Button size='small' disabled={phase.kind === 'checking' || phase.kind === 'discarding'} onClick={close}>{t('common.close')}</Button>}</div>
      </div>
      {live && leaving && (
        <div role='alertdialog' aria-label={t('common.close')} className='live-editor-notice'>
          <p>{t('live.leaveUnsaved')}</p>
          <div className='live-editor-notice-actions'>
            <Button size='small' variant='primary' onClick={() => void copy(readRef.current())}>{t(copied ? 'live.copied' : 'live.copyMine')}</Button>
            <Button size='small' onClick={() => download(readRef.current())}>{t('live.download')}</Button>
            <Button size='small' variant='danger' onClick={closeNow}>{t('live.closeAnyway')}</Button>
            <Button size='small' onClick={() => setLeaving(false)}>{t('live.backToEditor')}</Button>
          </div>
        </div>
      )}
      {live && merging && <LoadingStatus className='live-editor-notice'>{t('live.merging')}</LoadingStatus>}
      {live && !collab && kept !== null && (
        <div className='note-editor-body live-collab-body'>
          <p role='status' className='live-editor-notice'>{t('live.keptOffline')}</p>
          <KeptText text={kept} path={checkout.path} notebookId={checkout.notebookId} label={t('live.toolbar')} />
        </div>
      )}
      {live && collab && <div className='note-editor-body live-collab-body'>{mode === 'live' ? <LiveMarkdownEditor ref={editorRef} content={collab.text} collab={liveBinding ?? undefined} notePath={checkout.path} notebookId={checkout.notebookId} readOnly={false} onChange={() => {}} ariaLabel={t('live.toolbar')} slides={slides} showLineNumbers={showLineNumbers} /> : mode === 'split' ? <SplitView source={<CollabSourceEditor ref={editorRef} text={collab.shared} awareness={collab.awareness} undoManager={collab.undoManager} showLineNumbers={showLineNumbers} ariaLabel={t('live.source')} scroller={sourceScroller} />} sourceScroller={sourceScroller} content={body} path={checkout.path} notebookId={checkout.notebookId} slides={slides} /> : <CollabSourceEditor ref={editorRef} text={collab.shared} awareness={collab.awareness} undoManager={collab.undoManager} showLineNumbers={showLineNumbers} ariaLabel={t('live.source')} />}{children}</div>}
      {phase.kind === 'checking' && <LoadingStatus className='live-editor-notice'>{t('live.checkingIn')}</LoadingStatus>}
      {phase.kind === 'discarding' && <LoadingStatus className='live-editor-notice'>{t('live.discarding')}</LoadingStatus>}
      {phase.kind === 'released' && <p role='status' className='live-editor-notice'>{t('live.checkedIn')}</p>}
      {phase.kind === 'confirm-discard' && (
        <div role='alertdialog' aria-label={t('live.discard')} className='live-editor-notice'>
          <p>{phase.question}</p>
          <div className='live-editor-notice-actions'>
            <Button size='small' variant='danger' onClick={() => answerDiscard.current(true)}>{t('live.discard')}</Button>
            <Button size='small' onClick={() => answerDiscard.current(false)}>{t('live.backToEditor')}</Button>
          </div>
        </div>
      )}
      {phase.kind === 'discarded' && <p role='status' className='live-editor-notice'>{t('live.discardedEmpty')}</p>}
      {phase.kind === 'refused' && <p role='alert' className='live-editor-notice'>{t(REFUSALS[phase.reason])}</p>}
      {phase.kind === 'lost' && (
        <div role='alert' className='live-editor-notice'>
          {phase.ending.kind === 'released' ? <p>{t('live.releasedOffline')}</p> : (
            <>
              {phase.ending.kind !== 'kept' && <p>{phase.ending.kind === 'refused' ? t(REFUSALS[phase.ending.reason]) : phase.ending.message}</p>}
              <p>{t('live.unsavedMine')}</p>
            </>
          )}
          <div className='live-editor-notice-actions'>
            <Button size='small' variant='primary' onClick={() => void copy(phase.text)}>{t(copied ? 'live.copied' : 'live.copyMine')}</Button>
            <Button size='small' onClick={() => download(phase.text)}>{t('live.download')}</Button>
            {(phase.ending.kind === 'failed' || phase.ending.kind === 'kept') && <Button size='small' onClick={reopen}>{t('live.backToEditor')}</Button>}
            <Button size='small' onClick={() => leaveLost(phase.ending)}>{t('common.close')}</Button>
          </div>
        </div>
      )}
      {phase.kind === 'notice' && (
        <div className='live-editor-notice'>
          <p role={phase.tone}>{phase.message}</p>
          <div className='live-editor-notice-actions'>
            <Button size='small' onClick={reopen}>{t('live.backToEditor')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
