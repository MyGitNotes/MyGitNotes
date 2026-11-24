import type { syntaxTree } from '@codemirror/language';

/** A Markdown parse of a note (`syntaxTree`, or `markdownLanguage.parser.parse` of the text). */
type Tree = ReturnType<typeof syntaxTree>;
type Node = Tree['topNode'];

/**
 * What the rail's minimap draws a block as: `text` a line of prose (a paragraph, a list item, a quote's line), `code` a code block or
 * the frontmatter, `table` a table, `media` a block drawn as a picture (an image alone on its lines, display math, a diagram), `quote`
 * the bar beside a block quote's lines.
 */
export type RailBlockKind = 'text' | 'code' | 'table' | 'media' | 'quote';

/** A block of the note's text, by its 1-based lines; geometry turns lines into heights. */
export interface RailBlock {
  kind: RailBlockKind;
  line: number;
  /** Its last line, the same as `line` for a line of text. */
  endLine: number;
  /** How deep it is nested in lists and quotes, 0 at the note's top level. */
  depth: number;
  /** A line of text's width in columns, a wide (CJK) character counting two; 0 for other blocks. */
  length: number;
}

/** Fenced code in these languages is drawn as a picture in the live editor. */
const DRAWN_LANGUAGES = /^(?:mermaid|math|latex|tex|katex|tikz|plantuml|graphviz|dot|abc|vega(?:-lite)?|chart)\b/i;
/** A directive's fence (`:::note`, `:::`), drawn as the box around its lines rather than as a line. */
const DIRECTIVE_FENCE = /^\s*:{3,}/;
/** An image alone in its paragraph. */
const LONE_IMAGE = /^!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?$/;

/** Wide characters (CJK, Hangul, full-width forms) take two columns. */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** A text's width in columns, a wide character counting two. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? 2 : 1;
  return width;
}

/** The 1-based line of an offset, from the offsets where lines start. */
function lineAt(starts: readonly number[], offset: number): number {
  let low = 0, high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

/** Where a leading YAML frontmatter ends (the offset after its closing line), or 0 without one. */
export function frontmatterEnd(text: string): number {
  if (!/^---\r?\n/.test(text)) return 0;
  const close = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/g;
  close.lastIndex = 3;
  const found = close.exec(text);
  return found ? found.index + found[0].length : 0;
}

/**
 * The blocks of a note as its minimap draws them, in the note's order: each line of prose with its width and nesting, and code blocks,
 * tables, pictures and quote bars by the lines they span. Headings, page breaks and rules are left to the rail's own marks. Text before
 * `bodyFrom` (a frontmatter block the editor holds) carries none; a frontmatter at the text's start shows as one code block.
 */
export function noteBlocks(text: string, tree: Tree, bodyFrom = 0): RailBlock[] {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  const line = (offset: number) => lineAt(starts, offset);
  const lineEnd = (number: number) => number < starts.length ? starts[number] - 1 : text.length;
  const blocks: RailBlock[] = [];
  const front = bodyFrom > 0 ? 0 : frontmatterEnd(text);
  const skip = Math.max(bodyFrom, front);
  if (front) blocks.push({ kind: 'code', line: 1, endLine: line(Math.max(0, front - 1)), depth: 0, length: 0 });
  const span = (kind: RailBlockKind, node: Node, depth: number) => blocks.push({ kind, line: line(node.from), endLine: line(Math.max(node.from, node.to - 1)), depth, length: 0 });
  const prose = (node: Node, depth: number) => {
    const content = text.slice(node.from, node.to).trim();
    if (LONE_IMAGE.test(content) || content.startsWith('$$')) return span('media', node, depth);
    const last = line(Math.max(node.from, node.to - 1));
    for (let number = line(node.from); number <= last; number++) {
      const from = Math.max(starts[number - 1], node.from), to = Math.min(lineEnd(number), node.to);
      // A quote's continuation lines start with their own `>` marks.
      const words = text.slice(from, to).replace(/^[\s>]*/, '').trimEnd();
      if (!words || DIRECTIVE_FENCE.test(words)) continue;
      blocks.push({ kind: 'text', line: number, endLine: number, depth, length: displayWidth(words) });
    }
  };
  const walk = (parent: Node, depth: number) => {
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.to <= skip) continue;
      const name = node.name;
      if (name === 'Paragraph' || name === 'HTMLBlock') prose(node, depth);
      else if (name === 'FencedCode') {
        const info = node.getChild('CodeInfo');
        span(info && DRAWN_LANGUAGES.test(text.slice(info.from, info.to)) ? 'media' : 'code', node, depth);
      } else if (name === 'CodeBlock') span('code', node, depth);
      else if (name === 'Table') span('table', node, depth);
      else if (name === 'Blockquote') {
        span('quote', node, depth);
        walk(node, depth + 1);
      } else if (name === 'BulletList' || name === 'OrderedList') walk(node, depth);
      else if (name === 'ListItem') walk(node, depth + 1);
    }
  };
  walk(tree.topNode, 0);
  return blocks;
}
