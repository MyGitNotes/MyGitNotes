import type { RailBlock, RailBlockKind } from './blocks.js';
import { RAIL_WIDTH, type RailWidthMode } from './layout.js';

/** A block's place within the scroller's content, as `scrollTop` counts it: its first line's top to its last line's bottom. */
export interface Extent {
  top: number;
  bottom: number;
}

export interface MinimapInput {
  mode: RailWidthMode;
  blocks: readonly RailBlock[];
  /** One per block. */
  extents: readonly Extent[];
  scrollHeight: number;
  railHeight: number;
  /** The height of one row of text in the editor, so a wrapped line's rows can be told apart. */
  lineHeight: number;
  /** How many columns of text a row of the editor holds. */
  columns: number;
}

/** A shape the minimap draws, in rail pixels from the drawn rail's top left. */
export interface MinimapShape {
  kind: RailBlockKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The margin the minimap keeps inside the drawn rail on each side. */
export const MINIMAP_INSET: Record<RailWidthMode, number> = { wide: 5, narrow: 4 };
/** How far each level of nesting moves a block right; the narrow rail shows rows only. */
const INDENT: Record<RailWidthMode, number> = { wide: 4, narrow: 0 };
/** Nesting deeper than this draws at this depth, so a deep list keeps some width. */
const MAX_DEPTH = 4;
/** A row of text is drawn as this share of its height, so neighbouring rows stay apart while there is room. */
const ROW_INK = 0.55;
/** A quote's bar's width. */
const QUOTE_BAR = 1.5;
/** A row or block never draws thinner than this, so a long note's text still shows. */
const MIN_HEIGHT = 1;

/** The minimap's inner width, the room between its insets. */
export const minimapWidth = (mode: RailWidthMode) => RAIL_WIDTH[mode] - 2 * MINIMAP_INSET[mode];

/**
 * The minimap of a note's blocks, scaled onto the rail as the rail's marks are. A line of prose draws a bar per row it takes on screen,
 * each as long as the text that fills it (a wrapped line's rows full, its last one the rest), and nested lines move right; code, tables
 * and pictures fill the box they take, and a quote draws a bar along its lines. A narrow rail draws every row across its width: a barcode
 * of where the text lies.
 */
export function layoutMinimap({ mode, blocks, extents, scrollHeight, railHeight, lineHeight, columns }: MinimapInput): MinimapShape[] {
  if (scrollHeight <= 0 || railHeight <= 0) return [];
  const scale = railHeight / scrollHeight, inner = minimapWidth(mode), inset = MINIMAP_INSET[mode], row = Math.max(1, lineHeight), perRow = Math.max(1, columns);
  const shapes: MinimapShape[] = [];
  blocks.forEach((block, index) => {
    const extent = extents[index];
    if (!extent || extent.bottom <= extent.top) return;
    const indent = INDENT[mode] * Math.min(block.depth, MAX_DEPTH), x = inset + indent, room = inner - indent;
    if (block.kind === 'quote') {
      if (mode === 'wide') shapes.push({ kind: 'quote', x, y: extent.top * scale, width: QUOTE_BAR, height: Math.max(MIN_HEIGHT, (extent.bottom - extent.top) * scale) });
      return;
    }
    if (block.kind !== 'text') {
      shapes.push({ kind: block.kind, x, y: extent.top * scale, width: room, height: Math.max(MIN_HEIGHT * 2, (extent.bottom - extent.top) * scale) });
      return;
    }
    const height = extent.bottom - extent.top;
    const rows = Math.max(1, Math.round(height / row)), rowHeight = height / rows;
    for (let index = 0; index < rows; index++) {
      const filled = mode === 'narrow' ? 1 : rows === 1 ? block.length / perRow : index < rows - 1 ? 1 : (block.length - (rows - 1) * perRow) / perRow;
      const share = Math.max(0.08, Math.min(1, filled));
      shapes.push({ kind: 'text', x, y: (extent.top + index * rowHeight + rowHeight * (1 - ROW_INK) / 2) * scale, width: Math.max(2, room * share), height: Math.max(MIN_HEIGHT, rowHeight * ROW_INK * scale) });
    }
  });
  return shapes;
}
