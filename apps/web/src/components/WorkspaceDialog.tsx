import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';
import { X } from 'lucide-react';

export function WorkspaceDialog({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string; }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  /* eslint-disable react/refs -- Keep the current callback in a ref for an imperative listener without recreating its subscription. */
  close.current = onClose;
  /* eslint-enable react/refs */

  // The content mounts only once the dialog is modal. Mounted with the dialog, a field's React `autoFocus` would run
  // while the dialog is still closed, where nothing can take focus, and `showModal` would then focus ✕.
  const [open, setOpen] = useState(false);

  // A layout effect, so the content renders before the first paint and the dialog never shows empty.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    /* eslint-disable react/set-state-in-effect -- The content may mount only after the native dialog is modal, which no render can know beforehand. */
    setOpen(true);
    /* eslint-enable react/set-state-in-effect */
    return () => {
      // A succeeding native dialog may already have focused its field. Do not
      // steal that focus back to the old trigger during the previous cleanup.
      const active = document.activeElement;
      const restore = active === document.body || active === element || Boolean(active && element?.contains(active));
      element?.close();
      if (restore) previous?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className={`workspace-dialog ui-dialog ${className}`}
      onCancel={event => {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }}
    >
      <div className='workspace-dialog-heading'>
        <h2>{title}</h2>
        <button type='button' className='ui-icon-button' aria-label={t('common.close')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}
