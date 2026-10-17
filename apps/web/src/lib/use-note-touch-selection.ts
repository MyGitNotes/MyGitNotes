import { useEffect, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { LONG_PRESS_MS, shouldCancelLongPress } from './use-long-press.js';
import { isSelectionClick } from './note-selection.js';
import { startTouchNoteDrag, type TouchNoteDrag } from './touch-note-drag.js';

// A browser lets a touch's moves be cancelled only if a non-passive touchmove listener existed when the touch began,
// and a lift adds its own only later; this one keeps every touch cancellable, as dnd-kit's TouchSensor does.
if (typeof window !== 'undefined') window.addEventListener('touchmove', () => {}, { passive: false });

/**
 * Long-press a browse note to start selection, following FolderTree's touch convention. When the note can move, the
 * long press lifts it instead: moving the finger then drags it onto a folder (see `touch-note-drag`), and releasing
 * without moving selects it.
 */
export function useNoteTouchSelection(onToggleSelect?: (note: NoteListItem) => void, canMove = false) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number; }>();
  const endLift = useRef<() => void>();
  const suppressedPath = useRef<string>();
  const suppressionTimer = useRef<ReturnType<typeof setTimeout>>();
  const swallowClick = useRef<(event: globalThis.MouseEvent) => void>();

  const clearSuppression = () => {
    if (swallowClick.current) window.removeEventListener('click', swallowClick.current, true);
    swallowClick.current = undefined;
    suppressedPath.current = undefined;
    if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    suppressionTimer.current = undefined;
  };

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  };

  useEffect(() => () => {
    endLift.current?.();
    if (timer.current) clearTimeout(timer.current);
    if (suppressionTimer.current) clearTimeout(suppressionTimer.current);
    if (swallowClick.current) window.removeEventListener('click', swallowClick.current, true);
  }, []);

  /** Swallows the click a browser sends after a touch the long press already handled. */
  const suppressClick = (note: NoteListItem) => {
    clearSuppression();
    suppressedPath.current = note.path;
    swallowClick.current = event => {
      event.preventDefault();
      event.stopPropagation();
      clearSuppression();
    };
    window.addEventListener('click', swallowClick.current, true);
    suppressionTimer.current = setTimeout(clearSuppression, 500);
  };

  /**
   * Holds a lifted note until its finger moves (a drag) or lets go (a selection); the page does not scroll meanwhile.
   * The finger's events are followed on the node it touched, which keeps receiving them even if a refresh removes the
   * row, and stop there so the sidebar's swipe does not take the drag for a swipe.
   */
  const lift = (note: NoteListItem, element: Element | undefined, finger: EventTarget, id: number, from: { x: number; y: number; }) => {
    let drag: TouchNoteDrag | undefined;
    const ours = (touches: TouchList) => Array.from(touches).find(touch => touch.identifier === id);
    element?.classList.add('is-lifted');
    const onMove = (event: Event) => {
      const touch = ours((event as globalThis.TouchEvent).touches);
      if (!touch) return;
      event.preventDefault();
      event.stopPropagation();
      if (!drag && !shouldCancelLongPress(from, { x: touch.clientX, y: touch.clientY })) return;
      drag ??= startTouchNoteDrag({ notebookId: note.notebookId, path: note.path }, note.title, touch.clientX, touch.clientY);
      drag.move(touch.clientX, touch.clientY);
    };
    const finish = (event: Event, released: boolean) => {
      if (!ours((event as globalThis.TouchEvent).changedTouches)) return;
      const dragged = drag;
      drag = undefined;
      endLift.current?.();
      if (dragged && released) dragged.drop();
      else if (dragged) dragged.cancel();
      else {
        if (released) onToggleSelect?.(note);
        // Only a touch that did not move is followed by a click.
        suppressClick(note);
      }
    };
    const onEnd = (event: Event) => finish(event, true);
    const onCancel = (event: Event) => finish(event, false);
    endLift.current = () => {
      drag?.cancel();
      drag = undefined;
      element?.classList.remove('is-lifted');
      finger.removeEventListener('touchmove', onMove);
      finger.removeEventListener('touchend', onEnd);
      finger.removeEventListener('touchcancel', onCancel);
      endLift.current = undefined;
    };
    finger.addEventListener('touchmove', onMove, { passive: false });
    finger.addEventListener('touchend', onEnd);
    finger.addEventListener('touchcancel', onCancel);
  };

  const onTouchStart = (note: NoteListItem, event: TouchEvent) => {
    cancel();
    endLift.current?.();
    if (!onToggleSelect && !canMove || event.touches.length !== 1 || (event.target as Element).closest('button, input, select, a')) return;
    const touch = event.touches[0];
    const from = { x: touch.clientX, y: touch.clientY };
    const element = event.currentTarget instanceof Element ? event.currentTarget : undefined;
    const finger = event.target;
    start.current = from;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (canMove) return lift(note, element, finger, touch.identifier, from);
      onToggleSelect?.(note);
      suppressClick(note);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch || !start.current || shouldCancelLongPress(start.current, { x: touch.clientX, y: touch.clientY })) cancel();
  };

  const consumeClick = (note: NoteListItem) => {
    if (suppressedPath.current !== note.path) return false;
    clearSuppression();
    return true;
  };

  const onContextMenu = (event: MouseEvent) => {
    if (timer.current || suppressedPath.current || endLift.current) event.preventDefault();
  };

  /** Pointer handlers for one browse item: a plain click opens it, a modifier click or long press toggles its selection unless `selectable` is false. */
  const itemProps = (note: NoteListItem, onOpen: (note: NoteListItem) => void, selectable = true) => ({
    onClick: (event: MouseEvent) => consumeClick(note) ? event.preventDefault() : selectable && isSelectionClick(event) ? onToggleSelect?.(note) : onOpen(note),
    onTouchStart: (event: TouchEvent) => {
      if (selectable) onTouchStart(note, event);
    },
    onTouchMove,
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onContextMenu,
  });

  return { onTouchStart, onTouchMove, onTouchEnd: cancel, onTouchCancel: cancel, consumeClick, onContextMenu, itemProps };
}
