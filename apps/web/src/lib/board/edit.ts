import { addToChapter, BOARD_COORDINATE_LIMIT, BOARD_MAX_ARROWS, BOARD_MAX_SECTIONS, BOARD_MAX_TEXTS, BOARD_SECTION_MIN_HEIGHT, BOARD_SECTION_MIN_WIDTH, type BoardArrow, type BoardCard, type BoardEnd, type BoardSection, type BoardText, type CompilationBoard, type CompilationItem, type CompilationRow } from '@mygitnotes/core/compilation';
import type { BoardElementKey } from './connections.js';
import { type Point, type Rect, rectCentre, unionRects } from './geometry.js';
import type { CardRef, SectionRef } from './model.js';
import { type PlacedBoard, type PlacedCard, roomOf } from './placement.js';

/** What a person selects on a board: a card, a section, a text or an arrow, by key. */
export type BoardSelectionKey = BoardElementKey | `arrow:${string}`;
/** Why an edit was refused, kept or partly kept; each has a message for the person. */
export type BoardRefusal = 'dynamicSections' | 'folderSection' | 'sectionLimit' | 'textLimit' | 'arrowLimit' | 'arrowEnds' | 'itemLimit' | 'dynamicItems';
/** An edit's result: the row to write (the same row when nothing changed) and, when the board refused some or all of it, why. */
export interface BoardEdit {
  row: CompilationRow;
  refused?: BoardRefusal;
}

/** The longest section title (a chapter heading's), text and arrow label the file keeps. */
export const SECTION_TITLE_MAX = 100;
export const TEXT_MAX = 2000;
export const ARROW_LABEL_MAX = 60;

/** The kind and id of a selection key: `card:n1` is a card of item (or member) `n1`. */
export function splitKey(key: BoardSelectionKey): { kind: 'card' | 'section' | 'text' | 'arrow'; id: string; } {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at) as 'card' | 'section' | 'text' | 'arrow', id: key.slice(at + 1) };
}
function keysOf(selection: Iterable<BoardSelectionKey>) {
  const ids = { card: new Set<string>(), section: new Set<string>(), text: new Set<string>(), arrow: new Set<string>() };
  for (const key of selection) {
    const { kind, id } = splitKey(key);
    ids[kind].add(id);
  }
  return ids;
}

const coordinate = (value: number) => Math.max(-BOARD_COORDINATE_LIMIT, Math.min(BOARD_COORDINATE_LIMIT, Math.round(value)));
const shifted = (rect: Rect, dx: number, dy: number): Rect => ({ ...rect, x: rect.x + dx, y: rect.y + dy });
const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
const sameRef = (a: CardRef | SectionRef | BoardCard | BoardSection, b: CardRef | SectionRef) => ('item' in a && 'item' in b && a.item === b.item) || ('path' in a && 'path' in b && a.path === b.path) || ('folder' in a && 'folder' in b && a.folder === b.folder);
const endKey = (end: BoardEnd) => 'item' in end ? `item:${end.item}` : 'path' in end ? `path:${end.path}` : `text:${end.text}`;

/** A section rectangle as the file keeps it: whole units inside the board's range, never under the minimum size. */
export function sectionFrame(rect: Rect): Rect {
  const extent = (value: number, min: number) => Math.min(2 * BOARD_COORDINATE_LIMIT, Math.max(min, Math.round(value)));
  return { x: coordinate(rect.x), y: coordinate(rect.y), w: extent(rect.w, BOARD_SECTION_MIN_WIDTH), h: extent(rect.h, BOARD_SECTION_MIN_HEIGHT) };
}

/** The row with another board; empty lists are left out, so a board emptied by edits writes no `cards: []`. */
function withBoard(row: CompilationRow, board: CompilationBoard): CompilationRow {
  const { sections, cards, texts, arrows } = board;
  return { ...row, board: { ...(sections?.length ? { sections } : {}), ...(cards?.length ? { cards } : {}), ...(texts?.length ? { texts } : {}), ...(arrows?.length ? { arrows } : {}) } };
}
const withItems = (row: CompilationRow, items: CompilationItem[]): CompilationRow => row.kind === 'custom' ? { ...row, items } : row;

