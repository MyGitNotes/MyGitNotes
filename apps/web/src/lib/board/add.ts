import { addToChapter, BOARD_CARD_HEIGHT as CARD_H, BOARD_CARD_WIDTH as CARD_W, BOARD_COORDINATE_LIMIT, COMPILATION_MAX_ITEMS, type CompilationItem, type CompilationRow, contentItems } from '@mygitnotes/core/compilation';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { isLivePendingPath } from '../live-api.js';
import { type BoardEdit, boardId } from './edit.js';
import { type Point, type Rect, rectsOverlap, unionRects } from './geometry.js';
import { BOARD_GAP, type PlacedBoard, roomOf } from './placement.js';

/** What adding notes to a board did: the row to write, why it refused, the items it added, or the card of a note already there. */
export interface BoardAddition extends BoardEdit {
  /** The ids of the items added, in order. */
  added: string[];
  /** The card key of a note the board already holds: it is found, not added again. */
  found?: string;
}

/** How far a slot search walks before it settles where it is. */
const SEARCH_STEPS = 200;
const coordinate = (value: number) => Math.max(-BOARD_COORDINATE_LIMIT, Math.min(BOARD_COORDINATE_LIMIT, Math.round(value)));
const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
const cardAt = (x: number, y: number): Rect => ({ x, y, w: CARD_W, h: CARD_H });

/** The notes a board shows as cards, by `noteRefKey`, each with the key of its first card (a heading-anchored item counts as its note). */
export function boardNotes(placed: PlacedBoard): Map<string, string> {
  const notes = new Map<string, string>();
  for (const card of placed.cards) {
    if (card.item.kind !== 'note') continue;
    const key = noteRefKey(card.item);
    if (!notes.has(key)) notes.set(key, card.key);
  }
  return notes;
}

/** The section a board point lands in: the last drawn (topmost) one whose rectangle holds it, or none. */
export function sectionAt(placed: PlacedBoard, point: Point): string | undefined {
  return placed.sections.filter(section => contains(section.rect, point)).at(-1)?.key;
}

