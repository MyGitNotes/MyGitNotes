import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Range, RangeSet, StateField } from '@codemirror/state';
import { gutterLineClass, GutterMarker } from '@codemirror/view';
import { frontmatterEnd } from './collab-frontmatter.js';

/** Marks a heading line's gutter cells with its level, so the line number can sit beside the heading text. */
class HeadingGutterClass extends GutterMarker {
  elementClass: string;
  constructor(readonly level: number) {
    super();
    this.elementClass = `cm-heading-gutter cm-heading-gutter-${level}`;
  }
  eq(other: HeadingGutterClass) {
    return other.level === this.level;
  }
}

const markers = [1, 2, 3, 4, 5, 6].map(level => new HeadingGutterClass(level));

function headingLines(state: EditorState, skipFrontmatter: boolean) {
  // The collab editor holds the file's frontmatter, whose closing `---` the parser reads as a setext underline.
  const bodyFrom = skipFrontmatter ? frontmatterEnd(state) : 0;
  const ranges: Range<GutterMarker>[] = [];
  syntaxTree(state).iterate({
    enter: ({ name, from }) => {
      const level = /^(?:ATX|Setext)Heading([1-6])$/.exec(name)?.[1];
      if (level && from >= bodyFrom) ranges.push(markers[Number(level) - 1].range(state.doc.lineAt(from).from));
    },
  });
  return RangeSet.of(ranges, true);
}

const gutterField = (skipFrontmatter: boolean) => StateField.define<RangeSet<GutterMarker>>({ create: state => headingLines(state, skipFrontmatter), update: (value, transaction) => syntaxTree(transaction.state) === syntaxTree(transaction.startState) ? value : headingLines(transaction.state, skipFrontmatter), provide: field => gutterLineClass.from(field) });

/** Heading-level classes for the gutter, recomputed whenever the parser's tree changes. */
export const headingGutter = gutterField(false);

/** The collab editor's heading gutter: the leading frontmatter is drawn as frontmatter, so its lines get no heading class. */
export const collabHeadingGutter = gutterField(true);
