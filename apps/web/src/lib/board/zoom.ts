import { BOARD_CARD_HEIGHT } from '@mygitnotes/core/compilation';
import type { Point, Rect } from './geometry.js';

/** The zoom range of a board, and the range a board opens fitted into. */
export const BOARD_ZOOM_MIN = .25;
export const BOARD_ZOOM_MAX = 2;
export const BOARD_FIT_MIN = .6;
export const BOARD_FIT_MAX = 1;
/** One press of the zoom control's − or + multiplies the zoom by this. */
export const BOARD_ZOOM_STEP = 1.25;

/** Font sizes in board units at 100%, and the smallest each may render at on screen, in CSS px. */
export const CARD_BODY_FONT = 13;
export const CARD_BODY_MIN_PX = 11;
export const CARD_TITLE_FONT = 14;
export const CARD_TITLE_MIN_PX = 12;
export const CARD_TITLE_LINE = 1.25;
export const CARD_TITLE_MAX_LINES = 3;
export const CARD_PADDING = 12;
export const SECTION_TITLE_FONT = 15;
export const SECTION_TITLE_MIN_PX = 13;
export const ARROW_LABEL_FONT = 13;
export const ARROW_LABEL_MIN_PX = 10;

export const clampZoom = (zoom: number): number => Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, zoom));

/** What a card shows at a zoom: its title and the first two lines while the body still reads at 11 px or more, else its title only. */
export const cardDetail = (zoom: number): 'full' | 'title' => CARD_BODY_FONT * zoom >= CARD_BODY_MIN_PX ? 'full' : 'title';

/**
 * How a card's title is set at a zoom, in board units: never under 12 CSS px on screen, so zoomed out it is
 * counter-scaled, wrapping to as many lines (at most three) as the card's inner height holds, at least one.
 */
export function cardTitleStyle(zoom: number): { fontSize: number; lines: number; } {
  const fontSize = Math.max(CARD_TITLE_FONT, CARD_TITLE_MIN_PX / zoom);
  const fits = Math.floor((BOARD_CARD_HEIGHT - 2 * CARD_PADDING) / (fontSize * CARD_TITLE_LINE));
  return { fontSize: Math.round(fontSize * 100) / 100, lines: Math.max(1, Math.min(CARD_TITLE_MAX_LINES, fits)) };
}

/** A section title's font size in board units: never under 13 CSS px on screen. */
export const sectionTitleSize = (zoom: number): number => Math.round(Math.max(SECTION_TITLE_FONT, SECTION_TITLE_MIN_PX / zoom) * 100) / 100;

/** Whether arrow labels show: they hide once they would render under 10 CSS px. */
export const arrowLabelsShown = (zoom: number): boolean => ARROW_LABEL_FONT * zoom >= ARROW_LABEL_MIN_PX;

/** Where the board is shown: a screen point is `board × zoom + (x, y)`, in CSS px from the viewport's top-left corner. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface Size {
  width: number;
  height: number;
}

export const boardToScreen = (camera: Camera, point: Point): Point => ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });
export const screenToBoard = (camera: Camera, point: Point): Point => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

/** The part of the board the viewport shows. */
export function visibleRect(camera: Camera, viewport: Size): Rect {
  const corner = screenToBoard(camera, { x: 0, y: 0 });
  return { x: corner.x, y: corner.y, w: viewport.width / camera.zoom, h: viewport.height / camera.zoom };
}

/** The camera at another zoom that keeps the board point under `anchor` (a screen point) where it is. */
export function zoomAround(camera: Camera, anchor: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const point = screenToBoard(camera, anchor);
  return { x: anchor.x - point.x * next, y: anchor.y - point.y * next, zoom: next };
}

/** The camera that shows the board point `centre` in the middle of the viewport at `zoom`. */
export const cameraAt = (centre: Point, zoom: number, viewport: Size): Camera => ({ x: viewport.width / 2 - centre.x * zoom, y: viewport.height / 2 - centre.y * zoom, zoom });

/** The board point in the middle of the viewport: what a saved camera keeps, so a different window size shows the same place. */
export const cameraCentre = (camera: Camera, viewport: Size): Point => screenToBoard(camera, { x: viewport.width / 2, y: viewport.height / 2 });

/**
 * The camera that fits the content into the viewport with a margin, its zoom clamped to 60%–100%. Content still
 * larger than the viewport on an axis starts at its top or left edge, where the board's reading order starts. `top`
 * is the margin above, larger where controls float over the board's top edge.
 */
export function fitCamera(content: Rect | undefined, viewport: Size, range: { min: number; max: number; } = { min: viewport.width <= 767 ? Number.EPSILON : BOARD_FIT_MIN, max: BOARD_FIT_MAX }, margin = 32, top = margin): Camera {
  if (!content || viewport.width <= 0 || viewport.height <= 0) return { x: margin, y: top, zoom: range.max };
  const zoom = Math.min(range.max, Math.max(range.min, Math.min((viewport.width - 2 * margin) / Math.max(1, content.w), (viewport.height - margin - top) / Math.max(1, content.h))));
  const axis = (start: number, size: number, room: number, before: number, after: number) => size * zoom <= room - before - after ? before + (room - before - after) / 2 - (start + size / 2) * zoom : before - start * zoom;
  return { x: axis(content.x, content.w, viewport.width, margin, margin), y: axis(content.y, content.h, viewport.height, top, margin), zoom };
}

/** The zoom one step in or out from `zoom`, landing on whole percents. */
export const steppedZoom = (zoom: number, direction: 1 | -1): number => clampZoom(Math.round(zoom * (direction > 0 ? BOARD_ZOOM_STEP : 1 / BOARD_ZOOM_STEP) * 100) / 100);
