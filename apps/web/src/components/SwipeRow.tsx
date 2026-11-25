import { type ReactNode, useEffect, useRef, useState } from 'react';
import { lockAxis, overlayOpen, sideGestureOf } from '../lib/gesture-arbiter.js';
import { CLICK_GUARD_MS, createHoldRecognizer, swallowNextClick } from '../lib/hold.js';
import { type Revealed, revealedOffset, ROW_ACTION_PX, rowOffset, settleRow } from '../lib/row-swipe.js';
import './swipe-row.css';

export interface SwipeRowProps {
  /** The row itself, which slides over the actions. */
  children: ReactNode;
  /** The actions a rightward push reveals on the row's left, and how many there are. */
  start?: ReactNode;
  startCount?: number;
  /** The actions a leftward push reveals on the row's right, and how many there are. */
  end?: ReactNode;
  endCount?: number;
  /** A finger resting on the row (`HOLD_MS`) asks for the note's menu. */
  onHold?: () => void;
}

/**
 * A phone list row with swipe actions. A sideways push (where `sideGestureOf` gives the touch to the row, so past the drawer's left edge)
 * slides the row with the finger and, let go past half the actions, leaves them showing; nothing runs until one is tapped. A finger that
 * rests asks for the note's menu, and one that moves first is a scroll or a swipe instead. While actions show, any other touch only closes
 * them: the next tap anywhere, the row included, does nothing else.
 */
export function SwipeRow({ children, start, startCount = start ? 1 : 0, end, endCount = end ? 1 : 0, onHold }: SwipeRowProps) {
  const root = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<Revealed>(null);
  const hold = useRef(onHold);
  /* eslint-disable react/refs -- Keep the current callback in a ref for the native listeners without resubscribing them. */
  hold.current = onHold;
  /* eslint-enable react/refs */
  const widths = { start: startCount * ROW_ACTION_PX, end: endCount * ROW_ACTION_PX };
  const { start: startWidth, end: endWidth } = widths;

  useEffect(() => {
    const element = root.current, slide = front.current;
    if (!element || !slide) return;
    const sizes = { start: startWidth, end: endWidth };
    let guardUntil = 0;
    const guard = () => guardUntil = performance.now() + CLICK_GUARD_MS;
    const recognizer = createHoldRecognizer(() => {
      guard();
      setRevealed(null);
      hold.current?.();
    });
    let touch: { x: number; y: number; from: Revealed; swipe: boolean; axis: 'horizontal' | 'vertical' | null; offset: number; } | null = null;
    const current = (): Revealed => (element.dataset.revealed as Revealed | undefined) ?? null;
    const settle = (next: Revealed) => {
      element.removeAttribute('data-dragging');
      slide.style.removeProperty('transform');
      setRevealed(next);
    };

    const onStart = (event: TouchEvent) => {
      touch = null;
      recognizer.cancel();
      if (event.touches.length !== 1) return;
      const target = event.target as Element;
      // A tap on a revealed action is that action's.
      if (target.closest('.swipe-row-actions')) return;
      // Something else open over the page closes first (it handles this touch); this row's own actions do not count.
      if (overlayOpen(document, 'row') || (document.querySelector('[data-row-swipe][data-revealed]') && !element.dataset.revealed)) return;
      const { clientX: x, clientY: y } = event.touches[0];
      const swipe = sideGestureOf({ screen: 'list', x, width: document.documentElement.clientWidth || window.innerWidth, onRow: true, owned: false, overlay: false }) === 'row';
      touch = { x, y, from: current(), swipe, axis: null, offset: revealedOffset(current(), sizes) };
      if (hold.current && !current()) recognizer.start({ x, y }, 1);
    };
    const onMove = (event: TouchEvent) => {
      if (!touch) return;
      if (event.touches.length !== 1) {
        recognizer.cancel();
        touch = null;
        return;
      }
      const { clientX, clientY } = event.touches[0];
      const dx = clientX - touch.x, dy = clientY - touch.y;
      recognizer.move({ x: clientX, y: clientY });
      if (!touch.axis) {
        touch.axis = lockAxis(dx, dy);
        if (!touch.axis) return;
        recognizer.cancel();
        if (touch.axis === 'vertical' || !touch.swipe) {
          // A scroll, or the drawer's edge: an open row closes as it would on any other touch.
          if (touch.from) settle(null);
          touch = null;
          return;
        }
        element.setAttribute('data-dragging', '');
      }
      event.preventDefault();
      touch.offset = rowOffset(touch.from, dx, sizes);
      slide.style.transform = `translateX(${touch.offset}px)`;
    };
    const onEnd = (event: TouchEvent) => {
      // After a hold the lift is no tap: no compatibility mouse events or click follow it, nor reach the sheet now under the finger.
      if (recognizer.fired) {
        // A lift the browser lets us cancel sends no click at all; otherwise the click it sends is swallowed.
        if (event.cancelable) event.preventDefault();
        else swallowNextClick();
      }
      recognizer.cancel();
      const ended = touch;
      touch = null;
      if (!ended) return;
      if (ended.axis === 'horizontal') {
        guard();
        settle(settleRow(ended.offset, sizes));
      } else if (ended.from) {
        // A tap on a row whose actions show closes them and opens nothing.
        guard();
        settle(null);
      }
    };
    const onCancel = () => {
      recognizer.cancel();
      if (touch?.axis === 'horizontal') settle(touch.from);
      touch = null;
    };
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element).closest('.swipe-row-actions')) return;
      if (performance.now() < guardUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // The browser's own menu on a long press (Android, a long press on a link) would cover the note's.
    const onContextMenu = (event: MouseEvent) => {
      if (recognizer.pending || recognizer.fired) event.preventDefault();
    };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onCancel);
    element.addEventListener('click', onClick, true);
    element.addEventListener('contextmenu', onContextMenu);
    return () => {
      recognizer.cancel();
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
      element.removeEventListener('click', onClick, true);
      element.removeEventListener('contextmenu', onContextMenu);
    };
  }, [startWidth, endWidth]);

  // While its actions show, a touch anywhere else closes them and does nothing more: no other gesture starts, and its click is swallowed
  // even after the actions are gone.
  useEffect(() => {
    if (!revealed) return;
    const outside = (event: Event) => !(event.target instanceof Node && root.current?.contains(event.target));
    const onTouch = (event: TouchEvent) => {
      if (!outside(event)) return;
      event.stopPropagation();
      swallowNextClick();
      setRevealed(null);
    };
    const onClick = (event: MouseEvent) => {
      if (!outside(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setRevealed(null);
    };
    document.addEventListener('touchstart', onTouch, { capture: true });
    window.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('touchstart', onTouch, { capture: true });
      window.removeEventListener('click', onClick, true);
    };
  }, [revealed]);

  const offset = revealedOffset(revealed, widths);
  return (
    <div ref={root} role='listitem' className='swipe-row' data-row-swipe='' data-revealed={revealed ?? undefined}>
      {start && <div className='swipe-row-actions' data-side='start' style={{ width: widths.start }} aria-hidden={revealed !== 'start' || undefined} {...(revealed !== 'start' ? { inert: '' } : {})} onClick={() => setRevealed(null)}>{start}</div>}
      {end && <div className='swipe-row-actions' data-side='end' style={{ width: widths.end }} aria-hidden={revealed !== 'end' || undefined} {...(revealed !== 'end' ? { inert: '' } : {})} onClick={() => setRevealed(null)}>{end}</div>}
      <div ref={front} className='swipe-row-front' style={offset ? { transform: `translateX(${offset}px)` } : undefined}>{children}</div>
    </div>
  );
}
