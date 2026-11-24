import { z } from 'zod';
import { arrangeGraphLayout } from './board-placement.js';
import type { CompilationFile, GraphLayout } from './compilation.js';
import { COMPILATION_MAX_HEADINGS, COMPILATION_MAX_ORDER, compilationId as id, compilationRepoPath as repoPath } from './compilation-primitives.js';

/** Every card has one size, in board units (one unit is one CSS pixel at 100%). */
export const BOARD_CARD_WIDTH = 240;
export const BOARD_CARD_HEIGHT = 128;
export const BOARD_SECTION_MIN_WIDTH = 288;
export const BOARD_SECTION_MIN_HEIGHT = 176;
export const BOARD_COORDINATE_LIMIT = 1_000_000;
export const BOARD_MAX_CARDS = COMPILATION_MAX_ORDER;
export const BOARD_MAX_SECTIONS = COMPILATION_MAX_HEADINGS;
export const BOARD_MAX_TEXTS = 300;
export const BOARD_MAX_ARROWS = 600;
/** The palette a status takes; free text uses one of them or the board's text colour. */
export const BOARD_TEXT_COLORS = ['green', 'blue', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'] as const;

const coordinate = z.number().int().min(-BOARD_COORDINATE_LIMIT).max(BOARD_COORDINATE_LIMIT);
const extent = (min: number) => z.number().int().min(min).max(2 * BOARD_COORDINATE_LIMIT);
const ItemCardSchema = z.object({ item: id, x: coordinate, y: coordinate }).strict();
const PathCardSchema = z.object({ path: repoPath, x: coordinate, y: coordinate }).strict();
const ItemSectionSchema = z.object({ item: id, x: coordinate, y: coordinate, w: extent(BOARD_SECTION_MIN_WIDTH), h: extent(BOARD_SECTION_MIN_HEIGHT) }).strict();
const FolderSectionSchema = z.object({ folder: repoPath, x: coordinate, y: coordinate }).strict();
const TextSchema = z.object({ id, x: coordinate, y: coordinate, w: z.number().int().min(80).max(1200).optional(), text: z.string().min(1).max(2000).refine(value => value.trim() !== '', 'Text is empty'), color: z.enum(BOARD_TEXT_COLORS).optional() }).strict();
const EndSchema = z.union([z.object({ item: id }).strict(), z.object({ path: repoPath }).strict(), z.object({ text: id }).strict()]);
const ArrowSchema = z.object({ id, from: EndSchema, to: EndSchema, label: z.string().trim().min(1).max(60).optional() }).strict();

/**
 * The `board` section of a compilation file: card positions, section rectangles, free text and drawn arrows.
 * A custom compilation names items by id; a dynamic one names members by repository path and folder chapters by folder.
 */
export const BoardSchema = z.object({ sections: z.array(z.union([ItemSectionSchema, FolderSectionSchema])).max(BOARD_MAX_SECTIONS).optional(), cards: z.array(z.union([ItemCardSchema, PathCardSchema])).max(BOARD_MAX_CARDS).optional(), texts: z.array(TextSchema).max(BOARD_MAX_TEXTS).optional(), arrows: z.array(ArrowSchema).max(BOARD_MAX_ARROWS).optional() }).strict();
export type CompilationBoard = z.infer<typeof BoardSchema>;
export type BoardCard = NonNullable<CompilationBoard['cards']>[number];
export type BoardSection = NonNullable<CompilationBoard['sections']>[number];
export type BoardText = NonNullable<CompilationBoard['texts']>[number];
export type BoardArrow = NonNullable<CompilationBoard['arrows']>[number];
export type BoardEnd = BoardArrow['from'];

/** What a board's references are checked against: a custom compilation's items, or a dynamic one's grouping. */
interface BoardScope {
  items?: readonly { id: string; kind: string; }[];
  group?: 'folder';
}
type Issue = (message: string, path: (string | number)[]) => void;

const sameEnd = (a: BoardEnd, b: BoardEnd) => ('item' in a && 'item' in b && a.item === b.item) || ('path' in a && 'path' in b && a.path === b.path) || ('text' in a && 'text' in b && a.text === b.text);

/**
 * Reports every reference of a board that does not fit its compilation, naming the field: a custom entry naming a
 * path or folder, a dynamic entry naming an item, a folder section without `group: folder`, an item of the wrong
 * kind or none, a duplicate, a text end naming no text, an arrow from an element to itself. Paths are not checked
 * against membership, which changes as notes are tagged and moved.
 */
export function checkBoard(board: CompilationBoard, scope: BoardScope, issue: Issue): void {
  const custom = scope.items !== undefined;
  const content = new Set(scope.items?.filter(item => item.kind !== 'heading').map(item => item.id));
  const headings = new Set(scope.items?.filter(item => item.kind === 'heading').map(item => item.id));
  const at = (...path: (string | number)[]) => ['board', ...path];
  const once = (seen: Set<string>, key: string, message: string, path: (string | number)[]) => {
    if (seen.has(key)) issue(message, path);
    seen.add(key);
  };
  const cards = new Set<string>();
  board.cards?.forEach((card, index) => {
    if ('item' in card) {
      if (!custom) issue('A dynamic compilation names a card by path', at('cards', index, 'item'));
      else if (!content.has(card.item)) issue(`Card names no content item: ${card.item}`, at('cards', index, 'item'));
      once(cards, `item:${card.item}`, `Duplicate card for item ${card.item}`, at('cards', index, 'item'));
    } else {
      if (custom) issue('A custom compilation names a card by item', at('cards', index, 'path'));
      once(cards, `path:${card.path}`, `Duplicate card for path ${card.path}`, at('cards', index, 'path'));
    }
  });
  const sections = new Set<string>();
  board.sections?.forEach((section, index) => {
    if ('item' in section) {
      if (!custom) issue('A dynamic compilation names a section by folder', at('sections', index, 'item'));
      else if (!headings.has(section.item)) issue(`Section names no chapter heading: ${section.item}`, at('sections', index, 'item'));
      once(sections, `item:${section.item}`, `Duplicate section for heading ${section.item}`, at('sections', index, 'item'));
    } else {
      if (custom) issue('A custom compilation names a section by heading item', at('sections', index, 'folder'));
      else if (scope.group !== 'folder') issue('A folder section needs group: folder', at('sections', index, 'folder'));
      once(sections, `folder:${section.folder}`, `Duplicate section for folder ${section.folder}`, at('sections', index, 'folder'));
    }
  });
  const texts = new Set<string>();
  board.texts?.forEach((text, index) => once(texts, text.id, `Duplicate text id ${text.id}`, at('texts', index, 'id')));
  const arrows = new Set<string>();
  board.arrows?.forEach((arrow, index) => {
    once(arrows, arrow.id, `Duplicate arrow id ${arrow.id}`, at('arrows', index, 'id'));
    for (const side of ['from', 'to'] as const) {
      const end = arrow[side];
      if ('item' in end) {
        if (!custom) issue('A dynamic compilation names an arrow end by path', at('arrows', index, side, 'item'));
        else if (!content.has(end.item) && !headings.has(end.item)) issue(`Arrow end names no item: ${end.item}`, at('arrows', index, side, 'item'));
      } else if ('path' in end) {
        if (custom) issue('A custom compilation names an arrow end by item', at('arrows', index, side, 'path'));
      } else if (!texts.has(end.text)) issue(`Arrow end names no text: ${end.text}`, at('arrows', index, side, 'text'));
    }
    if (sameEnd(arrow.from, arrow.to)) issue('An arrow cannot start and end on the same element', at('arrows', index, 'to'));
  });
}

/**
 * The board with only the entries its compilation can hold: for a custom compilation, cards, sections and arrow
 * ends that name a current item of the right kind; for a dynamic one, path cards, folder sections when it groups by
 * folder, and path ends. An arrow loses with its end. Paths are kept whether or not they are members now.
 */
export function fitBoard(board: CompilationBoard, scope: BoardScope): CompilationBoard {
  const custom = scope.items !== undefined;
  const content = new Set(scope.items?.filter(item => item.kind !== 'heading').map(item => item.id));
  const headings = new Set(scope.items?.filter(item => item.kind === 'heading').map(item => item.id));
  const cards = board.cards?.filter(card => 'item' in card ? content.has(card.item) : !custom);
  const sections = board.sections?.filter(section => 'item' in section ? headings.has(section.item) : !custom && scope.group === 'folder');
  const texts = new Set(board.texts?.map(text => text.id));
  const holds = (end: BoardEnd) => 'item' in end ? content.has(end.item) || headings.has(end.item) : 'path' in end ? !custom : texts.has(end.text);
  const arrows = board.arrows?.filter(arrow => holds(arrow.from) && holds(arrow.to));
  return { ...(sections ? { sections } : {}), ...(cards ? { cards } : {}), ...(board.texts ? { texts: board.texts } : {}), ...(arrows ? { arrows } : {}) };
}

/** The board with every item reference mapped through `ids` (old id to new), as a copy of the compilation gives its items fresh ids. */
export function remapBoardItems(board: CompilationBoard, ids: ReadonlyMap<string, string>): CompilationBoard {
  const item = <T extends { item: string; }>(entry: T): T => ({ ...entry, item: ids.get(entry.item) ?? entry.item });
  const end = (value: BoardEnd): BoardEnd => 'item' in value ? item(value) : value;
  const { sections, cards, arrows } = board;
  return { ...board, ...(sections ? { sections: sections.map(section => 'item' in section ? item(section) : section) } : {}), ...(cards ? { cards: cards.map(card => 'item' in card ? item(card) : card) } : {}), ...(arrows ? { arrows: arrows.map(arrow => ({ ...arrow, from: end(arrow.from), to: end(arrow.to) })) } : {}) };
}

/** The listing counts of a board. */
export function boardCounts(board: CompilationBoard) {
  return { cards: board.cards?.length ?? 0, sections: board.sections?.length ?? 0, texts: board.texts?.length ?? 0, arrows: board.arrows?.length ?? 0 };
}

/** The canonical key order of each entry, so a written entry reads as in the format's example. */
export function orderedBoard(board: CompilationBoard): CompilationBoard {
  const { sections, cards, texts, arrows } = board;
  const end = (value: BoardEnd): BoardEnd => 'item' in value ? { item: value.item } : 'path' in value ? { path: value.path } : { text: value.text };
  return { ...(sections ? { sections: sections.map(section => 'item' in section ? { item: section.item, x: section.x, y: section.y, w: section.w, h: section.h } : { folder: section.folder, x: section.x, y: section.y }) } : {}), ...(cards ? { cards: cards.map(card => 'item' in card ? { item: card.item, x: card.x, y: card.y } : { path: card.path, x: card.x, y: card.y }) } : {}), ...(texts ? { texts: texts.map(text => ({ id: text.id, x: text.x, y: text.y, ...(text.w !== undefined ? { w: text.w } : {}), text: text.text, ...(text.color ? { color: text.color } : {}) })) } : {}), ...(arrows ? { arrows: arrows.map(arrow => ({ id: arrow.id, from: end(arrow.from), to: end(arrow.to), ...(arrow.label ? { label: arrow.label } : {}) })) } : {}) };
}

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

/** The repository paths a stored board names, with their location in the file: dynamic card paths, folder sections and path arrow ends. */
export function boardPaths(value: unknown): { location: (string | number)[]; path: unknown; }[] {
  const board = record(value);
  if (!board) return [];
  const found: { location: (string | number)[]; path: unknown; }[] = [];
  list(board.cards).forEach((card, index) => {
    const entry = record(card);
    if (entry && 'path' in entry) found.push({ location: ['board', 'cards', index, 'path'], path: entry.path });
  });
  list(board.sections).forEach((section, index) => {
    const entry = record(section);
    if (entry && 'folder' in entry) found.push({ location: ['board', 'sections', index, 'folder'], path: entry.folder });
  });
  list(board.arrows).forEach((arrow, index) => {
    for (const side of ['from', 'to']) {
      const end = record(record(arrow)?.[side]);
      if (end && 'path' in end) found.push({ location: ['board', 'arrows', index, side, 'path'], path: end.path });
    }
  });
  return found;
}

const clampCoordinate = (value: number) => Math.max(-BOARD_COORDINATE_LIMIT, Math.min(BOARD_COORDINATE_LIMIT, Math.round(value)));

/**
 * The cards a legacy `graph` layout places: each node's centre becomes the centre of a card, matched by path (a custom
 * compilation's content items by their path, a dynamic one's members by theirs), and overlapping cards are separated.
 */
export function boardFromGraph(graph: GraphLayout, scope: { items?: readonly ({ id: string; kind: string; path?: string; })[]; }): CompilationBoard {
  const placed: { key: { item: string; } | { path: string; }; x: number; y: number; }[] = [];
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (scope.items) {
      for (const item of scope.items) {
        if (item.kind === 'heading' || item.path !== node.path || seen.has(`item:${item.id}`)) continue;
        seen.add(`item:${item.id}`);
        placed.push({ key: { item: item.id }, x: node.x, y: node.y });
      }
    } else if (!seen.has(`path:${node.path}`)) {
      seen.add(`path:${node.path}`);
      placed.push({ key: { path: node.path }, x: node.x, y: node.y });
    }
  }
  const { nodes } = arrangeGraphLayout({ nodes: placed.map((card, index) => ({ id: String(index), x: card.x, y: card.y, expanded: true, width: BOARD_CARD_WIDTH, height: BOARD_CARD_HEIGHT })) });
  return { cards: placed.map((card, index) => ({ ...card.key, x: clampCoordinate(nodes[index].x - BOARD_CARD_WIDTH / 2), y: clampCoordinate(nodes[index].y - BOARD_CARD_HEIGHT / 2) })) };
}

/**
 * A compilation file in the board format: `arrangement: graph` becomes `board`, a legacy `graph` layout becomes the
 * board's cards when the file has no `board` (when it has both, `board` wins), and `graph` is dropped. Writing the
 * result is the first write of a board, so the app reads files through it only once every deployment reads boards.
 */
export function boardCompilation(file: CompilationFile): CompilationFile {
  const { graph, ...rest } = file;
  const board = file.board ?? (graph ? boardFromGraph(graph, file) : undefined);
  return { ...rest, arrangement: file.arrangement === 'graph' ? 'board' : file.arrangement, ...(board ? { board } : {}) };
}
