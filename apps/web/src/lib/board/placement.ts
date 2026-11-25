import { BOARD_CARD_HEIGHT as CARD_H, BOARD_CARD_WIDTH as CARD_W, BOARD_SECTION_MIN_HEIGHT, BOARD_SECTION_MIN_WIDTH, type BoardText } from '@mygitnotes/core/compilation';
import { BOARD_TEXT_DEFAULT_WIDTH, type Rect, rectsOverlap, textHeight, unionRects } from './geometry.js';
import type { BoardCardEntry, BoardEntries, BoardSectionEntry } from './model.js';

/** The gap between cards, a section's inner margin, and the band its title takes above its cards. */
export const BOARD_GAP = 24;
export const SECTION_TITLE_BAND = 48;
/** The gap between the content and what auto-placement adds below or beside it. */
export const BOARD_OUTER_GAP = 72;
/** The most columns a section sized by its cards gets. */
const DERIVED_COLUMNS = 3;

export interface PlacedCard extends BoardCardEntry {
  rect: Rect;
  /** Whether the file stores this card's position; auto-placed cards are written only once the person moves them. */
  placed: boolean;
}
export interface PlacedSection extends BoardSectionEntry {
  /** The rectangle as drawn: the stored or derived one, grown to include every card of the section. */
  rect: Rect;
}
export interface PlacedText extends BoardText {
  rect: Rect;
}
export interface PlacedBoard {
  /** In item order. */
  cards: PlacedCard[];
  sections: PlacedSection[];
  texts: PlacedText[];
  /** Everything drawn, or `undefined` for an empty board. */
  bounds?: Rect;
}

const cardRect = (x: number, y: number): Rect => ({ x, y, w: CARD_W, h: CARD_H });
/** The room a card takes inside a section: its rectangle with the inner margin around it and the title band above. */
const roomOf = (card: Rect): Rect => ({ x: card.x - BOARD_GAP, y: card.y - SECTION_TITLE_BAND, w: card.w + 2 * BOARD_GAP, h: card.h + SECTION_TITLE_BAND + BOARD_GAP });
const columnsIn = (width: number) => Math.max(1, Math.floor((width - 2 * BOARD_GAP + BOARD_GAP) / (CARD_W + BOARD_GAP)));
/** A section's size when its cards decide it: up to three columns, as many rows as they need, never under the minimum. */
function derivedSize(count: number): { w: number; h: number; } {
  const columns = Math.max(1, Math.min(DERIVED_COLUMNS, count)), rows = Math.ceil(count / columns);
  return { w: Math.max(BOARD_SECTION_MIN_WIDTH, columns * CARD_W + (columns - 1) * BOARD_GAP + 2 * BOARD_GAP), h: Math.max(BOARD_SECTION_MIN_HEIGHT, SECTION_TITLE_BAND + rows * CARD_H + Math.max(0, rows - 1) * BOARD_GAP + BOARD_GAP) };
}

/**
 * Lays a board out: every card and section where the file stores it, and the rest auto-placed, deterministically
 * from the compilation's order (spec, Auto-placement):
 *
 * 1. A section with a stored rectangle flows its unplaced cards left to right in rows of its inner width, below its
 *    title band, into the slots its stored cards leave free; a dynamic folder section's size follows its cards.
 * 2. A section with no stored rectangle is drawn around its stored cards, or, with none, joins a row of sections
 *    below the content, sized to hold its cards.
 * 3. A card outside every section goes in a column grid to the right of the content, top first.
 *
 * Every section is then drawn grown to include its cards. Nothing here is written: the file changes only when the person moves something.
 */
