import type { BoardElementKey, DrawnArrow } from './connections.js';

type Translate = (key: 'board.arrowTo' | 'board.arrowToUnlabeled' | 'board.arrowFrom' | 'board.arrowFromUnlabeled' | 'board.inSection' | 'board.inNotebook' | 'board.noteLinksTo' | 'board.arrowLine' | 'board.arrowLineLabeled', values: Record<string, string>) => string;

export interface CardFacts {
  key: string;
  /** The status label, when the card's note has one. */
  status?: string;
  section?: string;
  /** The notebook's title, for a card of another notebook. */
  notebook?: string;
}

/**
 * What a focused card announces beyond its title (its button's name): status, section, notebook when it is another's,
 * its arrows (「提出 → 依據關係的因果條件」 going out, 「第三章導論 提出 →」 coming in) and the cards its note links to.
 * Colour never carries meaning alone, so every arrow and dashed note link is spelled out here.
 */
export function cardDescription(card: CardFacts, arrows: readonly DrawnArrow[], linked: readonly string[], titleOf: (key: BoardElementKey) => string, t: Translate): string {
  const self: BoardElementKey = `card:${card.key}`;
  const parts: string[] = [];
  if (card.status) parts.push(card.status);
  if (card.section) parts.push(t('board.inSection', { title: card.section }));
  if (card.notebook) parts.push(t('board.inNotebook', { title: card.notebook }));
  for (const arrow of arrows) {
    if (arrow.from === self) parts.push(arrow.label ? t('board.arrowTo', { label: arrow.label, title: titleOf(arrow.to) }) : t('board.arrowToUnlabeled', { title: titleOf(arrow.to) }));
    else if (arrow.to === self) parts.push(arrow.label ? t('board.arrowFrom', { label: arrow.label, title: titleOf(arrow.from) }) : t('board.arrowFromUnlabeled', { title: titleOf(arrow.from) }));
  }
  if (linked.length) parts.push(t('board.noteLinksTo', { titles: linked.join(', ') }));
  return parts.join('; ');
}

/** One arrow as the board's list of arrows reads it: 「第三章導論 提出 → 依據關係的因果條件」. */
export const arrowText = (arrow: DrawnArrow, titleOf: (key: BoardElementKey) => string, t: Translate): string => arrow.label ? t('board.arrowLineLabeled', { from: titleOf(arrow.from), label: arrow.label, to: titleOf(arrow.to) }) : t('board.arrowLine', { from: titleOf(arrow.from), to: titleOf(arrow.to) });
