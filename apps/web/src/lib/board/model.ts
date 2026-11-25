import type { CompilationBoard, CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';

/** What a card or section names in the file: a custom compilation's item id, a dynamic member's path, a folder chapter's folder. */
export type CardRef = { item: string; } | { path: string; };
export type SectionRef = { item: string; } | { folder: string; };

/** One card to draw: its item as the lane shows it, and the position the file stores for it, if any. */
export interface BoardCardEntry {
  /** The item's id: a custom item's own, a dynamic member's derived one. */
  key: string;
  item: Exclude<CompilationItem, { kind: 'heading'; }>;
  ref: CardRef;
  /** The section (chapter heading id) the card belongs to; none before the first heading or without chapters. */
  section?: string;
  stored?: { x: number; y: number; };
}

/** One section to draw: a chapter, with the rectangle the file stores for it, if any. */
export interface BoardSectionEntry {
  /** The chapter heading's id. */
  key: string;
  title: string;
  ref: SectionRef;
  /** A custom section stores its size; a dynamic folder section stores only its position, its size following its cards. */
  stored?: { x: number; y: number; w?: number; h?: number; };
  cards: string[];
}

export interface BoardEntries {
  /** Every card, in the item order: the book's order. */
  cards: BoardCardEntry[];
  sections: BoardSectionEntry[];
}

const directory = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/**
 * The cards and sections of a compilation's board, from the items it shows (`compilationRowItems`, headings
 * included) and the positions its `board` stores. A custom compilation names cards and sections by item id; a dynamic
 * one names cards by member path and, grouped by folder, sections by the folder its chapter holds.
 */
export function boardEntries(row: CompilationRow, items: readonly CompilationItem[]): BoardEntries {
  const board: CompilationBoard = row.board ?? {};
  const custom = row.kind === 'custom';
  const storedCards = new Map((board.cards ?? []).map(card => ['item' in card ? `item:${card.item}` : `path:${card.path}`, { x: card.x, y: card.y }]));
  const storedSections = new Map((board.sections ?? []).map(section => ['item' in section ? `item:${section.item}` : `folder:${section.folder}`, 'item' in section ? { x: section.x, y: section.y, w: section.w, h: section.h } : { x: section.x, y: section.y }]));
  const cards: BoardCardEntry[] = [];
  const sections: BoardSectionEntry[] = [];
  let current: BoardSectionEntry | undefined;
  for (const item of items) {
    if (item.kind === 'heading') {
      // A dynamic compilation has sections only when it groups by folder; its heading ids are derived and stored by nothing.
      if (!custom && row.group !== 'folder') {
        current = undefined;
        continue;
      }
      current = { key: item.id, title: item.title, ref: custom ? { item: item.id } : { folder: '' }, cards: [] };
      sections.push(current);
      continue;
    }
    const ref: CardRef = custom || item.kind === 'youtube' ? { item: item.id } : { path: item.path };
    const stored = storedCards.get('item' in ref ? `item:${ref.item}` : `path:${ref.path}`);
    cards.push({ key: item.id, item, ref, ...(current ? { section: current.key } : {}), ...(stored ? { stored } : {}) });
    if (current) {
      current.cards.push(item.id);
      // A folder chapter holds the members of one folder: the first member names it.
      if ('folder' in current.ref && !current.ref.folder && item.kind !== 'youtube') current.ref = { folder: directory(item.path) };
    }
  }
  for (const section of sections) {
    const stored = storedSections.get('item' in section.ref ? `item:${section.ref.item}` : `folder:${section.ref.folder}`);
    if (stored) section.stored = stored;
  }
  return { cards, sections };
}
