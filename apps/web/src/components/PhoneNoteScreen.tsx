import { type ReactNode, useEffect, useRef, useState } from 'react';
import { insideSidewaysScroll } from '../lib/book-paging.js';
import { EDGE_BACK_SETTLE_MS, edgeBackCommits, edgeBackFrame } from '../lib/edge-back.js';
import { lockAxis, overlayOpen, sideGestureOf } from '../lib/gesture-arbiter.js';
import { usePhoneNotes } from '../lib/phone-notes.js';
import './phone-edge-back.css';

/** Where a sideways drag from the edge is someone else's: a field, a slider, an embed, the Book and the study page, which turn pages. */
const OWNED = 'input, textarea, select, [role="combobox"], [role="slider"], iframe, .compilation-book, .compilation-book-view, .study-page';

type Phase = 'idle' | 'dragging' | 'returning' | 'leaving';

/**
 * A phone's note screen. A finger that lands in the left 24 px and moves right pulls the note off to the right, the list screen (`list`)
 * showing under it and coming in at a sixth of the speed; let go past a third of the screen, the note finishes leaving and the page goes
 * back to the list, short of it, the note returns. It never opens the drawer. A field being typed in, a slider, an embed, something that
 * scrolls sideways, the Book and the study page keep their own moves, and nothing starts while a sheet or the drawer is open.
 */
export function PhoneNoteScreen({ children, list }: { children: ReactNode; list: () => ReactNode; }) {
  const { back } = usePhoneNotes();
  const root = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const leave = useRef(back);
  /* eslint-disable react/refs -- Keep the current callback in a ref for the native listeners without resubscribing them. */
  leave.current = back;
  /* eslint-enable react/refs */

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let gesture: { x: number; y: number; dx: number; width: number; dragging: boolean; } | null = null;
    let suppressClickUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = (dx: number, width: number) => {
      const { note, list: under } = edgeBackFrame(dx, width);
      element.style.setProperty('--edge-back-note', `${note}px`);
      element.style.setProperty('--edge-back-list', `${under}px`);
    };
    const finish = (then: Phase, after?: () => void) => {
      setPhase(then);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        element.style.removeProperty('--edge-back-note');
        element.style.removeProperty('--edge-back-list');
        after?.();
        setPhase('idle');
      }, EDGE_BACK_SETTLE_MS);
    };
    const onStart = (event: TouchEvent) => {
      suppressClickUntil = 0;
      gesture = null;
      if (event.touches.length !== 1 || timer !== undefined) return;
      const target = event.target as Element;
      const editing = target.closest('[contenteditable="true"]');
      if (target.closest(OWNED) || insideSidewaysScroll(target) || (editing && editing.contains(document.activeElement))) return;
      const bounds = element.getBoundingClientRect();
      const touch = event.touches[0];
      if (sideGestureOf({ screen: 'note', x: touch.clientX - bounds.left, width: bounds.width, onRow: false, owned: false, overlay: overlayOpen() }) !== 'back') return;
      gesture = { x: touch.clientX, y: touch.clientY, dx: 0, width: bounds.width, dragging: false };
    };
    const onMove = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) {
        if (gesture.dragging) onCancel();
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        const axis = lockAxis(dx, dy);
        if (!axis) return;
        if (axis === 'vertical' || dx < 0) {
          gesture = null;
          return;
        }
        gesture.dragging = true;
        setPhase('dragging');
      }
      event.preventDefault();
      gesture.dx = dx;
      draw(dx, gesture.width);
    };
    const onEnd = () => {
      const ended = gesture;
      gesture = null;
      if (!ended?.dragging) return;
      suppressClickUntil = performance.now() + 400;
      if (edgeBackCommits(ended.dx, ended.width)) {
        draw(ended.width, ended.width);
        finish('leaving', () => leave.current());
      } else {
        draw(0, ended.width);
        finish('returning');
      }
    };
    const onCancel = () => {
      const ended = gesture;
      gesture = null;
      if (!ended?.dragging) return;
      draw(0, ended.width);
      finish('returning');
    };
    // A drag ends with a compatibility click on whatever lies under the finger; it is not a tap.
    const onClick = (event: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onCancel);
    element.addEventListener('click', onClick, true);
    return () => {
      clearTimeout(timer);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onCancel);
      element.removeEventListener('click', onClick, true);
    };
  }, []);

  const moving = phase !== 'idle';
  return (
    <div ref={root} className='phone-notes-screen phone-note-screen' data-edge-back={moving ? phase : undefined}>
      {moving && <div className='phone-edge-back-under notes-main' aria-hidden='true' {...{ inert: '' }}>{list()}</div>}
      <div className='phone-notes-focus'>{children}</div>
    </div>
  );
}
