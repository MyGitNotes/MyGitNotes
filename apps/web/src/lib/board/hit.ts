import type { BoardElementKey } from './connections.js';
import { type Point, type Rect, rectsOverlap } from './geometry.js';
import type { PlacedBoard } from './placement.js';
import { SECTION_TITLE_BAND } from './placement.js';

const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
/** The last of a list that matches: the one drawn on top. */
const topmost = <T>(list: readonly T[], match: (value: T) => boolean): T | undefined => [...list].reverse().find(match);
const inside = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The rectangle two corners span, whichever way the pointer went. */
export const spanRect = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

/** The element drawn topmost at a board point: a text, then a card, then a section (the last drawn first), or none. */
export function elementAt(board: PlacedBoard, point: Point): BoardElementKey | undefined {
  const text = topmost(board.texts, candidate => contains(candidate.rect, point));
  if (text) return `text:${text.id}`;
  const card = topmost(board.cards, candidate => contains(candidate.rect, point));
  if (card) return `card:${card.key}`;
  const section = topmost(board.sections, candidate => contains(candidate.rect, point));
  return section && `section:${section.key}`;
}

/** Whether a board point lies on a section's title band, where a drag moves the section rather than framing a box. */
export const onSectionTitle = (board: PlacedBoard, key: string, point: Point): boolean => {
  const section = board.sections.find(candidate => candidate.key === key);
  return Boolean(section && contains({ ...section.rect, h: SECTION_TITLE_BAND }, point));
};

/**
 * What a box selection frames: every card and text it touches, and the sections it holds whole, so a box drawn
 * inside a section picks its cards and not the section around them.
 */
export function elementsInBox(board: PlacedBoard, box: Rect): BoardElementKey[] {
  return [...board.sections.filter(section => inside(box, section.rect)).map((section): BoardElementKey => `section:${section.key}`), ...board.cards.filter(card => rectsOverlap(box, card.rect)).map((card): BoardElementKey => `card:${card.key}`), ...board.texts.filter(text => rectsOverlap(box, text.rect)).map((text): BoardElementKey => `text:${text.id}`)];
}
