import { syntaxTree } from '@codemirror/language';
import { type EditorState, Facet } from '@codemirror/state';
import { fencedCodeLines } from '../../lib/directives.js';
import { isSlideDirective, parseDirectiveLine } from '../../lib/slides/directives.js';
import { readsByHeadings } from '../../lib/slides/note.js';
import { type HeadingLabel, HeadingStructureReader, type SeparatorLabel, type SlideBreak, SlideStructureReader } from '../../lib/slides/structure.js';

/**
 * The structure of the `type: slide` note in the editor (`slideStructureOf`: `slides`, `headings`, or a name contour-deck refuses), and
 * none for any other note. In a slide note the separators are slides and pages, or blocks with the headings as slides and pages, and
 * the slide directives draw as a deck reads them.
 */
export const slideNote = Facet.define<string | undefined, string | undefined>({ combine: values => values.find(Boolean) });

/** A line that is a slide directive on its own (`::vertical`, `::block{…}`, `::slide{#id}`, or one written in the wrong form). */
export interface SlideDirectiveLine {
  from: number;
  to: number;
  text: string;
  name: string;
  /** `::name` (leaf) or `:name` (text). */
  form: 'leaf' | 'text';
  /** `::vertical` as contour-deck takes it: the line is a page separator. Never in a note read by its headings, where contour-deck refuses it. */
  pageBreak: boolean;
}

export interface EditorSlideStructure {
  /** The slide directive lines outside every code block and container block. */
  lines: SlideDirectiveLine[];
  /** What ends at each separator, by the position its line starts at: a top-level thematic break or a `::vertical`. Only read for a slide note read by its separators. */
  separators: Map<number, { kind: SlideBreak; label: SeparatorLabel | undefined; }>;
  /** What ends with the note. */
  end: SeparatorLabel | undefined;
  /** Set for a slide note read by its headings (`slideOptions.structure: headings`), in place of `separators` and `end`. */
  byHeadings?: {
    /** The slide and page each top-level `##` and `###` heads, by the position its line starts at. */
    headings: Map<number, { level: 2 | 3; label: HeadingLabel; }>;
    /** The block that ends at each top-level thematic break, by the position its line starts at; none where no slide stands before it. */
    blocks: Map<number, number | undefined>;
    /** The block that ends with the note. */
    end: number | undefined;
    /** The number of pages of each slide. */
    pages: number[];
  };
}

/**
 * Reads the note in the editor line by line, the way the renderer's directive pass does: the slide directive lines it holds and, for a
 * slide note, the slide and page that end at each separator (the numbering itself is `SlideStructureReader`'s), or in a note read by its
 * headings the block that ends at each `---` and the slide and page each heading heads (`HeadingStructureReader`'s). `blocks` are the
 * container directive blocks, whose lines are content, or notes for a `:::summary`.
 */
export function editorSlideStructure(state: EditorState, blocks: readonly { from: number; to: number; type?: string; }[]): EditorSlideStructure {
  const structure = state.facet(slideNote);
  // The Markdown parser knows which `---` is a thematic break (not a heading's underline) and where the top-level headings are.
  const rules = new Set<number>(), headings = new Map<number, string>(), levels = new Map<number, { level: number; to: number; }>();
  if (structure) {
    syntaxTree(state).iterate({
      enter({ name, from, to, node }) {
        if (name === 'HorizontalRule' && node.parent?.name === 'Document') rules.add(state.doc.lineAt(from).from);
        else if (name === 'ATXHeading2') headings.set(state.doc.lineAt(from).from, state.sliceDoc(from, to).replace(/^#+\s*/, '').replace(/\s+#+\s*$/, ''));
        else if (name === 'SetextHeading2') headings.set(state.doc.lineAt(from).from, state.sliceDoc(from, to).split('\n').slice(0, -1).join(' '));
        const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
        // Only a heading at the top level structures a deck; one inside a list or a quote is content.
        if (heading && node.parent?.name === 'Document') levels.set(state.doc.lineAt(from).from, { level: Number(heading[1]), to });
      },
    });
  }
  const byHeadings = readsByHeadings(structure);
  const reader = new SlideStructureReader(), headingReader = new HeadingStructureReader();
  const lines: SlideDirectiveLine[] = [];
  const breaks: { from: number; kind: SlideBreak; }[] = [];
  const headed: { from: number; level: 2 | 3; index: number; }[] = [];
  const inCode = fencedCodeLines();
  let block = 0, headingEnd = -1;
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    while (block < blocks.length && blocks[block].to < line.from) block++;
    const contained = block < blocks.length && line.from >= blocks[block].from && line.to <= blocks[block].to;
    // The fence tracker reads every line in turn; a container block's lines only count as content.
    if (inCode(line.text) || contained) {
      reader.content(headings.get(line.from));
      if (contained && blocks[block].type === 'summary') headingReader.notes();
      else headingReader.content();
      continue;
    }
    if (rules.has(line.from)) {
      reader.break('slide');
      headingReader.rule();
      breaks.push({ from: line.from, kind: 'slide' });
      continue;
    }
    const directive = parseDirectiveLine(line.text);
    if (directive && isSlideDirective(directive.name)) {
      const pageBreak = !byHeadings && directive.form === 'leaf' && directive.name === 'vertical' && !directive.rawAttrs;
      lines.push({ from: line.from, to: line.to, text: line.text, name: directive.name, form: directive.form, pageBreak });
      if (pageBreak) {
        reader.break('page');
        breaks.push({ from: line.from, kind: 'page' });
      } else if (directive.form === 'leaf' && (directive.name === 'block' || directive.name === 'slide')) reader.starts();
      // A directive in the wrong form is drawn as an error box, which a slide shows; so is a `::vertical` in a note read by its headings.
      else {
        reader.content();
        headingReader.content();
      }
      continue;
    }
    if (!line.text.trim()) continue;
    reader.content(headings.get(line.from));
    const heading = levels.get(line.from);
    if (heading) {
      const index = headingReader.heading(heading.level);
      if (index !== undefined) headed.push({ from: line.from, level: heading.level as 2 | 3, index });
      headingEnd = heading.to;
      // The underline of a Setext heading is part of the heading.
    } else if (line.from > headingEnd) headingReader.content();
  }
  const labels = reader.labels();
  const read: EditorSlideStructure = { lines, separators: new Map(breaks.map(({ from, kind }, index) => [from, { kind, label: labels[index] }])), end: labels[breaks.length] };
  if (!byHeadings) return read;
  const found = headingReader.structure();
  return { ...read, byHeadings: { headings: new Map(headed.map(({ from, level, index }) => [from, { level, label: found.headings[index] }])), blocks: new Map(breaks.map(({ from }, index) => [from, found.blocks[index]])), end: found.blocks[breaks.length], pages: found.pages } };
}
