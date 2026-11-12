import { syntaxTree } from '@codemirror/language';
import { type EditorState, Facet } from '@codemirror/state';
import { fencedCodeLines, indentedCodeLines, parseDirectiveOpen } from '../../lib/directives.js';
import { isSlideContainer, isSlideDirective, parseDirectiveLine } from '../../lib/slides/directives.js';
import { type HeadingLabel, HeadingStructureReader } from '../../lib/slides/structure.js';

/**
 * Whether the note in the editor is a `type: slide` note. In a slide note a `---` ends a block and a `##` and a `###` head a slide and a
 * page, as contour-deck's headings mode reads them, and the slide directives draw as a deck reads them.
 */
export const slideNote = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });

/** A line that is a slide directive on its own (`::vertical`, `::block{…}`, `::slide{#id}`, or one written in the wrong form, `:::vertical` among them). */
export interface SlideDirectiveLine {
  from: number;
  to: number;
  text: string;
  name: string;
  /** `::name` (leaf), `:name` (text), or `:::name` (container), which a leaf of contour-deck refuses. */
  form: 'leaf' | 'text' | 'container';
}

export interface EditorSlideStructure {
  /** The slide directive lines outside every code block and container block. */
  lines: SlideDirectiveLine[];
  /** The slide and page each top-level `##` and `###` of a slide note heads, by the position its line starts at. */
  headings: Map<number, { level: 2 | 3; label: HeadingLabel; }>;
  /** The block that ends at each top-level thematic break of a slide note, by the position its line starts at; none where no slide stands before it. */
  blocks: Map<number, number | undefined>;
  /** The block that ends with the note. */
  end: number | undefined;
  /** The number of pages of each slide. */
  pages: number[];
}

/**
 * Reads the note in the editor line by line, the way the renderer's directive pass does: the slide directive lines it holds and, for a
 * slide note, the block that ends at each `---` and the slide and page each heading heads (the numbering itself is
 * `HeadingStructureReader`'s). `blocks` are the container directive blocks, whose lines are content, or notes for a `:::summary`.
 */
export function editorSlideStructure(state: EditorState, blocks: readonly { from: number; to: number; type?: string; }[]): EditorSlideStructure {
  const slides = state.facet(slideNote);
  // The Markdown parser knows which `---` is a thematic break (not a heading's underline) and where the top-level headings are.
  const rules = new Set<number>(), levels = new Map<number, { level: number; to: number; }>();
  if (slides) {
    syntaxTree(state).iterate({
      enter({ name, from, to, node }) {
        if (name === 'HorizontalRule' && node.parent?.name === 'Document') rules.add(state.doc.lineAt(from).from);
        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        // Only a heading at the top level structures a deck; one inside a list or a quote is content.
        if (heading && node.parent?.name === 'Document') levels.set(state.doc.lineAt(from).from, { level: Number(heading[1]), to });
      },
    });
  }
  const reader = new HeadingStructureReader();
  const lines: SlideDirectiveLine[] = [];
  const breaks: number[] = [];
  const headed: { from: number; level: 2 | 3; index: number; }[] = [];
  const inCode = fencedCodeLines(), indentedCode = indentedCodeLines();
  let block = 0, headingEnd = -1;
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    while (block < blocks.length && blocks[block].to < line.from) block++;
    const contained = block < blocks.length && line.from >= blocks[block].from && line.to <= blocks[block].to;
    // The fence tracker reads every line in turn; a container block's lines only count as content, and so does indented code.
    const code = inCode(line.text);
    if (code || contained) indentedCode.interrupt();
    if (code || contained || indentedCode.line(line.text)) {
      if (contained && blocks[block].type === 'summary') reader.notes();
      else reader.content();
      continue;
    }
    if (rules.has(line.from)) {
      reader.rule();
      breaks.push(line.from);
      continue;
    }
    // In a slide note `:::vertical`, `:::block` and `:::slide` open no block: the line is the error contour-deck reports.
    const opened = slides ? parseDirectiveOpen(line.text) : null;
    const directive = opened && isSlideDirective(opened.name) && !isSlideContainer(opened.name) ? { form: 'container' as const, name: opened.name } : parseDirectiveLine(line.text);
    if (directive && isSlideDirective(directive.name)) {
      lines.push({ from: line.from, to: line.to, text: line.text, name: directive.name, form: directive.form });
      // `::block` and `::slide` neither start nor end anything; a directive contour-deck refuses, `::vertical` among them, is drawn as an
      // error box, which a slide shows.
      if (!(directive.form === 'leaf' && (directive.name === 'block' || directive.name === 'slide'))) reader.content();
      continue;
    }
    if (!line.text.trim()) continue;
    const heading = levels.get(line.from);
    if (heading) {
      const index = reader.heading(heading.level);
      if (index !== undefined) headed.push({ from: line.from, level: heading.level as 2 | 3, index });
      headingEnd = heading.to;
      // The underline of a Setext heading is part of the heading.
    } else if (line.from > headingEnd) reader.content();
  }
  const found = reader.structure();
  return { lines, headings: new Map(headed.map(({ from, level, index }) => [from, { level, label: found.headings[index] }])), blocks: new Map(breaks.map((from, index) => [from, found.blocks[index]])), end: found.blocks[breaks.length], pages: found.pages };
}
