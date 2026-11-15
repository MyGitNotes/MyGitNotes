import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CloudOff, Users } from 'lucide-react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { yCollab } from 'y-codemirror.next';
import type { Extension } from '@codemirror/state';
import type { LiveBuiltinEditorInfo } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { checkInLive, isNotLive, type LiveCheckInAnswer, type LiveCheckoutView, socketTicket } from '../../lib/live-api.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { LiveMarkdownEditor } from '../LiveMarkdownEditor.js';
import { discardDraft, keptReason } from './live-drafts.js';
import { stillOpenText } from './useLiveEdit.js';
import './live-editor.css';

export interface LiveCollabEditorProps {
  checkout: LiveCheckoutView;
  /** The repository's built-in editor; `discard` where it can discard a pending note (「捨棄草稿」). */
  editor: LiveBuiltinEditorInfo & { discard?: true; };
  /** Reads the note again: the text was saved, the note was checked in, or the editor was closed. */
  onRefetch: () => void;
  /** Leaves the live editor for the note's read view. */
  onClose: () => void;
  /** The note was checked in: by this page (`answer`), or by someone else, which the server tells the tab. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
  /** The pending note was discarded: by 「捨棄草稿」, or by a check-in that found the draft empty. */
  onDiscarded?: () => void;
  /** The note's title, which names a downloaded copy. */
  title?: string;
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
  unsynced: number;
  people: number;
}
const START: Connection = { status: 'connecting', synced: false, unsynced: 0, people: 1 };
/** How long nothing may be unsaved before the bar says 已儲存: each keystroke is stored within a few milliseconds. */
const SETTLE_MS = 300;

const REFUSALS: Record<RefusedReason, TranslationKey> = { 'too-large': 'live.tooLargeLive', busy: 'live.busy', other: 'live.socketRefused' };

const REASONS: Record<string, TranslationKey> = { active: 'live.reason.active', changed: 'live.reason.changed', 'not-synced': 'live.reason.not-synced', leased: 'live.reason.leased', released: 'live.reason.released', unfiled: 'live.reason.unfiled' };