/** The board's cards with each given card's position written: replaced where the file has it, else added. */
function writeCards(cards: readonly BoardCard[] = [], moves: readonly { ref: CardRef; x: number; y: number; }[]): BoardCard[] {
  const next = [...cards];
  for (const move of moves) {
    const entry = { ...move.ref, x: coordinate(move.x), y: coordinate(move.y) } as BoardCard;
    const at = next.findIndex(card => sameRef(card, move.ref));
    if (at >= 0) next[at] = entry;
    else next.push(entry);
  }
  return next;
}
function writeSection(sections: readonly BoardSection[] = [], ref: SectionRef, rect: Rect): BoardSection[] {
  const frame = sectionFrame(rect);
  const entry: BoardSection = 'item' in ref ? { item: ref.item, ...frame } : { folder: ref.folder, x: frame.x, y: frame.y };
  const at = sections.findIndex(section => sameRef(section, ref));
  return at >= 0 ? sections.map((section, index) => index === at ? entry : section) : [...sections, entry];
}
/** The cards drawn where they are, written: auto-placed cards would move once their chapter changes. */
const pinned = (cards: readonly PlacedCard[]) => cards.map(card => ({ ref: card.ref, x: card.rect.x, y: card.rect.y }));

/** The items with `moving` taken out and put ahead of the first heading, in their order: in no chapter. */
function beforeFirstHeading(items: readonly CompilationItem[], moving: ReadonlySet<string>): CompilationItem[] {
  const kept = items.filter(item => !moving.has(item.id));
  const first = kept.findIndex(item => item.kind === 'heading');
  const at = first < 0 ? kept.length : first;
  return [...kept.slice(0, at), ...items.filter(item => moving.has(item.id)), ...kept.slice(at)];
}

/** The section a card centred at `point` lands in: its own when it still holds it, else the last drawn (topmost) one. */
function landing(sections: readonly { key: string; rect: Rect; }[], point: Point, current?: string): string | undefined {
  const holding = sections.filter(section => contains(section.rect, point));
  if (current && holding.some(section => section.key === current)) return current;
  return holding.at(-1)?.key;
}

/**
 * Moves the selected cards, sections and texts by (dx, dy) board units; a section carries its cards. A card dropped
 * in another section moves its item to the end of that chapter, one dropped outside every section ahead of the first
 * heading, and one moved inside its section only changes position (spec, Chapters, sections and order). On a dynamic
 * board grouped by folder a card cannot leave its folder's section: it stays where it was (`folderSection`), unless
 * `preview` asks for the drag's look, where it follows the pointer. Every moved card's position is written, auto-placed ones included.
 */