export function placeBoard(entries: BoardEntries, texts: readonly BoardText[] = []): PlacedBoard {
  const positions = new Map<string, { rect: Rect; placed: boolean; }>();
  for (const card of entries.cards) if (card.stored) positions.set(card.key, { rect: cardRect(card.stored.x, card.stored.y), placed: true });
  const placedTexts: PlacedText[] = texts.map(text => ({ ...text, rect: { x: text.x, y: text.y, w: text.w ?? BOARD_TEXT_DEFAULT_WIDTH, h: textHeight(text.text, text.w) } }));
  const sectionRects = new Map<string, Rect>();
  const unplaced = (section: BoardSectionEntry) => section.cards.filter(key => !positions.has(key));

  // Flows a section's unplaced cards into the slots of rows of `columns`, from `top` inside its left margin, left to
  // right: a slot any card already placed overlaps is skipped, so the flow fills around the cards the file places.
  const flow = (keys: readonly string[], left: number, top: number, columns: number, taken: readonly Rect[] = []) => {
    let slot = 0;
    for (const key of keys) {
      let rect: Rect;
      do {
        rect = cardRect(left + BOARD_GAP + (slot % columns) * (CARD_W + BOARD_GAP), top + Math.floor(slot / columns) * (CARD_H + BOARD_GAP));
        slot++;
      } while (taken.some(other => rectsOverlap(other, rect)));
      positions.set(key, { rect, placed: false });
    }
  };
  const taken = () => [...positions.values()].map(card => card.rect);

  // 1. Sections the file places.
  for (const section of entries.sections) {
    if (!section.stored) continue;
    const pending = unplaced(section);
    const derived = section.stored.w === undefined || section.stored.h === undefined;
    const size = derived ? derivedSize(section.cards.length) : { w: section.stored.w!, h: section.stored.h! };
    const rect = { x: section.stored.x, y: section.stored.y, ...size };
    flow(pending, rect.x, rect.y + SECTION_TITLE_BAND, derived ? Math.max(1, Math.min(DERIVED_COLUMNS, section.cards.length)) : columnsIn(rect.w), taken());
    sectionRects.set(section.key, rect);
  }

  // 2. Sections the file does not place: around their stored cards, else in a row below the content.
  const rowed: BoardSectionEntry[] = [];
  for (const section of entries.sections) {
    if (section.stored) continue;
    const stored = section.cards.flatMap(key => positions.get(key)?.rect ?? []);
    if (!stored.length) {
      rowed.push(section);
      continue;
    }
    const around = unionRects(stored.map(roomOf))!;
    const pending = unplaced(section);
    flow(pending, around.x, around.y + around.h, Math.max(1, Math.min(DERIVED_COLUMNS, pending.length)), taken());
    sectionRects.set(section.key, around);
  }
  if (rowed.length) {
    const content = unionRects([...sectionRects.values(), ...[...positions.values()].map(card => card.rect), ...placedTexts.map(text => text.rect)]);
    let left = content?.x ?? 0;
    const top = content ? content.y + content.h + BOARD_OUTER_GAP : 0;
    for (const section of rowed) {
      const size = derivedSize(section.cards.length);
      flow(section.cards, left, top + SECTION_TITLE_BAND, Math.max(1, Math.min(DERIVED_COLUMNS, section.cards.length)), taken());
      sectionRects.set(section.key, { x: left, y: top, ...size });
      left += size.w + BOARD_GAP * 2;
    }
  }

  // 3. Cards outside every section: a column grid right of the content.
  const free = entries.cards.filter(card => !card.section && !positions.has(card.key));
  if (free.length) {
    const content = unionRects([...sectionRects.values(), ...[...positions.values()].map(card => card.rect), ...placedTexts.map(text => text.rect)]);
    const rows = content ? Math.max(1, Math.floor((content.h + BOARD_GAP) / (CARD_H + BOARD_GAP))) : Math.max(1, Math.ceil(Math.sqrt(free.length)));
    const left = content ? content.x + content.w + BOARD_OUTER_GAP : 0, top = content?.y ?? 0;
    free.forEach((card, index) => positions.set(card.key, { rect: cardRect(left + Math.floor(index / rows) * (CARD_W + BOARD_GAP), top + (index % rows) * (CARD_H + BOARD_GAP)), placed: false }));
  }

  const cards: PlacedCard[] = entries.cards.map(card => ({ ...card, ...positions.get(card.key)! }));
  const sections: PlacedSection[] = entries.sections.map(section => ({ ...section, rect: unionRects([sectionRects.get(section.key)!, ...section.cards.map(key => roomOf(positions.get(key)!.rect))])! }));
  return { cards, sections, texts: placedTexts, bounds: unionRects([...sections.map(section => section.rect), ...cards.map(card => card.rect), ...placedTexts.map(text => text.rect)]) };
}
