import { type Ref, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { Button } from '../Button.js';

/** Undefined when no prompt is needed; otherwise lets the requesting navigation await the answer. */
export type LiveLeaveGuard = () => Promise<boolean> | undefined;

export function useLiveLeave(ref: Ref<LiveLeaveGuard> | undefined, unsaved: boolean) {
  const [leaving, setLeaving] = useState(false);
  const resolve = useRef<((allowed: boolean) => void) | null>(null);
  useImperativeHandle(ref, () => () => {
    // Only one navigation may use an answer, even if two close controls are pressed.
    if (resolve.current) return Promise.resolve(false);
    if (!unsaved) return undefined;
    setLeaving(true);
    return new Promise<boolean>(answer => {
      resolve.current = answer;
    });
  }, [unsaved]);
  useEffect(() => () => {
    resolve.current?.(false);
    resolve.current = null;
  }, []);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const answer = useCallback((allowed: boolean) => {
    const pending = resolve.current;
    if (!pending) return;
    resolve.current = null;
    setLeaving(false);
    pending(allowed);
  }, []);
  return { leaving, answer };
}

export function LiveLeavePrompt({ answer, copy, download }: { answer: (allowed: boolean) => void; copy?: () => Promise<void>; download?: () => void; }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const message = useId();
  // A Focus tab's hover preview must not cover the warning. The browser's top layer also makes the underlying editor inert.
  useLayoutEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    keepEditing.current?.focus();
    return () => modal.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      role='alertdialog'
      aria-label={t('editor.closeNote')}
      aria-describedby={message}
      className='live-editor-notice live-editor-leave'
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        answer(false);
      }}
    >
      <p id={message}>{t(copy ? 'live.leaveUnsaved' : 'live.leaveFrameUnsaved')}</p>
      <div className='live-editor-notice-actions'>
        {copy && <Button size='small' variant='primary' onClick={() => void copy().then(() => setCopied(true))}>{t(copied ? 'live.copied' : 'live.copyMine')}</Button>}
        {download && <Button size='small' onClick={download}>{t('live.download')}</Button>}
        <Button size='small' variant='danger' onClick={() => answer(true)}>{t('live.closeAnyway')}</Button>
        <Button ref={keepEditing} size='small' onClick={() => answer(false)}>{t('live.backToEditor')}</Button>
      </div>
    </dialog>
  );
}