export function moveSelection(row: CompilationRow, placed: PlacedBoard, selection: Iterable<BoardSelectionKey>, dx: number, dy: number, { preview = false }: { preview?: boolean; } = {}): BoardEdit {
  const x = Math.round(dx), y = Math.round(dy);
  if (!x && !y) return { row };
  const ids = keysOf(selection);
  const carriers = new Set(placed.sections.filter(section => ids.section.has(section.key)).map(section => section.key));
  const carried = (card: PlacedCard) => card.section !== undefined && carriers.has(card.section);
  const direct = placed.cards.filter(card => ids.card.has(card.key) && !carried(card));
  const directKeys = new Set(direct.map(card => card.key));
  // Where each section takes a card after the move: its frame, grown by the cards that stay in it (a carried card moves with it).
  const shiftIf = (moving: boolean, rect: Rect) => moving ? shifted(rect, x, y) : rect;
  const hits = placed.sections.map(section => ({ key: section.key, rect: unionRects([shiftIf(carriers.has(section.key), section.frame), ...placed.cards.filter(card => card.section === section.key && !directKeys.has(card.key)).map(card => shiftIf(carriers.has(section.key), roomOf(card.rect)))])! }));
  let refused: BoardRefusal | undefined;
  const moves: PlacedCard[] = placed.cards.filter(carried);
  const chapters: { card: PlacedCard; to?: string; }[] = [];
  for (const card of direct) {
    const to = landing(hits, rectCentre(shifted(card.rect, x, y)), card.section);
    if (to !== card.section) {
      if (row.kind === 'dynamic') {
        if (!preview) {
          refused = 'folderSection';
          continue;
        }
      } else chapters.push({ card, ...(to ? { to } : {}) });
    }
    moves.push(card);
  }

  const board = row.board ?? {};
  let sections = board.sections;
  for (const section of placed.sections) {
    if (!carriers.has(section.key) || ('folder' in section.ref && !section.ref.folder)) continue;
    sections = writeSection(sections, section.ref, shifted(section.frame, x, y));
  }
  // A dynamic member has no item: a card naming one cannot be written there.
  const cards = writeCards(board.cards, moves.filter(card => row.kind === 'custom' || 'path' in card.ref).map(card => ({ ref: card.ref, x: card.rect.x + x, y: card.rect.y + y })));
  const texts = board.texts?.map(text => ids.text.has(text.id) ? { ...text, x: coordinate(text.x + x), y: coordinate(text.y + y) } : text);

  let next = withBoard(row, { ...board, ...(sections ? { sections } : {}), cards, ...(texts ? { texts } : {}) });
  if (row.kind === 'custom' && chapters.length) {
    const order = new Map(row.items.map((item, index) => [item.id, index]));
    chapters.sort((a, b) => order.get(a.card.key)! - order.get(b.card.key)!);
    const leaving = new Set(chapters.filter(move => !move.to).map(move => move.card.key));
    const joining = chapters.filter(move => move.to);
    let items = beforeFirstHeading(row.items.filter(item => !joining.some(move => move.card.key === item.id)), leaving);
    for (const move of joining) items = addToChapter(items, row.items.find(item => item.id === move.card.key)!, move.to);
    next = withItems(next, items);
  }
  return { row: next, ...(refused ? { refused } : {}) };
}

/**
 * Creates a section from a dragged rectangle (stored grown to the minimum size): a heading item at the end of the
 * items, titled `title`, whose chapter takes the items of the cards centred inside the drawn rectangle, in their order (`addToChapter`
 * per item). Those cards are written where they are drawn, so they do not move. Only a custom board has headings.
 */
export function createSection(row: CompilationRow, placed: PlacedBoard, rect: Rect, { id, title }: { id: string; title: string; }): BoardEdit {
  if (row.kind !== 'custom') return { row, refused: 'dynamicSections' };
  if (row.items.filter(item => item.kind === 'heading').length >= BOARD_MAX_SECTIONS) return { row, refused: 'sectionLimit' };
  const frame = sectionFrame(rect);
  // The cards join by the rectangle drawn; only the stored frame grows to the minimum size.
  const inside = placed.cards.filter(card => contains(rect, rectCentre(card.rect)));
  const joining = new Set(inside.map(card => card.key));
  let items: CompilationItem[] = [...row.items.filter(item => !joining.has(item.id)), { id, kind: 'heading', title: title.trim().slice(0, SECTION_TITLE_MAX) }];
  for (const item of row.items) if (joining.has(item.id)) items = addToChapter(items, item, id);
  const board = row.board ?? {};
  return { row: withItems(withBoard(row, { ...board, sections: writeSection(board.sections, { item: id }, frame), cards: writeCards(board.cards, pinned(inside)) }), items) };
}

/** Resizes a custom section to a rectangle (whole units, never under the minimum); its chapter does not change. */
export function resizeSection(row: CompilationRow, key: string, rect: Rect): BoardEdit {
  if (row.kind !== 'custom') return { row, refused: 'dynamicSections' };
  if (!row.items.some(item => item.id === key && item.kind === 'heading')) return { row };
  const board = row.board ?? {};
  return { row: withBoard(row, { ...board, sections: writeSection(board.sections, { item: key }, rect) }) };
}

