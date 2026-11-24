import { type Ref, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { LiveFrameEditorInfo } from '@mygitnotes/core';
import { useTranslation } from '../../lib/i18n/index.js';
import { checkInLive, type LiveCheckInAnswer, type LiveCheckoutView } from '../../lib/live-api.js';
import { isLiveEditorUrl, liveEmbedUrl, type LiveStatus, liveStatusOf, type LiveTheme, liveThemeMessage } from '../../lib/live-message.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { discardDraft, keptReason } from './live-drafts.js';
import { type LiveLeaveGuard, LiveLeavePrompt, useLiveLeave } from './LiveLeavePrompt.js';
import { LiveToolbarSlot, type RenderLiveToolbar } from './LiveToolbarControls.js';
import { notCheckedInText, stillOpenText } from './useLiveEdit.js';
import './live-editor.css';

export interface LiveEditorFrameProps {
  checkout: LiveCheckoutView;
  /** The framed editor; `discard` where its adapter can discard a pending note (「捨棄草稿」). */
  editor: LiveFrameEditorInfo & { discard?: true; };
  /** The app's theme now; the frame opens with it and hears of each change by message. */
  theme: LiveTheme;
  /** Reads the note again: the editor saved a change or released the note. */
  onRefetch: () => void;
  renderToolbar: RenderLiveToolbar;
  beforeLeaveRef?: Ref<LiveLeaveGuard>;
  /** The note was checked in: by this page (`answer`), or by someone else, which the editor reports as released. */
  onCheckedIn?: (answer?: LiveCheckInAnswer) => void;
  /** The pending note was discarded: by 「捨棄草稿」, or by a check-in that found the draft empty. */
  onDiscarded?: () => void;
  /** The note's title, which names the frame for assistive technology. */
  title?: string;
}

type Phase = { kind: 'open'; } | { kind: 'checking'; } | { kind: 'released'; } | { kind: 'open-after'; answer: LiveCheckInAnswer; } | { kind: 'failed'; message: string; } | { kind: 'discarding'; } | { kind: 'discarded'; } | { kind: 'kept'; message: string; };

/**
 * The live editor of a checked-out note, framed (spec §8): rendered only for an embed URL of the editor's own origin, with
 * no sandbox (the editor needs its own origin's cookies and storage) and no `allow`. The note toolbar gets the frame's
 * status and actions; status messages are taken only from the editor origin and this frame's window.
 */
export function LiveEditorFrame({ checkout, editor, theme, onRefetch, renderToolbar, beforeLeaveRef, onCheckedIn, onDiscarded, title }: LiveEditorFrameProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The frame keeps the URL it opened with; later theme changes travel by message, so the editor is not reloaded.
  const [openedTheme] = useState(theme);
  const src = liveEmbedUrl(checkout.embedUrl ?? '', editor, openedTheme);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'open' });
  const framed = phase.kind === 'open' && src !== null;
  // The cross-origin frame reports if it is unsaved but does not share its text with the host.
  const leave = useLiveLeave(beforeLeaveRef, framed && status?.saved === false);
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
      // An empty pending draft is discarded instead of filed: it is gone, not checked in.
      if (answer.discarded) setPhase({ kind: 'discarded' });
      else {
        setPhase(answer.released ? { kind: 'released' } : { kind: 'open-after', answer });
        if (answer.committed || answer.released) onCheckedIn?.(answer);
      }
    } catch (error) {
      setPhase({ kind: 'failed', message: (error as Error).message });
    }
    onRefetch();
  };
  // 「捨棄草稿」: the frame goes first, as for 立即簽回, since the open editor counts as one active editor.
  const discard = async () => {
    flushSync(() => setPhase({ kind: 'discarding' }));
    setStatus(null);
    try {
      const answer = await discardDraft(checkout.notebookId, checkout.path, t);
      if (!answer) return reopen();
      if (answer.discarded) {
        onRefetch();
        onDiscarded?.();
        return;
      }
      setPhase({ kind: 'kept', message: keptReason(answer, t) });
    } catch (error) {
      setPhase({ kind: 'failed', message: (error as Error).message });
    }
  };
  const reopen = () => {
    postedTheme.current = theme;
    setPhase({ kind: 'open' });
  };

  const stillOpen = (answer: LiveCheckInAnswer) => answer.reason === 'active' && answer.committed ? stillOpenText(t, answer.activeEditors ?? 1) : notCheckedInText(t, answer.reason);
  return (
    <>
      <LiveToolbarSlot render={renderToolbar} state={{ status: framed ? { people: status?.users ?? checkout.activeEditors, state: !status ? 'live.connecting' : !status.connected ? 'live.disconnected' : status.saved ? 'live.saved' : 'live.saving' } : undefined, openInTab: phase.kind !== 'released' && phase.kind !== 'discarded' && isLiveEditorUrl(checkout.editorUrl, editor) ? checkout.editorUrl : undefined, checkIn: framed ? { disabled: !status?.saved, run: () => void checkIn() } : undefined, discard: checkout.pending && editor.discard && (framed || phase.kind === 'kept' || phase.kind === 'failed') ? { run: () => void discard() } : undefined }} />
      <div className='live-editor-frame'>
        {leave.leaving && <LiveLeavePrompt answer={leave.answer} />}
        {src === null && <p role='alert' className='live-editor-notice'>{t('live.frameRefused')}</p>}
        {framed && <iframe ref={frameRef} className='live-editor-iframe' title={t('live.frameTitle', { title: title ?? checkout.path.split('/').pop() ?? '' })} src={src} referrerPolicy='strict-origin-when-cross-origin' />}
        {phase.kind === 'checking' && <LoadingStatus className='live-editor-notice'>{t('live.checkingIn')}</LoadingStatus>}
        {phase.kind === 'discarding' && <LoadingStatus className='live-editor-notice'>{t('live.discarding')}</LoadingStatus>}
        {phase.kind === 'released' && <p role='status' className='live-editor-notice'>{t('live.checkedIn')}</p>}
        {phase.kind === 'discarded' && <p role='status' className='live-editor-notice'>{t('live.discardedEmpty')}</p>}
        {(phase.kind === 'open-after' || phase.kind === 'failed' || phase.kind === 'kept') && src !== null && (
          <div className='live-editor-notice'>
            {phase.kind === 'open-after' ? <p role='status'>{stillOpen(phase.answer)}</p> : phase.kind === 'kept' ? <p role='status'>{phase.message}</p> : <p role='alert'>{phase.message}</p>}
            <div className='live-editor-notice-actions'>
              <Button size='small' onClick={reopen}>{t('live.backToEditor')}</Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
