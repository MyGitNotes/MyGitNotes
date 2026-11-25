import { useEffect, useRef } from 'react';
import { lockAxis, overlayOpen, ROW_SWIPE_SELECTOR, screenOf, sideGestureOf } from './gesture-arbiter.js';

/** How far a finger travels sideways before the drawer opens or closes. */
export const SIDEBAR_SWIPE_DISTANCE = 64;
/** Where a sideways drag is a field's own, or the assistant's sheet's, which lies over the page on a phone (see assistant-swipe.ts). */
const OWNED = 'input, textarea, select, [role="combobox"], [contenteditable="true"], #assistant-dock';

interface SwipeOptions {
  isOpen: () => boolean;
  onChange: (open: boolean) => void;
}

/**
 * The notebooks drawer's swipe on a narrow page, the drawer following the finger. Closed, it opens where `sideGestureOf` gives the touch
 * to the drawer: the list's left 24 px (before a row under it), the list's left half between rows, never a note (whose left edge goes back
 * to the list) and nothing while a sheet or a row's actions are open. Open, a leftward swipe anywhere but a field closes it.
 * Returns the cleanup.
 */
export function attachSidebarSwipe(root: HTMLElement, { isOpen, onChange }: SwipeOptions): () => void {
  let suppressClickUntil = 0;
  let gesture: { panel: HTMLElement; x: number; y: number; dx: number; open: boolean; dragging: boolean; } | null = null;
  const reset = () => {
    gesture?.panel.classList.remove('is-dragging');
    gesture?.panel.style.removeProperty('--sidebar-drag');
    gesture = null;
  };
  const start = (event: TouchEvent) => {
    // A fresh touch is an intentional interaction, not the drag's compatibility click.
    suppressClickUntil = 0;
    if (!window.matchMedia('(max-width: 1100px)').matches || event.touches.length !== 1) return;
    const target = event.target as Element;
    if (target.closest(OWNED)) return;
    // The drawer mounts only in the narrow layout, so it is looked up when a gesture starts.
    const panel = root.querySelector<HTMLElement>('[data-responsive-sidebar]');
    if (!panel) return;
    const touch = event.touches[0];
    const bounds = root.getBoundingClientRect();
    const open = isOpen();
    if (!open && sideGestureOf({ screen: screenOf(target), x: touch.clientX - bounds.left, width: bounds.width, onRow: Boolean(target.closest(ROW_SWIPE_SELECTOR)), owned: false, overlay: overlayOpen(document, 'drawer') }) !== 'drawer') return;
    gesture = { panel, x: touch.clientX, y: touch.clientY, dx: 0, open, dragging: false };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) return reset();
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (!gesture.dragging) {
      const axis = lockAxis(dx, dy);
      if (axis === 'vertical') return reset();
      if (!axis) return;
      if ((gesture.open && dx > 0) || (!gesture.open && dx < 0)) return reset();
      gesture.dragging = true;
      gesture.panel.classList.add('is-dragging');
    }
    event.preventDefault();
    gesture.dx = dx;
    const width = gesture.panel.getBoundingClientRect().width;
    const offset = Math.max(-width, Math.min(0, (gesture.open ? 0 : -width) + dx));
    gesture.panel.style.setProperty('--sidebar-drag', `${offset}px`);
  };
  const end = () => {
    if (gesture?.dragging) {
      suppressClickUntil = performance.now() + 400;
      if (Math.abs(gesture.dx) >= SIDEBAR_SWIPE_DISTANCE) onChange(!gesture.open);
    }
    reset();
  };
  const cancel = () => {
    if (gesture?.dragging) suppressClickUntil = performance.now() + 400;
    reset();
  };
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

export function useSidebarSwipe(enabled: boolean, open: boolean, onChange: (open: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    return attachSidebarSwipe(root, { isOpen: () => open, onChange });
  }, [enabled, open, onChange]);
  return ref;
}
