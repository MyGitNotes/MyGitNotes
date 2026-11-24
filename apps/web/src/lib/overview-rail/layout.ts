/**
 * The overview rail's geometry, free of the DOM: where its marks sit, which headings a pointer is near, and where its popover goes.
 * Every height is in pixels: `y` within the scroller's content (what `scrollTop` counts), `top` within the rail.
 */

export type RailWidthMode = 'wide' | 'narrow';

/**
 * Below this editor width the rail is narrow. A Focus layout of three panes leaves its middle editor about 360 px, and two side by side
 * on a laptop about 560 px; there the page fills the editor and a wide minimap would take its width from the text. From 600 px the
 * page keeps a margin wide enough for the wide rail beside it.
 */
export const RAIL_NARROW_BELOW = 600;
/** The width the rail draws in: a minimap of the note's blocks when wide, a barcode of its block rows when narrow. */
export const RAIL_WIDTH: Record<RailWidthMode, number> = { wide: 56, narrow: 20 };
/** The width that takes the pointer, the rail at its right edge: a narrow rail reaches a little further into the margin. */
export const RAIL_HIT_WIDTH: Record<RailWidthMode, number> = { wide: 56, narrow: 24 };
/** The room the rail asks of the text on the scroller's right, beyond the scroller's own 16 px padding, so no text lies under it. */
export const RAIL_SPACE: Record<RailWidthMode, number> = { wide: 48, narrow: 12 };
/** The visible range's least height, so a long note still shows where the reader is. */
export const RAIL_MIN_VISIBLE = 6;

export const railWidthMode = (editorWidth: number): RailWidthMode => editorWidth < RAIL_NARROW_BELOW ? 'narrow' : 'wide';

/** The scroller's own geometry and the rail's height. */
export interface RailScroll {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  railHeight: number;
}

export interface RailHeadingAt {
  line: number;
  depth: number;
  label: string;
  /** Its top within the scroller's content. */
  y: number;
}

export interface RailInput extends RailScroll {
  headings: readonly RailHeadingAt[];
  breaks: readonly { y: number; label: string; }[];
  endLabel: string | null;
  /** The tops of find's matches, in the order find lists them. */
  matches: readonly number[];
  /** The caret's line top, or null without one. */
  cursor: number | null;
}

export interface RailHeadingMark {
  /** Its place among the note's headings. */
  index: number;
  line: number;
  depth: number;
  label: string;
  top: number;
}

export interface RailModel {
  headings: RailHeadingMark[];
  breaks: { top: number; label: string; }[];
  endLabel: string | null;
  /** Find's matches as whole rail pixels, each once. */
  matches: number[];
  cursor: number | null;
  visible: { top: number; height: number; };
}

/** The rail has nothing to show where the scroller does not scroll: the whole note is in view. */
export const railScrolls = ({ scrollHeight, clientHeight, railHeight }: RailScroll) => railHeight > 0 && scrollHeight > clientHeight + 1;

/** Scales a content height onto the rail. */
export const railTop = (y: number, { scrollHeight, railHeight }: Pick<RailScroll, 'scrollHeight' | 'railHeight'>) => scrollHeight > 0 ? Math.max(0, Math.min(railHeight, y / scrollHeight * railHeight)) : 0;

/** The visible range's height on the rail, the scrollbar thumb's: the view's share of the content, never below `RAIL_MIN_VISIBLE`. */
export const railThumbHeight = ({ scrollHeight, clientHeight, railHeight }: Omit<RailScroll, 'scrollTop'>) => Math.max(RAIL_MIN_VISIBLE, Math.min(railHeight, clientHeight / Math.max(1, scrollHeight) * railHeight));

/** The visible range's top on the rail, as a scrollbar places its thumb: the scroll's share of its range, over the track's free room. */
export function railThumbTop(scroll: RailScroll): number {
  const room = scroll.railHeight - railThumbHeight(scroll), range = scroll.scrollHeight - scroll.clientHeight;
  return room > 0 && range > 0 ? Math.max(0, Math.min(room, scroll.scrollTop / range * room)) : 0;
}

/** The scroll that puts the visible range's top at `thumbTop` on the rail, the inverse of `railThumbTop`, within the scroll's range. */
export function scrollTopForThumb(thumbTop: number, scroll: Omit<RailScroll, 'scrollTop'>): number {
  const room = scroll.railHeight - railThumbHeight(scroll), range = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  return room > 0 ? Math.max(0, Math.min(range, thumbTop / room * range)) : 0;
}

/**
 * Where a press at `top` on the rail holds the visible range, from its top: a press on it keeps the pointer where it grabbed it; a press
 * on the track brings its middle to the pointer at once, as a scrollbar's track does, and a drag from there goes on from that grip.
 */
