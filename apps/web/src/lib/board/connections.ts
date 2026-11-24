import type { BoardArrow, BoardEnd } from '@mygitnotes/core/compilation';
import type { NoteGraphLink } from '@mygitnotes/core/note-graph';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { type CurvedRoute, curvedRoute, type Rect, straightRoute } from './geometry.js';
import type { PlacedBoard, PlacedCard } from './placement.js';

/** What an arrow end names on a drawn board: a card, a section or a text, by its key. */
export type BoardElementKey = `card:${string}` | `section:${string}` | `text:${string}`;

/**
 * The element an arrow end names on this board, or `undefined` when it is not drawn: a custom end names a card or
 * a section by item id, a dynamic end a card by member path (a member that left the query is kept and not drawn).
 */
export function endElement(board: PlacedBoard, end: BoardEnd): { key: BoardElementKey; rect: Rect; } | undefined {
  if ('text' in end) {
    const text = board.texts.find(candidate => candidate.id === end.text);
    return text && { key: `text:${text.id}`, rect: text.rect };
  }
  if ('path' in end) {
    const card = board.cards.find(candidate => 'path' in candidate.ref && candidate.ref.path === end.path);
    return card && { key: `card:${card.key}`, rect: card.rect };
  }
  const card = board.cards.find(candidate => 'item' in candidate.ref && candidate.ref.item === end.item);
  if (card) return { key: `card:${card.key}`, rect: card.rect };
  const section = board.sections.find(candidate => 'item' in candidate.ref && candidate.ref.item === end.item);
  return section && { key: `section:${section.key}`, rect: section.rect };
}

export interface DrawnArrow extends CurvedRoute {
  id: string;
  label?: string;
  from: BoardElementKey;
  to: BoardElementKey;
}

/** The arrows that can be drawn, routed between the nearest sides of their ends; one whose end is not on the board is kept in the file and not drawn. */
export function drawnArrows(board: PlacedBoard, arrows: readonly BoardArrow[] = []): DrawnArrow[] {
  return arrows.flatMap(arrow => {
    const from = endElement(board, arrow.from), to = endElement(board, arrow.to);
    if (!from || !to || from.key === to.key) return [];
    return [{ id: arrow.id, ...(arrow.label ? { label: arrow.label } : {}), from: from.key, to: to.key, ...curvedRoute(from.rect, to.rect) }];
  });
}

/** A dashed line between two cards whose notes link to each other, in either direction. */
export interface NoteLinkLine {
  key: string;
  /** Card keys. */
  a: string;
  b: string;
  start: { x: number; y: number; };
  end: { x: number; y: number; };
}

/** The note a card shows, by `noteRefKey`: note cards only, a heading-anchored item included. */
const noteOf = (card: PlacedCard) => card.item.kind === 'note' ? noteRefKey(card.item) : undefined;

/**
 * The dashed lines of the links written inside notes (the note graph's links, node ids being `noteRefKey`s): one per
 * pair of notes on the board, whichever direction they link, joining the first card of each note.
 */
export function noteLinkLines(cards: readonly PlacedCard[], links: readonly NoteGraphLink[]): NoteLinkLine[] {
  const first = new Map<string, PlacedCard>();
  for (const card of cards) {
    const note = noteOf(card);
    if (note && !first.has(note)) first.set(note, card);
  }
  const seen = new Set<string>();
  const lines: NoteLinkLine[] = [];
  for (const link of links) {
    if (link.source === link.target) continue;
    const a = first.get(link.source), b = first.get(link.target);
    if (!a || !b) continue;
    const key = [a.key, b.key].sort().join('\n');
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ key, a: a.key, b: b.key, ...straightRoute(a.rect, b.rect) });
  }
  return lines;
}

/** Each card's linked cards by note link, for its description: card key to the keys it is joined with. */
export function noteLinkNeighbours(lines: readonly NoteLinkLine[]): Map<string, string[]> {
  const neighbours = new Map<string, string[]>();
  for (const line of lines) {
    neighbours.set(line.a, [...neighbours.get(line.a) ?? [], line.b]);
    neighbours.set(line.b, [...neighbours.get(line.b) ?? [], line.a]);
  }
  return neighbours;
}
