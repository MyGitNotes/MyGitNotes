import { type MouseEvent, type TouchEvent, useEffect, useRef } from 'react';
import { createHoldRecognizer, type HoldRecognizer } from './hold.js';

/** How long after a hold the browser's compatibility click, which would open what was held, is swallowed. */
const CLICK_GUARD_MS = 500;

/**
 * Touch handlers that read a finger resting on an element as a hold (`createHoldRecognizer`) and call `onHold`, leaving every other touch
 * to the element: a tap still clicks, a move is still a pan or a drag. After a hold, the click its lift sends and the browser's own long
 * press menu are swallowed.
 */
export function useHold(onHold: (() => void) | undefined) {
  const callback = useRef(onHold);
  /* eslint-disable react/refs -- Keep the current callback in a ref for the recognizer's timer without recreating it. */
  callback.current = onHold;
  /* eslint-enable react/refs */
  const guardUntil = useRef(0);
  const recognizer = useRef<HoldRecognizer>();
  useEffect(() => {
    const hold = createHoldRecognizer(() => {
      guardUntil.current = performance.now() + CLICK_GUARD_MS;
      callback.current?.();
    });
    recognizer.current = hold;
    return () => {
      hold.cancel();
      recognizer.current = undefined;
    };
  }, []);
  if (!onHold) return {};
  const point = (event: TouchEvent) => ({ x: event.touches[0].clientX, y: event.touches[0].clientY });
  return {
    onTouchStart: (event: TouchEvent) => {
      guardUntil.current = 0;
      recognizer.current?.start(point(event), event.touches.length);
    },
    onTouchMove: (event: TouchEvent) => {
      if (event.touches.length !== 1) recognizer.current?.cancel();
      else recognizer.current?.move(point(event));
    },
    onTouchEnd: () => recognizer.current?.cancel(),
    onTouchCancel: () => recognizer.current?.cancel(),
    onClickCapture: (event: MouseEvent) => {
      if (performance.now() >= guardUntil.current) return;
      guardUntil.current = 0;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event: MouseEvent) => {
      if (!recognizer.current?.pending && performance.now() >= guardUntil.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
