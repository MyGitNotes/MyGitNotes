import { useEffect, useState } from 'react';

/** What counts as the person being at the page: any of these on the window wakes it. */
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin'] as const;

/** True once nothing has moved, pressed, typed or scrolled in the page for `ms`; false again at the next such event. */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), ms);
    const wake = () => {
      clearTimeout(timer);
      setIdle(false);
      timer = setTimeout(() => setIdle(true), ms);
    };
    for (const type of ACTIVITY) window.addEventListener(type, wake, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      for (const type of ACTIVITY) window.removeEventListener(type, wake, { capture: true });
    };
  }, [ms]);
  return idle;
}
