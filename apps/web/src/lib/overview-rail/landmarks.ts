import type { syntaxTree } from '@codemirror/language';
import { parseMarkdownOutline } from '../note-navigation.js';

/** A Markdown parse of a note (`syntaxTree`, or `markdownLanguage.parser.parse` of the text). */
type Tree = ReturnType<typeof syntaxTree>;

/** A heading the overview rail marks: its 1-based line, depth (1–6) and label as the outline shows it. */
export interface RailHeading {
  line: number;
  depth: number;
  label: string;
}

/** A page break the rail draws across: the 1-based line of its `---`, and the label of the page or block that ends there. */
export interface RailBreak {
  line: number;
  label: string;
}

/** What the rail marks in a note, by line; geometry turns lines into heights. */
export interface RailLandmarks {
  headings: RailHeading[];
  breaks: RailBreak[];
  /** The label of the page or block after the last break (the note's end); null when the note has no pages. */
  endLabel: string | null;
}

/** A place in the text by its 1-based line and the column within that line. */
export interface LineColumn {
  line: number;
  column: number;
}

/**
 * The positions of a note's top-level page breaks, as the live editor draws them (`liveDecorations`): a thematic break that is a child of
 * the document and reads `---` (any thematic break in a slide note), none before `bodyFrom` (the collab editor's frontmatter).
 */
export function pageBreakOffsets(tree: Tree, text: string, options: { slides?: boolean; bodyFrom?: number; } = {}): number[] {
  const { slides = false, bodyFrom = 0 } = options;
  const breaks: number[] = [];
  const cursor = tree.topNode.cursor();
  if (!cursor.firstChild()) return breaks;
  do {
    if (cursor.name !== 'HorizontalRule' || cursor.from < bodyFrom) continue;
    if (slides || text.slice(cursor.from, cursor.to).trim() === '---') breaks.push(cursor.from);
  } while (cursor.nextSibling());
  return breaks;
}

/** The 1-based line of each offset, for offsets in ascending order. */
export function linesOfOffsets(text: string, offsets: readonly number[]): number[] {
  return positionsOfOffsets(text, offsets).map(position => position.line);
}

/**
 * The line and column of each offset into `text`, for offsets in ascending order (as find answers them); one pass over the text.
 * A column counts the characters after the line's `\n`, so a CRLF line's `\r` is the last column and the editor's own line keeps the place.
 */
export function positionsOfOffsets(text: string, offsets: readonly number[]): LineColumn[] {
  const positions: LineColumn[] = [];
  let line = 1, lineStart = 0, scanned = 0;
  for (const offset of offsets) {
    const at = Math.max(0, Math.min(offset, text.length));
    if (at < scanned) {
      // Out of order: count from the start again rather than answer a wrong line.
      line = 1;
      lineStart = 0;
      scanned = 0;
    }
    for (let index = text.indexOf('\n', scanned); index !== -1 && index < at; index = text.indexOf('\n', index + 1)) {
      line += 1;
      lineStart = index + 1;
    }
    scanned = at;
    positions.push({ line, column: at - lineStart });
  }
  return positions;
}

/**
 * The rail's landmarks of a note that is no slide deck: its outline headings and its `---` page breaks, each break labelled with the page
 * that ends there (`<pageLabel> N`, as the editor's page break says) and the note's end with the last page. Text before `bodyFrom` (a
 * frontmatter block the editor holds) carries none. A note without breaks has no pages, and `endLabel` is null.
 */
export function noteLandmarks(text: string, tree: Tree, pageLabel: string, bodyFrom = 0): RailLandmarks {
  const bodyLine = bodyFrom > 0 ? linesOfOffsets(text, [bodyFrom])[0] : 1;
  const headings = parseMarkdownOutline(text).filter(heading => heading.line >= bodyLine).map(({ line, depth, label }) => ({ line, depth, label }));
  const lines = linesOfOffsets(text, pageBreakOffsets(tree, text, { bodyFrom }));
  const breaks = lines.map((line, index) => ({ line, label: `${pageLabel} ${index + 1}` }));
  return { headings, breaks, endLabel: breaks.length ? `${pageLabel} ${breaks.length + 1}` : null };
}
