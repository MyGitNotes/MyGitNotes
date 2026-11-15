import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { CloudOff, ExternalLink, Users } from 'lucide-react';
import type { LiveFrameEditorInfo } from '@mygitnotes/core';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { checkInLive, type LiveCheckInAnswer, type LiveCheckoutView } from '../../lib/live-api.js';
import { isLiveEditorUrl, liveEmbedUrl, type LiveStatus, liveStatusOf, type LiveTheme, liveThemeMessage } from '../../lib/live-message.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import './live-editor.css';

export interface LiveEditorFrameProps {
  checkout: LiveCheckoutView;
  editor: LiveFrameEditorInfo;
  /** The app's theme now; the frame opens with it and hears of each change by message. */
  theme: LiveTheme;
  /** Reads the note again: the editor saved a change, released the note, or was closed. */
  onRefetch: () => void;
  /** Leaves the live editor for the note's read view. */
  onClose: () => void;
  /** The note was checked in: by this page (`answer`), or by someone else, which the editor reports as released. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
  /** The note's title, which names the frame for assistive technology. */
  title?: string;
}

type Phase = { kind: 'open'; } | { kind: 'checking'; } | { kind: 'released'; } | { kind: 'open-after'; answer: LiveCheckInAnswer; } | { kind: 'failed'; message: string; };

const REASONS: Record<string, TranslationKey> = { active: 'live.reason.active', changed: 'live.reason.changed', 'not-synced': 'live.reason.not-synced', leased: 'live.reason.leased', released: 'live.reason.released', unfiled: 'live.reason.unfiled' };

/**
 * The live editor of a checked-out note, framed (spec §8): rendered only for an embed URL of the editor's own origin, with
 * no sandbox (the editor needs its own origin's cookies and storage) and no `allow`. Its bar says who is editing, whether
 * the text is saved and connected, and offers 「在新分頁開啟」, 「立即簽回」 and 「關閉」. Status messages are taken only from
 * the editor origin and this frame's window.
 */
export function LiveEditorFrame({ checkout, editor, theme, onRefetch, onClose, onCheckedIn, title }: LiveEditorFrameProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The frame keeps the URL it opened with; later theme changes travel by message, so the editor is not reloaded.
  const [openedTheme] = useState(theme);
  const src = liveEmbedUrl(checkout.embedUrl ?? '', editor, openedTheme);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  const framed = phase.kind === 'open' && src !== null;
  const latest = useRef({ onRefetch, onCheckedIn, status });
  useEffect(() => {
    latest.current = { onRefetch, onCheckedIn, status };
  });

  useEffect(() => {
    if (!framed) return;
    const listen = (event: MessageEvent) => {
      const next = liveStatusOf(event, editor, frameRef.current?.contentWindow);
      if (!next) return;
      const previous = latest.current.status;
      setStatus(next);
      if (next.released) {
        setPhase({ kind: 'released' });
        latest.current.onRefetch();
        latest.current.onCheckedIn?.();
      } else if (previous && !previous.saved && next.saved) latest.current.onRefetch();
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [framed, editor]);

  const postedTheme = useRef(openedTheme);
  useEffect(() => {
    if (!framed || postedTheme.current === theme) return;
    postedTheme.current = theme;
    frameRef.current?.contentWindow?.postMessage(liveThemeMessage(editor, theme), editor.origin);
  }, [framed, theme, editor]);

  const checkIn = async () => {
    // The open frame counts as an active editor, so it goes before the check-in asks the editor to release the note.
    flushSync(() => setPhase({ kind: 'checking' }));
    setStatus(null);
    try {
      const answer = await checkInLive(checkout.notebookId, checkout.path);
      setPhase(answer.released ? { kind: 'released' } : { kind: 'open-after', answer });
      if (answer.committed || answer.released) onCheckedIn?.(answer);
    } catch (error) {
      setPhase({ kind: 'failed', message: (error as Error).message });
    }
    onRefetch();
  };
  const close = () => {
    onRefetch();
    onClose();
  };
  const reopen = () => {
    postedTheme.current = theme;
    setPhase({ kind: 'open' });
  };

  const users = status?.users ?? checkout.activeEditors;
  const stillOpen = (answer: LiveCheckInAnswer) => answer.reason === 'active' && answer.committed ? t('live.stillOpen', { count: answer.activeEditors ?? 1 }) : t('live.notCheckedIn', { reason: t(REASONS[answer.reason ?? ''] ?? 'live.reason.changed') });
  return (
    <div className='live-editor-frame'>
      <div className='live-editor-bar' role='toolbar' aria-label={t('live.toolbar')}>
        {framed && (
          <>
            <span className='live-editor-state live-editor-users'>
              <Users size={14} aria-hidden='true' />
              {t('live.editors', { count: users })}
            </span>
            <span className='live-editor-state' data-tone={status?.saved ? 'ok' : undefined}>{t(status ? status.saved ? 'live.saved' : 'live.saving' : 'live.connecting')}</span>
            {status && !status.connected && (
              <span className='live-editor-state' data-tone='warn'>
                <CloudOff size={14} aria-hidden='true' />
                {t('live.disconnected')}
              </span>
            )}
          </>
        )}
        <div className='live-editor-actions'>
          {phase.kind !== 'released' && isLiveEditorUrl(checkout.editorUrl, editor) && (
            <a className='ui-button ui-button-small' href={checkout.editorUrl} target='_blank' rel='noopener noreferrer'>
              <ExternalLink size={14} aria-hidden='true' />
              {t('live.openInTab')}
            </a>
          )}
          {framed && <Button size='small' variant='primary' title={t('live.checkInHint')} disabled={!status?.saved} onClick={() => void checkIn()}>{t('live.checkIn')}</Button>}
          <Button size='small' disabled={phase.kind === 'checking'} onClick={close}>{t('common.close')}</Button>
        </div>
      </div>
      {src === null && <p role='alert' className='live-editor-notice'>{t('live.frameRefused')}</p>}
      {framed && <iframe ref={frameRef} className='live-editor-iframe' title={t('live.frameTitle', { title: title ?? checkout.path.split('/').pop() ?? '' })} src={src} referrerPolicy='strict-origin-when-cross-origin' />}
      {phase.kind === 'checking' && <LoadingStatus className='live-editor-notice'>{t('live.checkingIn')}</LoadingStatus>}
      {phase.kind === 'released' && <p role='status' className='live-editor-notice'>{t('live.checkedIn')}</p>}
      {(phase.kind === 'open-after' || phase.kind === 'failed') && src !== null && (
        <div className='live-editor-notice'>
          {phase.kind === 'open-after' ? <p role='status'>{stillOpen(phase.answer)}</p> : <p role='alert'>{phase.message}</p>}
          <div className='live-editor-notice-actions'>
            <Button size='small' onClick={reopen}>{t('live.backToEditor')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
