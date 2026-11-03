import { useEffect } from 'react';
import { insideSidewaysScroll } from './book-paging.js';

/** How far a finger travels sideways before the dock opens or closes. */
export const ASSISTANT_SWIPE_DISTANCE = 64;
const PHONE = '(max-width: 767px)';
/** Where a sideways drag is someone else's: a field, an embed or slider, and the Book and the study page, whose swipes turn pages. */
const OWNED = 'input, textarea, select, [role="combobox"], [role="slider"], [contenteditable="true"], iframe, .compilation-book, .compilation-book-view, .study-page';

interface SwipeOptions {
  /** Whether the dock is open now: closed, a leftward swipe from the right half opens it; open, a rightward swipe on it closes it. */
  isOpen: () => boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * The assistant's swipe on a phone, the mirror of the sidebar drawer's: a finger that starts in the right half of `root` and
 * moves left opens the dock, and one that moves right on the open dock closes it, the dock following the finger. Touches in
 * a field, on something that scrolls sideways (a wide table, a code block, a chip row) or in the Book or the study page are left alone.
 * Returns the cleanup.
 */
export function attachAssistantSwipe(root: HTMLElement, { isOpen, onOpen, onClose }: SwipeOptions): () => void {
  let gesture: { x: number; y: number; dx: number; open: boolean; dragging: boolean; dock: HTMLElement | null; } | null = null;
  let suppressClickUntil = 0;
  const reset = () => {
    gesture?.dock?.classList.remove('is-dragging');
    gesture?.dock?.style.removeProperty('--assistant-drag');
    gesture = null;
  };
  const start = (event: TouchEvent) => {
    suppressClickUntil = 0;
    if (!window.matchMedia(PHONE).matches || event.touches.length !== 1) return;
    const target = event.target as Element;
    if (target.closest(OWNED) || insideSidewaysScroll(target)) return;
    const touch = event.touches[0];
    const open = isOpen();
    const dock = target.closest<HTMLElement>('#assistant-dock');
    if (open ? !dock : dock || touch.clientX - root.getBoundingClientRect().left < root.getBoundingClientRect().width / 2) return;
    gesture = { x: touch.clientX, y: touch.clientY, dx: 0, open, dragging: false, dock };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) return reset();
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return reset();
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (gesture.open ? dx < 0 : dx > 0) return reset();
      gesture.dragging = true;
      gesture.dock?.classList.add('is-dragging');
    }
    event.preventDefault();
    gesture.dx = dx;
    gesture.dock?.style.setProperty('--assistant-drag', `${Math.max(0, dx)}px`);
  };
  const end = () => {
    if (gesture?.dragging) {
      suppressClickUntil = performance.now() + 400;
      if (Math.abs(gesture.dx) >= ASSISTANT_SWIPE_DISTANCE) (gesture.open ? onClose : onOpen)();
    }
    reset();
  };
  const cancel = () => {
    if (gesture?.dragging) suppressClickUntil = performance.now() + 400;
    reset();
  };
  // A drag ends with a compatibility click on whatever lies under the finger; it is not a tap.
  const click = (event: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: false });
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', cancel);
  root.addEventListener('click', click, true);
  return () => {
    reset();
    root.removeEventListener('touchstart', start);
    root.removeEventListener('touchmove', move);
    root.removeEventListener('touchend', end);
    root.removeEventListener('touchcancel', cancel);
    root.removeEventListener('click', click, true);
  };
}

/** Attaches the assistant's swipe to the whole page while `enabled`: a zoomed note lies outside the workspace body. */
export function useAssistantSwipe(enabled: boolean, { isOpen, onOpen, onClose }: SwipeOptions) {
  useEffect(() => {
    if (!enabled) return;
    return attachAssistantSwipe(document.documentElement, { isOpen, onOpen, onClose });
  }, [enabled, isOpen, onOpen, onClose]);
}
