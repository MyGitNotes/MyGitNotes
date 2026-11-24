/** A rectangle in board units: its top-left corner and size. One unit is one CSS pixel at 100%. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

/** The smallest rectangle holding every given one, or `undefined` for none. */
export function unionRects(rects: readonly Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map(rect => rect.x)), top = Math.min(...rects.map(rect => rect.y));
  const right = Math.max(...rects.map(rect => rect.x + rect.w)), bottom = Math.max(...rects.map(rect => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Whether two rectangles share any area; touching edges do not overlap. */
export const rectsOverlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const rectCentre = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

/** The rectangle grown by `by` units on every side. */
export const inflate = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by });

type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
const NORMALS: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

function sideMidpoint(rect: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.w / 2, y: rect.y };
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    case 'bottom':
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case 'left':
      return { x: rect.x, y: rect.y + rect.h / 2 };
  }
}

/** A line between two elements, leaving one side of each: where it starts and ends, and the outward direction at each end. */
export interface SideRoute {
  start: Point;
  end: Point;
  startNormal: Point;
  endNormal: Point;
}

/**
 * The nearest pair of sides between two rectangles: of the side midpoints that face the other rectangle, the pair
 * closest together. Rectangles that overlap so no side faces the other fall back to the closest pair of all.
 */
export function nearestSides(from: Rect, to: Rect): SideRoute {
  const facing = (rect: Rect, side: Side, other: Rect) => {
    const point = sideMidpoint(rect, side), centre = rectCentre(other), normal = NORMALS[side];
    return (centre.x - point.x) * normal.x + (centre.y - point.y) * normal.y > 0;
  };
  let best: { route: SideRoute; distance: number; facing: boolean; } | undefined;
  for (const a of SIDES) {
    for (const b of SIDES) {
      const start = sideMidpoint(from, a), end = sideMidpoint(to, b);
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const faces = facing(from, a, to) && facing(to, b, from);
      if (!best || (faces && !best.facing) || (faces === best.facing && distance < best.distance)) best = { route: { start, end, startNormal: NORMALS[a], endNormal: NORMALS[b] }, distance, facing: faces };
    }
  }
  return best!.route;
}

/** A drawn arrow: its SVG path, the point its label sits on, and the end its arrowhead points into. */
export interface CurvedRoute {
  path: string;
  middle: Point;
  end: Point;
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * A curve from one rectangle to another between their nearest sides: a cubic Bézier leaving each side along its
 * outward normal, with no bend points. The label sits on the curve's middle (t = 0.5).
 */
export function curvedRoute(from: Rect, to: Rect): CurvedRoute {
  const { start, end, startNormal, endNormal } = nearestSides(from, to);
  const reach = Math.max(24, Math.min(160, Math.hypot(end.x - start.x, end.y - start.y) / 2));
  const c1 = { x: start.x + startNormal.x * reach, y: start.y + startNormal.y * reach };
  const c2 = { x: end.x + endNormal.x * reach, y: end.y + endNormal.y * reach };
  const middle = { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 };
  return { path: `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`, middle, end };
}

/** A straight line between the nearest sides of two rectangles, as a dashed note link is drawn. */
export function straightRoute(from: Rect, to: Rect): { start: Point; end: Point; } {
  const { start, end } = nearestSides(from, to);
  return { start, end };
}

/** Free text's font size and line height in board units; it scales with the board. */
export const BOARD_TEXT_FONT = 16;
export const BOARD_TEXT_LINE = 1.45;
export const BOARD_TEXT_PADDING = 8;
export const BOARD_TEXT_DEFAULT_WIDTH = 240;

/** Whether a code point draws about one em wide: Hangul Jamo, CJK, Hangul syllables, compatibility ideographs and full-width forms. */
const WIDE_RANGES: readonly [number, number][] = [[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd]];
const wide = (code: number) => WIDE_RANGES.some(([low, high]) => code >= low && code <= high);

/**
 * An estimate of how tall free text draws at its width, for bounds, the minimap and placement: CJK and other wide
 * characters take one em, others about half, and each line wraps at the inner width.
 */
export function textHeight(text: string, width = BOARD_TEXT_DEFAULT_WIDTH): number {
  const inner = Math.max(1, width - 2 * BOARD_TEXT_PADDING);
  const lines = text.split('\n').reduce((sum, line) => {
    const ems = [...line].reduce((total, character) => total + (wide(character.codePointAt(0)!) ? 1 : .55), 0);
    return sum + Math.max(1, Math.ceil(ems * BOARD_TEXT_FONT / inner));
  }, 0);
  return Math.ceil(lines * BOARD_TEXT_FONT * BOARD_TEXT_LINE + 2 * BOARD_TEXT_PADDING);
}
