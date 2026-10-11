import { type TouchEvent, useEffect, useRef } from 'react';
import { hasSelection, type PageStep, pagingKey, swipeStartsHere, swipeStep } from './book-paging.js';

/** The paged Book the reader last pointed at or focused: with nothing focused, ← and → turn that one's pages and not every open Book's. */
let lastBook: HTMLElement | null = null;

export interface BookPageInput {
  /** The Book reads paged; otherwise no key or touch turns anything. */
  active: boolean;
  /** The Book's frame, which the keys are limited to. */
  book: HTMLElement | null;
  /** A section of the Book edits, so a swipe is the editor's. */
  editing: boolean;
  onStep: (step: PageStep) => void;
}

/**
 * ← and → turn the page while focus is on the Book or on nothing, not in an editor, an input or a widget that moves
 * with the arrows, and not under a dialog that is not the Book's own; a horizontal swipe on the page turns it, except
 * while a section edits or text is selected (P3). Returns the touch handlers for the page body.
 */
export function useBookPageInput({ active, book, editing, onStep }: BookPageInput) {
  const step = useRef(onStep);
  useEffect(() => {
    step.current = onStep;
  });
  useEffect(() => {
    if (!active || !book) return;
    if (!lastBook?.isConnected) lastBook = book;
    const claim = () => void (lastBook = book);
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inside = target instanceof Node && book.contains(target);
      if (!inside && !(target === document.body && lastBook === book)) return;
      // A dialog over the book, the contents drawer included, owns the arrow keys; the dialog the book itself sits in does not.
      if ([...document.querySelectorAll('[aria-modal="true"]')].some(dialog => !dialog.contains(book))) return;
      const direction = pagingKey(event);
      if (!direction) return;
      event.preventDefault();
      step.current(direction);
    };
    book.addEventListener('pointerdown', claim, true);
    book.addEventListener('focusin', claim);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      book.removeEventListener('pointerdown', claim, true);
      book.removeEventListener('focusin', claim);
      document.removeEventListener('keydown', onKeyDown);
      if (lastBook === book) lastBook = null;
    };
  }, [active, book]);
  const touch = useRef<{ x: number; y: number; at: number; } | null>(null);
  if (!active) return {};
  return {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const point = event.touches[0];
      touch.current = event.touches.length === 1 && !editing && swipeStartsHere(event.target) ? { x: point.clientX, y: point.clientY, at: performance.now() } : null;
    },
    onTouchMove: (event: TouchEvent<HTMLElement>) => {
      if (event.touches.length > 1) touch.current = null;
    },
    onTouchCancel: () => void (touch.current = null),
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const start = touch.current;
      touch.current = null;
      const point = event.changedTouches[0];
      if (!start || editing || hasSelection()) return;
      const direction = swipeStep(point.clientX - start.x, point.clientY - start.y, performance.now() - start.at);
      if (direction) step.current(direction);
    },
  };
}
