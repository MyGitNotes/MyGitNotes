/** Which side of its trigger a tooltip sits on. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipPlacement {
  side: TooltipSide;
  /** The bubble's viewport position. */
  left: number;
  top: number;
  /** Where the arrow points from, measured along the bubble's edge that faces the trigger. */
  arrow: number;
}

/** The room kept between the trigger and the bubble, which the arrow spans. */
export const TOOLTIP_GAP = 8;
/** The room kept between the bubble and the viewport's edges. */
export const VIEWPORT_MARGIN = 8;
/** How near the bubble's corners the arrow may come. */
const ARROW_INSET = 8;

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Where a bubble of `size` goes beside `trigger`: on `side`, or the opposite side where `side` has no room in the
 * viewport, centred on the trigger and moved back inside the viewport along it; the arrow keeps pointing at the
 * trigger's centre.
 */
export function placeTooltip(trigger: Box, size: { width: number; height: number; }, viewport: { width: number; height: number; }, side: TooltipSide): TooltipPlacement {
  const fits = (candidate: TooltipSide) => {
    switch (candidate) {
      case 'top':
        return trigger.top - TOOLTIP_GAP - size.height >= VIEWPORT_MARGIN;
      case 'bottom':
        return trigger.top + trigger.height + TOOLTIP_GAP + size.height <= viewport.height - VIEWPORT_MARGIN;
      case 'left':
        return trigger.left - TOOLTIP_GAP - size.width >= VIEWPORT_MARGIN;
      case 'right':
        return trigger.left + trigger.width + TOOLTIP_GAP + size.width <= viewport.width - VIEWPORT_MARGIN;
    }
  };
  const chosen = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];
  if (chosen === 'top' || chosen === 'bottom') {
    const centre = trigger.left + trigger.width / 2;
    const left = clamp(centre - size.width / 2, VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - size.width);
    const top = chosen === 'top' ? trigger.top - TOOLTIP_GAP - size.height : trigger.top + trigger.height + TOOLTIP_GAP;
    return { side: chosen, left, top, arrow: clamp(centre - left, ARROW_INSET, size.width - ARROW_INSET) };
  }
  const centre = trigger.top + trigger.height / 2;
  const top = clamp(centre - size.height / 2, VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - size.height);
  const left = chosen === 'left' ? trigger.left - TOOLTIP_GAP - size.width : trigger.left + trigger.width + TOOLTIP_GAP;
  return { side: chosen, left, top, arrow: clamp(centre - top, ARROW_INSET, size.height - ARROW_INSET) };
}
