import { useEffect, useState } from 'react';

/** How far the text must scroll in one direction, in px, before the bar follows it. */
const SCROLL_STEP = 12;
/** The bar stays until the text has scrolled past its own height. */
export const PHONE_BAR_HEIGHT = 44;

/**
 * Whether a phone's note title bar is tucked away: it hides as the text scrolls down and returns as soon as it scrolls back up or reaches the top.
 * It listens to every scroller inside `root`'s note body, since live preview and source mode scroll different elements.
 */
export function usePhoneBarHidden(root: HTMLElement | null, enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!root || !enabled) return;
    const last = new WeakMap<Element, { top: number; anchor: number; direction: number; }>();
    const onScroll = (event: Event) => {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement) || !scroller.closest('.note-editor-body')) return;
      const { scrollTop } = scroller;
      const previous = last.get(scroller) ?? { top: scrollTop, anchor: scrollTop, direction: 0 };
      const direction = Math.sign(scrollTop - previous.top);
      // A change of direction restarts the distance the text has to travel.
      const anchor = direction !== 0 && direction !== previous.direction ? previous.top : previous.anchor;
      last.set(scroller, { top: scrollTop, anchor, direction: direction || previous.direction });
      if (scrollTop <= 0) setHidden(false);
      else if (direction > 0 && scrollTop > PHONE_BAR_HEIGHT && scrollTop - anchor >= SCROLL_STEP) setHidden(true);
      else if (direction < 0 && anchor - scrollTop >= SCROLL_STEP) setHidden(false);
    };
    root.addEventListener('scroll', onScroll, true);
    return () => {
      root.removeEventListener('scroll', onScroll, true);
      setHidden(false);
    };
  }, [root, enabled]);
  return hidden;
}
