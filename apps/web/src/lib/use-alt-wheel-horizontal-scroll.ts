import { useEffect } from 'react';

type ElementRef = { readonly current: HTMLElement | null; };

/** How long after its last event a sideways wheel gesture keeps its scroller, as a browser latches a scroll to one element. */
const LATCH_MS = 200;

/** Whether `element` can scroll sideways: its style lets it and its content is wider than its box. */
function scrollsSideways(element: HTMLElement): boolean {
  if (element.scrollWidth <= element.clientWidth + 1) return false;
  const overflow = getComputedStyle(element).overflowX;
  return overflow === 'auto' || overflow === 'scroll';
}

/** The nearest element from the wheel's target up to `root` that matches `selector` and scrolls sideways. */
function nestedScroller(target: EventTarget | null, root: HTMLElement, selector: string): HTMLElement | null {
  for (let element = target instanceof Element ? target : null; element && element !== root && root.contains(element); element = element.parentElement) {
    if (element instanceof HTMLElement && element.matches(selector) && scrollsSideways(element)) return element;
  }
  return null;
}

/**
 * Alt+wheel scrolls `scrollerRef` sideways; `enabled` is false where it does not scroll sideways, leaving Alt+wheel to the browser.
 * With `nestedSelector`, it scrolls the nearest element under the pointer that matches the selector and scrolls sideways instead.
 *
 * Every Alt+wheel event over a scroller is cancelled, even one without vertical movement: Chrome lets a page cancel only the
 * first wheel event of a gesture, so a gesture whose first event went to the page would scroll the page as well. The gesture
 * keeps its scroller until it pauses, so its momentum and a released Alt key do not turn it into a vertical scroll midway.
 */
export function useAltWheelHorizontalScroll(targetRef: ElementRef, scrollerRef: ElementRef, nestedSelector?: string, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const target = targetRef.current;
    const scroller = scrollerRef.current;
    if (!target || !scroller) return;
    let latched: { scroller: HTMLElement; until: number; } | null = null;

    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      const now = event.timeStamp;
      const held = latched && now <= latched.until && target.contains(latched.scroller) ? latched.scroller : null;
      if (!held && !event.altKey) return;
      const activeScroller = held ?? (nestedSelector ? nestedScroller(event.target, target, nestedSelector) : scroller);
      if (!activeScroller) return;
      latched = { scroller: activeScroller, until: now + LATCH_MS };
      event.preventDefault();
      if (nestedSelector) event.stopPropagation();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? activeScroller.clientWidth : 1;
      activeScroller.scrollLeft += delta * unit;
    };

    const capture = Boolean(nestedSelector);
    target.addEventListener('wheel', wheel, { passive: false, capture });
    return () => target.removeEventListener('wheel', wheel, capture);
  }, [scrollerRef, targetRef, nestedSelector, enabled]);
}