export const railGrip = (top: number, visible: RailModel['visible']) => top >= visible.top && top <= visible.top + visible.height ? top - visible.top : visible.height / 2;

/** The rail's marks for a scroller, its content mapped onto the rail's height in proportion, as a scrollbar maps it. */
export function layoutRail(input: RailInput): RailModel {
  const at = (y: number) => railTop(y, input);
  return { headings: input.headings.map((heading, index) => ({ index, line: heading.line, depth: heading.depth, label: heading.label, top: at(heading.y) })), breaks: input.breaks.map(item => ({ top: at(item.y), label: item.label })), endLabel: input.endLabel, matches: [...new Set(input.matches.map(y => Math.round(at(y))))], cursor: input.cursor === null ? null : at(input.cursor), visible: { top: railThumbTop(input), height: railThumbHeight(input) } };
}

/** The heading whose mark lies nearest a pointer `top` on the rail, the earlier one on a tie; -1 without headings. */
export function nearestHeading(headings: readonly Pick<RailHeadingMark, 'top'>[], top: number): number {
  let best = -1;
  for (let index = 0; index < headings.length; index++) {
    if (best === -1 || Math.abs(headings[index].top - top) < Math.abs(headings[best].top - top)) best = index;
  }
  return best;
}

export interface NearbyOptions {
  /** How far from the pointer a heading counts as near, in rail pixels. */
  radius?: number;
  /** At most this many near headings, the nearest first. */
  max?: number;
  /** At least this many, neighbours in the note's order filling up the near ones. */
  min?: number;
}

export interface NearbyHeadings {
  items: RailHeadingMark[];
  /** The item the pointer is on: the nearest. */
  active: number;
}

/**
 * The headings a popover lists for a pointer `top` on the rail, in the note's order: those within `radius`, nearest first up to `max`,
 * then neighbours in order up to `min`, so a dense stretch spreads out and a sparse one still shows what lies around it.
 */
export function nearbyHeadings(headings: readonly RailHeadingMark[], top: number, { radius = 24, max = 5, min = 3 }: NearbyOptions = {}): NearbyHeadings | null {
  const nearest = nearestHeading(headings, top);
  if (nearest === -1) return null;
  let from = nearest, to = nearest;
  const distance = (index: number) => index < 0 || index >= headings.length ? Infinity : Math.abs(headings[index].top - top);
  // The marks are in the note's order and so in rail order: the near ones are one run around the nearest.
  while (to - from + 1 < max) {
    const before = distance(from - 1), after = distance(to + 1);
    if (Math.min(before, after) > radius) break;
    if (before <= after) from--;
    else to++;
  }
  for (let turn = 0; to - from + 1 < min && (from > 0 || to < headings.length - 1); turn++) {
    if ((turn % 2 === 0 || to === headings.length - 1) && from > 0) from--;
    else to++;
  }
  return { items: headings.slice(from, to + 1), active: nearest - from };
}

/** The label of the page or block holding a rail `top`: the one that ends at the next break below it, else the note's last. */
export function sectionLabelAt(model: Pick<RailModel, 'breaks' | 'endLabel'>, top: number): string | null {
  return model.breaks.find(item => item.top >= top)?.label ?? model.endLabel;
}

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PopoverPlacementInput {
  mode: RailWidthMode;
  /** The rail, in viewport coordinates. */
  rail: Box;
  /** The editor's column: the scroller. */
  column: Box;
  viewport: { width: number; height: number; };
  size: { width: number; height: number; };
  /** The viewport height the active row should meet, and that row's middle within the popover. */
  anchorY: number;
  anchorOffset: number;
  gap?: number;
  margin?: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  /** `inside` covers the column left of the rail; `outside` lies past the column's right edge. */
  side: 'inside' | 'outside';
}

/**
 * Where the popover goes. A wide rail has room in the page's margin, so the popover sits left of the rail. A narrow one lends the space
 * of the neighbour on the right, past the column, so the text being read stays clear; it turns inward only when the window has no room
 * there. Either way it never covers the rail, and its active row meets the pointer.
 */
export function placePopover({ mode, rail, column, viewport, size, anchorY, anchorOffset, gap = 12, margin = 8 }: PopoverPlacementInput): PopoverPlacement {
  const inside = Math.max(margin, rail.left - gap - size.width);
  const outside = column.right + gap;
  const fitsOutside = outside + size.width <= viewport.width - margin;
  const side = mode === 'narrow' && fitsOutside ? 'outside' : 'inside';
  const top = Math.max(margin, Math.min(anchorY - anchorOffset, viewport.height - size.height - margin));
  return { left: side === 'outside' ? outside : inside, top, side };
}
