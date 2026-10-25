import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import './phone-sheet.css';

/** How far the grip must be dragged down, in px, before letting go closes the sheet. */
const CLOSE_DRAG = 96;
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

// Sheets can stack for a moment (one closes as the next opens), so the page behind stays inert until the last one is gone.
let openSheets = 0;
const pageRoot = () => document.getElementById('root');

/**
 * A phone's sheet over the page: `bottom` rises from the bottom edge to at most 85% of the screen, `full` covers all of it. The page
 * behind is inert and focus stays inside until it closes; Escape, a tap on the backdrop, the close button, or a swipe down on the grip or
 * title closes it, and focus returns to what opened it.
 */
export function PhoneSheet({ title, onClose, variant = 'bottom', children, className = '' }: { title: string; onClose: () => void; variant?: 'bottom' | 'full'; children: ReactNode; className?: string; }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  /* eslint-disable react/refs -- Keep the current callback in a ref for imperative listeners without recreating their subscription. */
  close.current = onClose;
  /* eslint-enable react/refs */
  const [drag, setDrag] = useState<{ start: number; offset: number; } | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = pageRoot();
    if (openSheets++ === 0) root?.setAttribute('inert', '');
    dialog.current?.focus({ preventScroll: true });
    return () => {
      if (--openSheets === 0) root?.removeAttribute('inert');
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A menu this sheet opens (a select's options) lives outside it in the DOM and keeps its own Escape and Tab.
    const element = dialog.current;
    if (!element || !(event.target instanceof Node) || !element.contains(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.nativeEvent.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => !item.closest('[hidden], [inert]'));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ start: event.clientY, offset: 0 });
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, offset: Math.max(0, event.clientY - drag.start) });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const far = drag.offset >= CLOSE_DRAG;
    setDrag(null);
    if (far) close.current();
  };

  return createPortal(
    <div className='phone-sheet-layer' data-variant={variant}>
      <button type='button' className='phone-sheet-backdrop' tabIndex={-1} aria-label={t('common.close')} onClick={() => close.current()} />
      <div ref={dialog} role='dialog' aria-modal='true' aria-label={title} tabIndex={-1} className={`phone-sheet ${className}`} data-dragging={drag ? '' : undefined} style={drag ? { transform: `translateY(${drag.offset}px)` } : undefined} onKeyDown={onKeyDown}>
        <div className='phone-sheet-top' data-testid='phone-sheet-grip' onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <span className='phone-sheet-grip' role='presentation' title={t('phone.dragHandle')} />
          <div className='phone-sheet-heading'>
            <h2>{title}</h2>
            <button type='button' className='ui-icon-button' aria-label={t('common.close')} onClick={() => close.current()}>
              <X aria-hidden='true' />
            </button>
          </div>
        </div>
        <div className='phone-sheet-body'>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