/** Retitles a custom section, which retitles its chapter; an empty title keeps the old one. */
export function renameSection(row: CompilationRow, key: string, title: string): BoardEdit {
  if (row.kind !== 'custom') return { row, refused: 'dynamicSections' };
  const value = title.trim().slice(0, SECTION_TITLE_MAX).trim();
  const heading = row.items.find(item => item.id === key && item.kind === 'heading');
  if (!heading || heading.kind !== 'heading' || !value || value === heading.title) return { row };
  return { row: withItems(row, row.items.map(item => item.id === key ? { ...heading, title: value } : item)) };
}

/**
 * Removes the selection from the board: a card's item leaves the compilation (the note stays); a section's heading
 * goes and its items move ahead of the first heading, in no chapter, their cards staying where they are drawn; a
 * text or an arrow goes. Every arrow that ends on something removed goes in the same edit. A dynamic board's cards
 * and folder sections come from its query and stay.
 */
export function removeSelection(row: CompilationRow, placed: PlacedBoard, selection: Iterable<BoardSelectionKey>): BoardEdit {
  const ids = keysOf(selection);
  const board = row.board ?? {};
  const gone = new Set<string>();
  let items = row.kind === 'custom' ? row.items : undefined;
  let cards = board.cards;
  let sections = board.sections;
  if (items) {
    const removedSections = placed.sections.filter(section => ids.section.has(section.key));
    const headings = new Set(removedSections.map(section => section.key));
    // A section's cards stay on the board when it goes, even when the selection (a box around the section) holds them too.
    const removedCards = new Set(placed.cards.filter(card => ids.card.has(card.key) && !(card.section !== undefined && headings.has(card.section))).map(card => card.key));
    const orphans = removedSections.flatMap(section => placed.cards.filter(card => card.section === section.key && !removedCards.has(card.key)));
    items = beforeFirstHeading(items.filter(item => !removedCards.has(item.id) && !headings.has(item.id)), new Set(orphans.map(card => card.key)));
    for (const id of [...removedCards, ...headings]) gone.add(`item:${id}`);
    cards = writeCards(cards?.filter(card => !('item' in card && removedCards.has(card.item))), pinned(orphans));
    sections = sections?.filter(section => !('item' in section && headings.has(section.item)));
  }
  for (const id of ids.text) gone.add(`text:${id}`);
  const texts = board.texts?.filter(text => !ids.text.has(text.id));
  const arrows = board.arrows?.filter(arrow => !ids.arrow.has(arrow.id) && !gone.has(endKey(arrow.from)) && !gone.has(endKey(arrow.to)));
  const next = withBoard(row, { ...(sections ? { sections } : {}), ...(cards ? { cards } : {}), ...(texts ? { texts } : {}), ...(arrows ? { arrows } : {}) });
  return { row: items ? withItems(next, items) : next };
}

/** Places free text; text that is only blank adds nothing. */
export function addText(row: CompilationRow, text: { id: string; x: number; y: number; text: string; color?: BoardText['color']; }): BoardEdit {
  const value = text.text.slice(0, TEXT_MAX);
  if (!value.trim()) return { row };
  const board = row.board ?? {};
  if ((board.texts?.length ?? 0) >= BOARD_MAX_TEXTS) return { row, refused: 'textLimit' };
  return { row: withBoard(row, { ...board, texts: [...board.texts ?? [], { id: text.id, x: coordinate(text.x), y: coordinate(text.y), text: value, ...(text.color ? { color: text.color } : {}) }] }) };
}

/** Rewrites a text; emptied, it leaves the board with its arrows, as an empty text box disappears when left. */
export function editText(row: CompilationRow, id: string, text: string): BoardEdit {
  const value = text.slice(0, TEXT_MAX);
  const board = row.board ?? {};
  const current = board.texts?.find(entry => entry.id === id);
  if (!current) return { row };
  if (!value.trim()) return removeSelection(row, { cards: [], sections: [], texts: [] }, [`text:${id}`]);
  if (value === current.text) return { row };
  return { row: withBoard(row, { ...board, texts: board.texts!.map(entry => entry.id === id ? { ...entry, text: value } : entry) }) };
}