/** The items with `item` added to a chapter, or, without one, after the items before the first heading: in no chapter. */
function insert(items: readonly CompilationItem[], item: CompilationItem, section?: string): CompilationItem[] {
  if (section !== undefined && items.some(candidate => candidate.id === section && candidate.kind === 'heading')) return addToChapter(items, item, section);
  const first = items.findIndex(candidate => candidate.kind === 'heading');
  const at = first < 0 ? items.length : first;
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/**
 * A pending live note has a virtual path (`<root>/.live/<id>.md`) until its first check-in files it at a Git path,
 * which an item naming the virtual path would not follow: no board takes one.
 */
/** A note as an addition reads it: where it is, and whether it is a pending live note. */
export type AddableNote = NoteRef & { live?: { pending?: boolean; }; };
export const pendingNote = (note: AddableNote) => Boolean(note.live?.pending) || isLivePendingPath(note.path);

/** Why a board cannot take `count` more notes: a dynamic board's cards come from its query; a custom one holds at most 100 items. */
export function addRefusal(row: CompilationRow, count: number): BoardEdit['refused'] {
  if (row.kind !== 'custom') return 'dynamicItems';
  return contentItems(row.items).length + count > COMPILATION_MAX_ITEMS ? 'itemLimit' : undefined;
}

/** The note items added to a custom row, each in `section` (or none) with its stored position, if any. */
function withNotes(row: Extract<CompilationRow, { kind: 'custom'; }>, notes: readonly { note: NoteRef; section?: string; rect?: Rect; }[], makeId: (row: CompilationRow) => string): { row: CompilationRow; added: string[]; } {
  let next: Extract<CompilationRow, { kind: 'custom'; }> = row;
  const added: string[] = [];
  for (const { note, section, rect } of notes) {
    const id = makeId(next);
    const item: CompilationItem = { id, kind: 'note', notebookId: note.notebookId, path: note.path };
    const cards = rect ? [...next.board?.cards ?? [], { item: id, x: coordinate(rect.x), y: coordinate(rect.y) }] : next.board?.cards;
    next = { ...next, items: insert(next.items, item, section), ...(cards ? { board: { ...next.board, cards } } : {}) };
    added.push(id);
  }
  return { row: next, added };
}

export interface AddNoteOptions {
  /** The board point the card is centred on; without it the card is auto-placed in its section. */
  at?: Point;
  /** The section whose chapter takes the item; without it, the section `at` lands in (none outside every section). */
  section?: string;
  /** Moves the card down from `at` until it covers no other card, so cards added at one spot do not stack. */
  clear?: boolean;
  makeId?: (row: CompilationRow) => string;
}

/**
 * Adds a note to a custom board (spec, The 筆記庫 drawer): an item in the chapter of the section it lands in (or the
 * section named), its card centred on the point, or auto-placed in its section without one. A note the board already
 * shows is found, not added; a dynamic board refuses (its cards come from its query), and so does a board at its item
 * limit, and any board a pending live note (`pendingNote`).
 */
export function addNote(row: CompilationRow, placed: PlacedBoard, note: AddableNote, { at, section, clear = false, makeId = boardId }: AddNoteOptions = {}): BoardAddition {
  const found = boardNotes(placed).get(noteRefKey(note));
  if (found) return { row, added: [], found };
  if (pendingNote(note)) return { row, added: [], refused: 'pendingNote' };
  const refused = addRefusal(row, 1);
  if (refused || row.kind !== 'custom') return { row, added: [], refused: refused ?? 'dynamicItems' };
  let rect = at && cardAt(Math.round(at.x - CARD_W / 2), Math.round(at.y - CARD_H / 2));
  if (rect && clear) {
    for (let step = 0; step < SEARCH_STEPS && placed.cards.some(card => rectsOverlap(card.rect, rect!)); step++) rect = { ...rect, y: rect.y + CARD_H + BOARD_GAP };
  }
  const chapter = section ?? (at ? sectionAt(placed, at) : undefined);
  return withNotes(row, [{ note, ...(chapter !== undefined ? { section: chapter } : {}), ...(rect ? { rect } : {}) }], makeId);
}

/** How many columns right of a card, and rows below it, a tidy place for 「＋N 相連」 is looked for. */
const BESIDE_COLUMNS = 4, BESIDE_ROWS = 20;

/**
 * Adds notes beside a card (「＋N 相連」): items of the card's chapter (none when it is in none), their cards in one
 * column next to it. The column goes to the right of the card, top aligned with it, in the nearest place clear of
 * every other card, of free text and of every other section, where the card's own section, drawn grown to hold the
 * column, overlaps no other section; when the right side is taken (a section beside it), the column goes below the
 * card instead. With no such place nearby it falls back to the first column to the right clear of other cards. Notes
 * the board already shows and pending live notes are skipped; a dynamic board refuses, and so does a custom one the
 * notes would take past its item limit.
 */
export function addBeside(row: CompilationRow, placed: PlacedBoard, cardKey: string, notes: readonly AddableNote[], makeId: (row: CompilationRow) => string = boardId): BoardAddition {
  const card = placed.cards.find(candidate => candidate.key === cardKey);
  const shown = boardNotes(placed);
  const fresh = [...new Map(notes.filter(note => !shown.has(noteRefKey(note)) && !pendingNote(note)).map(note => [noteRefKey(note), note])).values()];
  if (!card || !fresh.length) return { row, added: [] };
  const refused = addRefusal(row, fresh.length);
  if (refused || row.kind !== 'custom') return { row, added: [], refused: refused ?? 'dynamicItems' };
  const cards = placed.cards.filter(candidate => candidate.key !== card.key).map(candidate => candidate.rect);
  const sections = placed.sections.filter(section => section.key !== card.section).map(section => section.rect);
  const obstacles = [...cards, ...placed.texts.map(text => text.rect), ...sections];
  const own = placed.sections.find(section => section.key === card.section)?.rect;
  const column = (x: number, y: number) => fresh.map((_, index) => cardAt(x, y + index * (CARD_H + BOARD_GAP)));
  const tidy = (slots: Rect[]) => !slots.some(slot => obstacles.some(other => rectsOverlap(other, slot))) && (!own || !sections.some(other => rectsOverlap(other, unionRects([own, ...slots.map(roomOf)])!)));
  const right = card.rect.x + card.rect.w + BOARD_GAP, below = card.rect.y + card.rect.h + BOARD_GAP;
  const candidates = [...Array.from({ length: BESIDE_COLUMNS }, (_, step) => column(right + step * (CARD_W + BOARD_GAP), card.rect.y)), ...Array.from({ length: BESIDE_ROWS }, (_, step) => column(card.rect.x, below + step * (CARD_H + BOARD_GAP)))];
  let slots = candidates.find(tidy);
  if (!slots) {
    let x = right;
    for (let step = 0; step < SEARCH_STEPS && column(x, card.rect.y).some(slot => cards.some(other => rectsOverlap(other, slot))); step++) x += CARD_W + BOARD_GAP;
    slots = column(x, card.rect.y);
  }
  const placedSlots = slots;
  return withNotes(row, fresh.map((note, index) => ({ note, ...(card.section !== undefined ? { section: card.section } : {}), rect: placedSlots[index] })), makeId);
}
