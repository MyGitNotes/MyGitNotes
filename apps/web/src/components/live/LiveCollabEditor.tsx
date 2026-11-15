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

/** How a session ended under the tab: the note was checked in, the server refused it, or a call failed. */
type Ending = { kind: 'released'; } | { kind: 'refused'; reason: RefusedReason; } | { kind: 'failed'; message: string; };

type Phase =
  | { kind: 'open'; }
  | { kind: 'checking'; }
  | { kind: 'discarding'; }
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
  synced: boolean;
  unsynced: number;
  people: number;
}
const START: Connection = { status: 'connecting', synced: false, unsynced: 0, people: 1 };

const REFUSALS: Record<RefusedReason, TranslationKey> = { 'too-large': 'live.tooLargeLive', busy: 'live.busy', other: 'live.socketRefused' };

const REASONS: Record<string, TranslationKey> = { active: 'live.reason.active', changed: 'live.reason.changed', 'not-synced': 'live.reason.not-synced', leased: 'live.reason.leased', released: 'live.reason.released', unfiled: 'live.reason.unfiled' };

/** The socket of the app's own origin, as the page reached it: `wss:` under https. */
const socketUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live/socket`;

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
  const live = phase.kind === 'open';
  const latest = useRef({ checkout, onRefetch, onCheckedIn, connection, t });
  useEffect(() => {
    latest.current = { checkout, onRefetch, onCheckedIn, connection, t };
  });
  /** Ends the running session at once: the provider is destroyed (its socket closes), and its document read first. */
  const stopRef = useRef<() => string>(() => '');

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
        onStatus: ({ status }) => setConnection(current => ({ ...current, status: status as Connection['status'] })),
        onSynced: ({ state }) => {
          if (!state || stopped) return;
          setConnection(current => ({ ...current, synced: true }));
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
    return () => void stop();
  }, [live, session]);

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
  const discard = async () => {
    stopRef.current();
    flushSync(() => setPhase({ kind: 'discarding' }));
    try {
      const answer = await discardDraft(checkout.notebookId, checkout.path, t);
      if (!answer) return reopen();
      if (answer.discarded) {
        onRefetch();
        onDiscarded?.();
        return;
      }
      setPhase({ kind: 'notice', tone: 'status', message: keptReason(answer, t) });
    } catch (error) {
      setPhase({ kind: 'notice', tone: 'alert', message: (error as Error).message });
    }
  };
  const close = () => {
    stopRef.current();
    onRefetch();
    if (phase.kind === 'discarded') (onDiscarded ?? onClose)();
    else onClose();
  };
  /** Leaves the lost text: for the read view of the checked-in note, or as 「關閉」 does when the note is still live. */
  const leaveLost = (ending: Ending) => {
    if (ending.kind !== 'released') return close();
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

  const offline = connection.status === 'disconnected';
  const stateKey: TranslationKey = !connection.synced ? 'live.connecting' : offline ? 'live.offline' : connection.unsynced > 0 ? 'live.unsaved' : 'live.saved';
  const canCheckIn = connection.status === 'connected' && connection.synced && connection.unsynced === 0;
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
      {live && collab && (
        <div className='note-editor-body live-collab-body'>
          <LiveMarkdownEditor content={collab.text} collab={collab} notePath={checkout.path} notebookId={checkout.notebookId} readOnly={false} onChange={() => {}} ariaLabel={t('live.toolbar')} />
        </div>
      )}
      {phase.kind === 'checking' && <LoadingStatus className='live-editor-notice'>{t('live.checkingIn')}</LoadingStatus>}
      {phase.kind === 'discarding' && <LoadingStatus className='live-editor-notice'>{t('live.discarding')}</LoadingStatus>}
      {phase.kind === 'released' && <p role='status' className='live-editor-notice'>{t('live.checkedIn')}</p>}
      {phase.kind === 'discarded' && <p role='status' className='live-editor-notice'>{t('live.discardedEmpty')}</p>}
      {phase.kind === 'refused' && <p role='alert' className='live-editor-notice'>{t(REFUSALS[phase.reason])}</p>}
      {phase.kind === 'lost' && (
        <div role='alert' className='live-editor-notice'>
          {phase.ending.kind === 'released' ? <p>{t('live.releasedOffline')}</p> : (
            <>
              <p>{phase.ending.kind === 'refused' ? t(REFUSALS[phase.ending.reason]) : phase.ending.message}</p>
              <p>{t('live.unsavedMine')}</p>
            </>
          )}
          <div className='live-editor-notice-actions'>
            <Button size='small' variant='primary' onClick={() => void copy(phase.text)}>{t(copied ? 'live.copied' : 'live.copyMine')}</Button>
            <Button size='small' onClick={() => download(phase.text)}>{t('live.download')}</Button>
            {phase.ending.kind === 'failed' && <Button size='small' onClick={reopen}>{t('live.backToEditor')}</Button>}
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