/** Gives a text one of the palette's colours, or the board's text colour without one. */
export function setTextColor(row: CompilationRow, id: string, color: BoardText['color'] | undefined): BoardEdit {
  const board = row.board ?? {};
  const current = board.texts?.find(entry => entry.id === id);
  if (!current || current.color === color) return { row };
  return { row: withBoard(row, { ...board, texts: board.texts!.map(entry => entry.id === id ? { id: entry.id, x: entry.x, y: entry.y, ...(entry.w !== undefined ? { w: entry.w } : {}), text: entry.text, ...(color ? { color } : {}) } : entry) }) };
}

const arrowLabel = (label?: string) => label?.trim().slice(0, ARROW_LABEL_MAX).trim() || undefined;

/** Draws an arrow from one element to another, with an optional label; an arrow from an element to itself is refused. */
export function addArrow(row: CompilationRow, arrow: { id: string; from: BoardEnd; to: BoardEnd; label?: string; }): BoardEdit {
  if (endKey(arrow.from) === endKey(arrow.to)) return { row, refused: 'arrowEnds' };
  const board = row.board ?? {};
  if ((board.arrows?.length ?? 0) >= BOARD_MAX_ARROWS) return { row, refused: 'arrowLimit' };
  const label = arrowLabel(arrow.label);
  return { row: withBoard(row, { ...board, arrows: [...board.arrows ?? [], { id: arrow.id, from: arrow.from, to: arrow.to, ...(label ? { label } : {}) }] }) };
}

/** Relabels an arrow; an empty label leaves it without one. */
export function labelArrow(row: CompilationRow, id: string, label: string): BoardEdit {
  const board = row.board ?? {};
  const current = board.arrows?.find(arrow => arrow.id === id);
  const value = arrowLabel(label);
  if (!current || current.label === value) return { row };
  return { row: withBoard(row, { ...board, arrows: board.arrows!.map((arrow): BoardArrow => arrow.id === id ? { id: arrow.id, from: arrow.from, to: arrow.to, ...(value ? { label: value } : {}) } : arrow) }) };
}

/** What an arrow end names for an element of this board: a card's item or member path, a custom section's heading, a text. A dynamic folder section cannot be an end. */
export function endOf(row: CompilationRow, placed: PlacedBoard, key: BoardElementKey): BoardEnd | undefined {
  const { kind, id } = splitKey(key);
  if (kind === 'text') return placed.texts.some(text => text.id === id) ? { text: id } : undefined;
  if (kind === 'section') return row.kind === 'custom' && placed.sections.some(section => section.key === id) ? { item: id } : undefined;
  const card = placed.cards.find(candidate => candidate.key === id);
  if (!card || (row.kind === 'dynamic' && !('path' in card.ref))) return undefined;
  return 'item' in card.ref ? { item: card.ref.item } : { path: card.ref.path };
}

/** The labels already used on a board, most used first, for the label field's suggestions. */
export function usedLabels(row: CompilationRow): string[] {
  const counts = new Map<string, number>();
  for (const arrow of row.board?.arrows ?? []) if (arrow.label) counts.set(arrow.label, (counts.get(arrow.label) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([label]) => label);
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A fresh id of eight characters of [a-z0-9], so a board line stays short, used by no item, text or arrow of the row. */
export function boardId(row: CompilationRow, random: () => number = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): string {
  const taken = new Set([...row.kind === 'custom' ? row.items.map(item => item.id) : [], ...(row.board?.texts ?? []).map(text => text.id), ...(row.board?.arrows ?? []).map(arrow => arrow.id)]);
  for (;;) {
    const id = Array.from({ length: 8 }, () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)]).join('');
    if (!taken.has(id)) return id;
  }
}