/** The socket of the app's own origin, as the page reached it: `wss:` under https. */
const socketUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live/socket`;

/**
 * The text of a tab that left a note inside the app (another note, another pane) while typing in it was unsaved, by
 * `notebookId` and path: the note's editor offers it once, the next time it opens in this page.
 */
const leftUnsaved = new Map<string, string>();
const leftKey = (notebookId: string, path: string) => `${notebookId}\n${path}`;

/** A file name for the downloaded copy of the tab's text. */
const downloadName = (title: string | undefined, path: string) => `${(title || path.split('/').pop()?.replace(/\.(md|markdown)$/i, '') || 'note').replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').trim() || 'note'}.md`;

/**
 * The built-in live editor of a checked-out note (docs/specs/2026-11-15-builtin-live-editor §8.2): the note is co-edited
 * here, in the app's own Markdown editor, over a Yjs document on the app's socket. Each connect asks for a single-use
 * ticket; the editor mounts once the document first synced. The bar says who is editing and whether every keystroke is
 * stored (已儲存 only once the server acknowledged it), and offers 「立即簽回」, 「捨棄草稿」 on a pending note, and 「關閉」.
 * A note checked in elsewhere ends the session: a tab with nothing unsaved reads it as checked in, one with unsaved typing
 * offers its text to copy or download, and its document is never merged into the reopened note. Every other end of a
 * session (a refusal, a ticket that cannot be had) offers unsaved typing the same way.
 */
export function LiveCollabEditor({ checkout, editor, onRefetch, onClose, onCheckedIn, onDiscarded, title }: LiveCollabEditorProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  // Each session is one document and one provider; going back to the editor after a check-in that left it open starts a new one.
  const [session, setSession] = useState(1);
  const [connection, setConnection] = useState<Connection>(START);
  const [collab, setCollab] = useState<{ extension: Extension; text: string; } | null>(null);
  const [copied, setCopied] = useState(false);
  /** 「關閉」 asked while typing is unsaved: the editor stays open under the question. */
  const [leaving, setLeaving] = useState(false);
  /** Unsaved text this note's editor kept when the person last left the note inside the app. */
  const [left, setLeft] = useState(() => leftUnsaved.get(leftKey(checkout.notebookId, checkout.path)) ?? null);
  useEffect(() => {
    leftUnsaved.delete(leftKey(checkout.notebookId, checkout.path));
  }, [checkout.notebookId, checkout.path]);
  const live = phase.kind === 'open';
  const latest = useRef({ checkout, onRefetch, onCheckedIn, connection, t });
  useEffect(() => {
    latest.current = { checkout, onRefetch, onCheckedIn, connection, t };
  });
  /** Ends the running session at once: the provider is destroyed (its socket closes), and its document read first. */
  const stopRef = useRef<() => string>(() => '');
  /** The running session's text. */
  const readRef = useRef<() => string>(() => '');

  useEffect(() => {
    if (!live) return;
    let stopped = false, provider: HocuspocusProvider | undefined;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const text = doc.getText('content');
    const stop = () => {
      const content = text.toString();
      if (stopped) return content;
      stopped = true;
      provider?.destroy();
      awareness.destroy();
      doc.destroy();
      return content;
    };
    stopRef.current = stop;
    readRef.current = () => text.toString();
    /** Ends the session: the tab's document is dropped, and its unsaved text offered when it has any, whatever ended it. */
    const end = (ending: Ending) => {
      if (stopped) return;
      const unsynced = latest.current.connection.unsynced;
      const content = stop();
      if (unsynced > 0) return setPhase({ kind: 'lost', text: content, ending });
      if (ending.kind === 'refused') return setPhase({ kind: 'refused', reason: ending.reason });
      if (ending.kind === 'failed') return setPhase({ kind: 'notice', message: ending.message, tone: 'alert' });
      setPhase({ kind: 'released' });
      latest.current.onRefetch();
      latest.current.onCheckedIn?.();
    };
    /** The note was checked in or discarded elsewhere. */
    const released = () => end({ kind: 'released' });
    const failed = (message: string) => end({ kind: 'failed', message });
    const { notebookId, path } = latest.current.checkout;
    void (async () => {
      let first: { ticket: string; document: string; };
      try {
        first = await socketTicket(notebookId, path);
      } catch (error) {
        if (isNotLive(error)) released();
        else failed((error as Error).message);
        return;
      }
      if (stopped) return;
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
      provider = new HocuspocusProvider({
        url: socketUrl(),
        name: first.document,
        document: doc,
        awareness,
        token,
        // The server keeps a state only past the clock it last saw of this client: 0 at first, the same after a reconnect.
        // Setting it again moves the clock, so the others count this tab from its connect, as the server's activeEditors do.
        onAuthenticated: () => awareness.setLocalState({ ...awareness.getLocalState() }),
        // A socket that is not connected has no synced document: it syncs again once it reconnects.
        onStatus: ({ status }) => setConnection(current => ({ ...current, status: status as Connection['status'], synced: status === 'connected' && current.synced })),
        onSynced: ({ state }) => {
          if (!state || stopped) return;
          setConnection(current => ({ ...current, synced: true, everSynced: true }));
          setCollab(current => current ?? { extension: yCollab(text, awareness, { undoManager: new Y.UndoManager(text) }), text: text.toString() });
        },
        onUnsyncedChanges: ({ number }) => setConnection(current => ({ ...current, unsynced: number })),
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
          else if (message.type === 'refused') end({ kind: 'refused', reason: message.reason === 'too-large' || message.reason === 'busy' ? message.reason : 'other' });
        },
        // A refused ticket is not retried: the note was checked in meanwhile, or the server refused this tab.
        onAuthenticationFailed: () => {
          void socketTicket(notebookId, path).then(next => next.document === first.document ? failed(latest.current.t('live.socketRefused')) : released(), error => isNotLive(error) ? released() : failed((error as Error).message));
        },
      });
    })();
    // The browser knows it is offline long before the socket's timeout does, and back online before its next retry.
    const offline = () => {
      if (stopped) return;
      provider?.disconnect();
      setConnection(current => ({ ...current, status: 'disconnected', synced: false }));
    };
    const online = () => {
      if (!stopped) void provider?.connect();
    };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      // Unmounted under a running session (the person went to another note or pane): its unsaved text is kept for later.
      if (!stopped && latest.current.connection.unsynced > 0) leftUnsaved.set(leftKey(notebookId, path), text.toString());
      stop();
    };
  }, [live, session]);

  // 已儲存 waits until nothing was unsaved for SETTLE_MS, so typing does not flicker it, or 立即簽回 with it.
  const [settled, setSettled] = useState(true);
  if (connection.unsynced > 0 && settled) setSettled(false);
  useEffect(() => {
    if (connection.unsynced > 0 || settled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [connection.unsynced, settled]);

  // Typing the server has not stored yet is lost with the page.
  const unsaved = live && connection.unsynced > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // A new session starts from nothing: no connection yet, and the editor mounts again once its document synced.
  const reopen = () => {
    setConnection(START);
    setCollab(null);
    setCopied(false);
    setLeaving(false);
    setSession(current => current + 1);
    setPhase({ kind: 'open' });
  };
  const checkIn = async () => {
    // This tab counts as an active editor until its socket closes, so it goes before the check-in releases the note.
    stopRef.current();
    flushSync(() => setPhase({ kind: 'checking' }));
    try {
      const answer = await checkInLive(checkout.notebookId, checkout.path);
      if (answer.discarded) setPhase({ kind: 'discarded' });
      else {
        setPhase(answer.released ? { kind: 'released' } : { kind: 'notice', tone: 'status', message: answer.reason === 'active' && answer.committed ? stillOpenText(t, answer.activeEditors ?? 1) : t('live.notCheckedIn', { reason: t(REASONS[answer.reason ?? ''] ?? 'live.reason.changed') }) });
        if (answer.committed || answer.released) onCheckedIn?.(answer);
      }
    } catch (error) {
      setPhase({ kind: 'notice', tone: 'alert', message: (error as Error).message });
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
    const unsynced = connection.unsynced;
    const content = stopRef.current();
    const stayed = (ending: Ending, fallback: () => void) => (unsynced > 0 ? setPhase({ kind: 'lost', text: content, ending }) : fallback());
    flushSync(() => setPhase({ kind: 'discarding' }));
    try {
      const answer = await discardDraft(checkout.notebookId, checkout.path, t, askDiscard);
      if (!answer) return stayed({ kind: 'kept' }, reopen);
      if (answer.discarded) {
        onRefetch();
        onDiscarded?.();
        return;
      }
      const message = keptReason(answer, t);
      stayed({ kind: 'failed', message }, () => setPhase({ kind: 'notice', tone: 'status', message }));
    } catch (error) {
      const message = (error as Error).message;
      stayed({ kind: 'failed', message }, () => setPhase({ kind: 'notice', tone: 'alert', message }));
    }
  };
  /** 「關閉」: asks first, in the editor, while typing is unsaved. */
  const close = () => {
    if (live && connection.unsynced > 0) return setLeaving(true);
    closeNow();
  };
  const closeNow = () => {
    setLeaving(false);
    stopRef.current();
    onRefetch();
    if (phase.kind === 'discarded') (onDiscarded ?? onClose)();
    else onClose();
  };
  /** Leaves the lost text: for the read view of the checked-in note, or as 「關閉」 does when the note is still live. */
  const leaveLost = (ending: Ending) => {
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
  // and one connected again is connecting until its document synced again.
  const stateKey: TranslationKey = !connection.everSynced ? 'live.connecting' : connection.status !== 'connected' ? 'live.offline' : !connection.synced ? 'live.connecting' : connection.unsynced > 0 || !settled ? 'live.unsaved' : 'live.saved';
  const canCheckIn = connection.status === 'connected' && connection.synced && connection.unsynced === 0 && settled;
  const discardable = Boolean(checkout.pending && editor.discard) && (live || phase.kind === 'notice');
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
        <div className='live-editor-actions'>{discardable && <Button size='small' variant='danger' title={t('live.discardHint')} onClick={() => void discard()}>{t('live.discard')}</Button>}{live && <Button size='small' variant='primary' title={t('live.checkInHint')} disabled={!canCheckIn} onClick={() => void checkIn()}>{t('live.checkIn')}</Button>}{phase.kind !== 'lost' && <Button size='small' disabled={phase.kind === 'checking' || phase.kind === 'discarding'} onClick={close}>{t('common.close')}</Button>}</div>
      </div>
      {left !== null && (
        <div role='alert' className='live-editor-notice'>
          <p>{t('live.unsavedLeft')}</p>
          <div className='live-editor-notice-actions'>
            <Button size='small' variant='primary' onClick={() => void copy(left)}>{t(copied ? 'live.copied' : 'live.copyMine')}</Button>
            <Button size='small' onClick={() => download(left)}>{t('live.download')}</Button>
            <Button size='small' onClick={() => setLeft(null)}>{t('live.dismiss')}</Button>
          </div>
        </div>
      )}
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
      {live && collab && (
        <div className='note-editor-body live-collab-body'>
          <LiveMarkdownEditor content={collab.text} collab={collab} notePath={checkout.path} notebookId={checkout.notebookId} readOnly={false} onChange={() => {}} ariaLabel={t('live.toolbar')} />
        </div>
      )}
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
