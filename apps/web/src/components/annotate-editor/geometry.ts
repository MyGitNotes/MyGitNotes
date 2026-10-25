/**
 * The pointer and keyboard geometry of annotating, in percentages of the image box (0 at the top-left, 100 at the
 * bottom-right). Pure, so the controller and its tests share one definition of a click, a drag, a move and a resize.
 */

export interface Point {
  x: number;
  y: number;
}

export type Shape = { kind: 'pin'; x: number; y: number; } | { kind: 'region'; x: number; y: number; w: number; h: number; };

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** The smallest region a drag frames, and the smallest a resize leaves, in percent. */
export const MIN_REGION = 1;
export const STEP = 0.5;
export const BIG_STEP = 5;

const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, value));
/** Keeps arithmetic on tenths from showing float noise (10.5 + 0.5, not 10.499999). */
const tidy = (value: number): number => Math.round(value * 1000) / 1000;

export function pointToPercent(point: { clientX: number; clientY: number; }, box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): Point {
  if (!box.width || !box.height) return { x: 0, y: 0 };
  return { x: tidy(clamp((point.clientX - box.left) / box.width * 100)), y: tidy(clamp((point.clientY - box.top) / box.height * 100)) };
}

/** A press becomes a drag past 4px for a mouse and 8px for a finger, which wobbles more. */
export function exceedsThreshold(dx: number, dy: number, pointerType: string): boolean {
  return Math.hypot(dx, dy) >= (pointerType === 'touch' ? 8 : 4);
}

/** What a drag from `start` to `end` makes: a region, or a pin at `start` when it is under 1% in either dimension. */
export function dragShape(start: Point, end: Point): Shape {
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
  const w = tidy(Math.abs(start.x - end.x)), h = tidy(Math.abs(start.y - end.y));
  if (w < MIN_REGION || h < MIN_REGION) return { kind: 'pin', x: start.x, y: start.y };
  return { kind: 'region', x, y, w, h };
}

/** Moves the whole shape by a delta, stopping at the image edge. */
export function moveShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.kind === 'pin') return { kind: 'pin', x: tidy(clamp(shape.x + dx)), y: tidy(clamp(shape.y + dy)) };
  return { ...shape, x: tidy(clamp(shape.x + dx, 0, 100 - shape.w)), y: tidy(clamp(shape.y + dy, 0, 100 - shape.h)) };
}

/** Drags one corner to `point` while the opposite corner stays; dragging past it flips the region. */
export function resizeRegion(region: Extract<Shape, { kind: 'region'; }>, corner: Corner, point: Point): Shape {
  const fixedX = corner.endsWith('w') ? region.x + region.w : region.x;
  const fixedY = corner.startsWith('n') ? region.y + region.h : region.y;
  let x = Math.min(fixedX, point.x), y = Math.min(fixedY, point.y);
  let w = Math.max(MIN_REGION, tidy(Math.abs(fixedX - point.x))), h = Math.max(MIN_REGION, tidy(Math.abs(fixedY - point.y)));
  // A region held to the minimum keeps its fixed corner and grows away from it.
  if (point.x < fixedX && w === MIN_REGION) x = fixedX - MIN_REGION;
  if (point.y < fixedY && h === MIN_REGION) y = fixedY - MIN_REGION;
  if (point.x >= fixedX) x = fixedX;
  if (point.y >= fixedY) y = fixedY;
  x = tidy(clamp(x, 0, 100 - MIN_REGION));
  y = tidy(clamp(y, 0, 100 - MIN_REGION));
  w = Math.min(w, tidy(100 - x));
  h = Math.min(h, tidy(100 - y));
  return { kind: 'region', x, y, w, h };
}

const ARROWS: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

export const isArrowKey = (key: string): boolean => key in ARROWS;

/** An arrow key's effect: a move, or with Alt a resize of a region (right and down grow it); Shift takes the big step. */
export function nudgeShape(shape: Shape, key: string, modifiers: { shift: boolean; alt: boolean; }): Shape {
  const direction = ARROWS[key];
  if (!direction) return shape;
  const step = modifiers.shift ? BIG_STEP : STEP;
  if (modifiers.alt) {
    if (shape.kind !== 'region') return shape;
    return { ...shape, w: tidy(clamp(shape.w + direction.x * step, MIN_REGION, 100 - shape.x)), h: tidy(clamp(shape.h + direction.y * step, MIN_REGION, 100 - shape.y)) };
  }
  return moveShape(shape, direction.x * step, direction.y * step);
}
