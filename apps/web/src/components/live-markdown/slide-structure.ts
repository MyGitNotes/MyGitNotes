import { syntaxTree } from '@codemirror/language';
import { type EditorState, Facet } from '@codemirror/state';
import { fencedCodeLines } from '../../lib/directives.js';
import { isSlideDirective, parseDirectiveLine } from '../../lib/slides/directives.js';
import { type SeparatorLabel, type SlideBreak, SlideStructureReader } from '../../lib/slides/structure.js';

/** Whether the note in the editor is a `type: slide` note: its separators are slides and pages, and its slide directives draw as a deck reads them. */
export const slideNote = Facet.define<boolean, boolean>({ combine: values => values.some(Boolean) });

/** A line that is a slide directive on its own (`::vertical`, `::block{…}`, `::slide{#id}`, or one written in the wrong form). */
export interface SlideDirectiveLine {
  from: number;
  to: number;
  text: string;
  name: string;
  /** `::name` (leaf) or `:name` (text). */
  form: 'leaf' | 'text';
  /** `::vertical` as contour-deck takes it: the line is a page separator. */
  pageBreak: boolean;
}

export interface EditorSlideStructure {
  /** The slide directive lines outside every code block and container block. */
  lines: SlideDirectiveLine[];
  /** What ends at each separator, by the position its line starts at: a top-level thematic break or a `::vertical`. Only read for a slide note. */
  separators: Map<number, { kind: SlideBreak; label: SeparatorLabel | undefined; }>;
  /** What ends with the note. */
  end: SeparatorLabel | undefined;
}

/**
 * Reads the note in the editor line by line, the way the renderer's directive pass does: the slide directive lines it holds and, for a
 * slide note, the slide and page that end at each separator (the numbering itself is `SlideStructureReader`'s). `blocks` are the
 * container directive blocks, whose lines are content.
 */
export function editorSlideStructure(state: EditorState, blocks: readonly { from: number; to: number; }[]): EditorSlideStructure {
  // The Markdown parser knows which `---` is a thematic break (not a heading's underline) and where the second-level headings are.
  const rules = new Set<number>(), headings = new Map<number, string>();
  if (state.facet(slideNote)) {
    syntaxTree(state).iterate({
      enter({ name, from, to, node }) {
        if (name === 'HorizontalRule' && node.parent?.name === 'Document') rules.add(state.doc.lineAt(from).from);
        else if (name === 'ATXHeading2') headings.set(state.doc.lineAt(from).from, state.sliceDoc(from, to).replace(/^#+\s*/, '').replace(/\s+#+\s*$/, ''));
        else if (name === 'SetextHeading2') headings.set(state.doc.lineAt(from).from, state.sliceDoc(from, to).split('\n').slice(0, -1).join(' '));
      },
    });
  }
  const reader = new SlideStructureReader();
  const lines: SlideDirectiveLine[] = [];
  const breaks: { from: number; kind: SlideBreak; }[] = [];
  const inCode = fencedCodeLines();
  let block = 0;
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    while (block < blocks.length && blocks[block].to < line.from) block++;
    const contained = block < blocks.length && line.from >= blocks[block].from && line.to <= blocks[block].to;
    // The fence tracker reads every line in turn; a container block's lines only count as content.
    if (inCode(line.text) || contained) {
      reader.content(headings.get(line.from));
      continue;
    }
    if (rules.has(line.from)) {
      reader.break('slide');
      breaks.push({ from: line.from, kind: 'slide' });
      continue;
    }
    const directive = parseDirectiveLine(line.text);
    if (directive && isSlideDirective(directive.name)) {
      const pageBreak = directive.form === 'leaf' && directive.name === 'vertical' && !directive.rawAttrs;
      lines.push({ from: line.from, to: line.to, text: line.text, name: directive.name, form: directive.form, pageBreak });
      if (pageBreak) {
        reader.break('page');
        breaks.push({ from: line.from, kind: 'page' });
      } else if (directive.form === 'leaf' && (directive.name === 'block' || directive.name === 'slide')) reader.starts();
      // A directive in the wrong form is drawn as an error box, which a slide shows.
      else reader.content();
      continue;
    }
    if (line.text.trim()) reader.content(headings.get(line.from));
  }
  const labels = reader.labels();
  return { lines, separators: new Map(breaks.map(({ from, kind }, index) => [from, { kind, label: labels[index] }])), end: labels[breaks.length] };
}
