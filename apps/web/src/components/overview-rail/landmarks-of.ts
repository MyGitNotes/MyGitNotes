import { ensureSyntaxTree, type syntaxTree } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { findDirectiveBlocks } from '../../lib/directive-editing.js';
import { parseMarkdownOutline } from '../../lib/note-navigation.js';
import { noteBlocks, type RailBlock } from '../../lib/overview-rail/blocks.js';
import { linesOfOffsets, noteLandmarks, pageBreakOffsets, type RailLandmarks } from '../../lib/overview-rail/landmarks.js';
import { blockLabelText, type SlideLabelWording } from '../../lib/slides/structure.js';
import { editorSlideStructure, slideNote } from '../live-markdown/slide-structure.js';

type Tree = ReturnType<typeof syntaxTree>;

/** How the rail labels a page (`editor.page`) and a slide deck's block (`slides.blockNumberLabel`). */
export interface RailLabels {
  page: string;
  block: SlideLabelWording;
}

/** What the rail shows of a note: its landmarks, and the blocks its minimap draws. */
export interface RailContent extends RailLandmarks {
  blocks: RailBlock[];
}

/** The editor's whole parse when it has one within a moment, else a parse of the whole text: the rail marks the end of a note too. */
export function wholeTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, 50) ?? markdownLanguage.parser.parse(state.doc.toString());
}

/**
 * The rail's landmarks in an editor state: the outline's headings and the page breaks the live editor draws, labelled as it labels
 * them, with the note's blocks. A slide note (`slideNote`) breaks at every top-level thematic break, each labelled with the block that
 * ends there.
 */
export function landmarksOf(state: EditorState, tree: Tree, labels: RailLabels, bodyFrom = 0): RailContent {
  const text = state.doc.toString();
  const blocks = noteBlocks(text, tree, bodyFrom);
  if (!state.facet(slideNote)) return { ...noteLandmarks(text, tree, labels.page, bodyFrom), blocks };
  const bodyLine = state.doc.lineAt(bodyFrom).number;
  const structure = editorSlideStructure(state, findDirectiveBlocks(text, true), tree);
  const label = (block: number | undefined) => block === undefined ? '' : blockLabelText(block, labels.block);
  const offsets = pageBreakOffsets(tree, text, { slides: true, bodyFrom });
  const lines = linesOfOffsets(text, offsets);
  return { headings: parseMarkdownOutline(text).filter(heading => heading.line >= bodyLine).map(({ line, depth, label: name }) => ({ line, depth, label: name })), breaks: lines.map(line => ({ line, label: label(structure.blocks.get(state.doc.line(line).from)) })), endLabel: label(structure.end) || null, blocks };
}

/** The landmarks of a source text with no editor state of its own (the source editor's textarea). */
export function textLandmarks(text: string, slides: boolean, labels: RailLabels): RailContent {
  const state = EditorState.create({ doc: text, extensions: slideNote.of(slides) });
  return landmarksOf(state, markdownLanguage.parser.parse(text), labels);
}
