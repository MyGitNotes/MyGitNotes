import { useEffect, useRef } from 'react';

/** The longest press that still counts as a tap; a press held longer is the start of a long press that selects text. */
export const TAP_MAX_MS = 300;
/** How far a tap may drift before it counts as a scroll or a drag. */
export const TAP_SLOP_PX = 10;
/** The longest wait from the first tap's lift to the second tap's touch. */
export const DOUBLE_TAP_GAP_MS = 300;
/** How far apart the two taps may land. */
export const DOUBLE_TAP_DISTANCE_PX = 32;

export interface TapPoint {
  x: number;
  y: number;
  /** Milliseconds on any clock the caller keeps to. */
  time: number;
}

/** Reads a stream of single-finger touches as taps and says which tap completes a double tap. */
export interface DoubleTapRecognizer {
  /** A touch began; `fingers` is how many are on the screen now. */
  start: (point: TapPoint, fingers: number) => void;
  move: (point: TapPoint) => void;
  /** The touch lifted: true when it was the second tap of a double tap. */
  end: (point: TapPoint) => boolean;
  /** Forgets the touch under way and the tap before it. */
  cancel: () => void;
}

const distance = (a: { x: number; y: number; }, b: { x: number; y: number; }) => Math.hypot(a.x - b.x, a.y - b.y);

export function createDoubleTapRecognizer(): DoubleTapRecognizer {
  let press: TapPoint | null = null;
  /** Where the last tap lifted and when, while a second one may still follow. */
  let last: TapPoint | null = null;
  const cancel = () => {
    press = null;
    last = null;
  };
  return {
    start(point, fingers) {
      if (fingers !== 1) return cancel();
      if (last && point.time - last.time > DOUBLE_TAP_GAP_MS) last = null;
      press = point;
    },
    move(point) {
      if (press && distance(press, point) > TAP_SLOP_PX) cancel();
    },
    end(point) {
      const begun = press;
      press = null;
      if (!begun || point.time - begun.time > TAP_MAX_MS || distance(begun, point) > TAP_SLOP_PX) {
        last = null;
        return false;
      }
      if (last && begun.time - last.time <= DOUBLE_TAP_GAP_MS && distance(last, point) <= DOUBLE_TAP_DISTANCE_PX) {
        last = null;
        return true;
      }
      last = point;
      return false;
    },
    cancel,
  };
}

/** The text a double tap edits: the live editor's lines and the source textarea of a note's editor. */
const SURFACE = '[data-markdown-editor] .cm-content, [data-markdown-editor] textarea';
/**
 * What answers a tap itself: links (a link decoration of the live editor too), controls, media, and every CodeMirror
 * widget (CodeMirror marks a widget not editable), which covers task checkboxes, tables, directives, infographics,
 * diagrams and annotated images with their own double-click handling.
 */
const OWN_TAP = 'a, button, input, select, label, summary, img, video, audio, iframe, [role="link"], [role="button"], [role="checkbox"], [data-workspace-link], [contenteditable="false"]';

/** Whether a tap on `target` lands on a note's text, where a double tap means "edit here", rather than on something that handles it. */
export function editsOnDoubleTap(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const surface = target.closest(SURFACE);
  if (!surface) return false;
  // The live editor's own content is itself not editable while it reads; only what lies inside it counts.
  const own = target.closest(OWN_TAP);
  return !own || own === surface || !surface.contains(own);
}

/**
 * Calls `onDoubleTap` with where the second tap of a double tap landed on `element`'s note text, from inside that tap's
 * `touchend`: iOS Safari raises the keyboard only for a focus made while it dispatches the user's touch, and only on an
 * element that is editable by then. That `touchend` is cancelled, so the browser neither zooms, nor selects a word, nor
 * sends the mouse events and click that would move the caret again. Touches come from fingers and pens; a mouse never
 * sends them. A scroll between the taps, a second finger, a moved or held touch, or a tap on a link, control or
 * widget (`editsOnDoubleTap`) starts over. Returns a cleanup.
 */
export function attachDoubleTap(element: HTMLElement, onDoubleTap: (x: number, y: number) => void, accepts: (target: EventTarget | null) => boolean = editsOnDoubleTap): () => void {
  const recognizer = createDoubleTapRecognizer();
  const pointOf = (event: TouchEvent): TapPoint | null => {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY, time: event.timeStamp } : null;
  };
  const start = (event: TouchEvent) => {
    const point = pointOf(event);
    if (!point || !accepts(event.target)) return recognizer.cancel();
    recognizer.start(point, event.touches.length);
  };
  const move = (event: TouchEvent) => {
    const point = pointOf(event);
    if (point) recognizer.move(point);
  };
  const end = (event: TouchEvent) => {
    const point = pointOf(event);
    if (!point || event.touches.length > 0 || !accepts(event.target)) return recognizer.cancel();
    if (!recognizer.end(point)) return;
    event.preventDefault();
    onDoubleTap(point.x, point.y);
  };
  const cancel = () => recognizer.cancel();
  const document = element.ownerDocument;
  element.addEventListener('touchstart', start, { passive: true });
  element.addEventListener('touchmove', move, { passive: true });
  element.addEventListener('touchend', end, { passive: false });
  element.addEventListener('touchcancel', cancel);
  document.addEventListener('scroll', cancel, { capture: true, passive: true });
  return () => {
    element.removeEventListener('touchstart', start);
    element.removeEventListener('touchmove', move);
    element.removeEventListener('touchend', end);
    element.removeEventListener('touchcancel', cancel);
    document.removeEventListener('scroll', cancel, { capture: true });
  };
}

/** `attachDoubleTap` on `element` while `onDoubleTap` is given; the latest `onDoubleTap` is called. */
export function useDoubleTap(element: HTMLElement | null, onDoubleTap: ((x: number, y: number) => void) | undefined): void {
  const latest = useRef(onDoubleTap);
  useEffect(() => {
    latest.current = onDoubleTap;
  });
  const listening = Boolean(onDoubleTap);
  useEffect(() => {
    if (!element || !listening) return;
    return attachDoubleTap(element, (x, y) => latest.current?.(x, y));
  }, [element, listening]);
}
