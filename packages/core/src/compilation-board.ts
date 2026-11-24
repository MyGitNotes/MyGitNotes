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

type Location = (string | number)[];

/**
 * The edits that move a valid board's paths: dynamic card paths, folder sections and path arrow ends. A path may move
 * onto one a stale entry still names (a member that left, a folder that went): the entry that moved names what is
 * there now, so it stays and the stale one goes, and an arrow whose two ends become one path goes. Neither was drawn,
 * since a stale path is not a member; without the rule the moved board would repeat an entry or point an arrow at itself.
 */
export function relocateBoard(board: CompilationBoard, move: (path: string) => string): { edits: { location: Location; next: string; }[]; removals: Location[]; } {
  const edits: { location: Location; next: string; }[] = [];
  const removals: Location[] = [];
  const relocate = (entries: readonly { path?: string; }[], list: string, field: string) => {
    const winners = new Map<string, { index: number; moved: boolean; }>();
    entries.forEach((entry, index) => {
      if (entry.path === undefined) return;
      const next = move(entry.path), moved = next !== entry.path;
      if (moved) edits.push({ location: ['board', list, index, field], next });
      const winner = winners.get(next);
      if (!winner) winners.set(next, { index, moved });
      else if (moved && !winner.moved) {
        removals.push(['board', list, winner.index]);
        winners.set(next, { index, moved });
      } else removals.push(['board', list, index]);
    });
  };
  relocate((board.cards ?? []).map(card => 'path' in card ? { path: card.path } : {}), 'cards', 'path');
  relocate((board.sections ?? []).map(section => 'folder' in section ? { path: section.folder } : {}), 'sections', 'folder');
  board.arrows?.forEach((arrow, index) => {
    const ends = (['from', 'to'] as const).map(side => {
      const end = arrow[side];
      if (!('path' in end)) return undefined;
      const next = move(end.path);
      if (next !== end.path) edits.push({ location: ['board', 'arrows', index, side, 'path'], next });
      return next;
    });
    if (ends[0] !== undefined && ends[0] === ends[1]) removals.push(['board', 'arrows', index]);
  });
  // Removing from the back keeps the other indices, which the edits name, valid.
  return { edits: edits.filter(edit => !removals.some(removal => removal.every((part, at) => edit.location[at] === part))), removals: removals.sort((a, b) => Number(b[2]) - Number(a[2])) };
}

const clampCoordinate = (value: number) => Math.max(-BOARD_COORDINATE_LIMIT, Math.min(BOARD_COORDINATE_LIMIT, Math.round(value)));

/**
 * The cards a legacy `graph` layout places: each node's centre becomes the centre of a card, matched by path (a custom
 * compilation's content items by their path, a dynamic one's members by theirs), and overlapping cards are separated.
 */
export function boardFromGraph(graph: GraphLayout, scope: { items?: readonly ({ id: string; kind: string; path?: string; })[]; }): CompilationBoard {
  const placed: { key: { item: string; } | { path: string; }; x: number; y: number; }[] = [];
  const seen = new Set<string>();
  // Centres are kept inside the board's range before cards are separated, so two far-out nodes never meet on its edge.
  const inside = (value: number, half: number) => Math.max(-BOARD_COORDINATE_LIMIT + half, Math.min(BOARD_COORDINATE_LIMIT - half, value));
  for (const node of graph.nodes.map(node => ({ ...node, x: inside(node.x, BOARD_CARD_WIDTH / 2), y: inside(node.y, BOARD_CARD_HEIGHT / 2) }))) {
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
  // A board holds at most BOARD_MAX_CARDS positions; members past them are auto-placed when the board is drawn.
  const kept = placed.slice(0, BOARD_MAX_CARDS);
  const { nodes } = arrangeGraphLayout({ nodes: kept.map((card, index) => ({ id: String(index), x: card.x, y: card.y, expanded: true, width: BOARD_CARD_WIDTH, height: BOARD_CARD_HEIGHT })) });
  // Separating may push cards past an edge of the range; the layout shifts back inside as a whole, keeping its gaps.
  const shift = (values: number[], size: number) => {
    const low = Math.min(...values) - size / 2, high = Math.max(...values) + size / 2;
    return low < -BOARD_COORDINATE_LIMIT ? -BOARD_COORDINATE_LIMIT - low : high > BOARD_COORDINATE_LIMIT ? BOARD_COORDINATE_LIMIT - high : 0;
  };
  const dx = nodes.length ? shift(nodes.map(node => node.x), BOARD_CARD_WIDTH) : 0, dy = nodes.length ? shift(nodes.map(node => node.y), BOARD_CARD_HEIGHT) : 0;
  return { cards: kept.map((card, index) => ({ ...card.key, x: clampCoordinate(nodes[index].x + dx - BOARD_CARD_WIDTH / 2), y: clampCoordinate(nodes[index].y + dy - BOARD_CARD_HEIGHT / 2) })) };
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
