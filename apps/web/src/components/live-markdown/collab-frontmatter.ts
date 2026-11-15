import type { EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';

/** A note's leading YAML block, as the app reads frontmatter: `---`, its lines, and `---` again (§8.1). */
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
/** Frontmatter longer than this is not looked for: a note's metadata is a few lines. */
const MAX_FRONTMATTER = 64 * 1024;

/** Where the note's leading frontmatter ends, or 0 when it has none. */
export const frontmatterEnd = (state: EditorState): number => state.doc.sliceString(0, Math.min(state.doc.length, MAX_FRONTMATTER)).match(FRONTMATTER)?.[0].length ?? 0;

const line = Decoration.line({ class: 'live-md-frontmatter' });

/**
 * The collab editor holds the whole file, frontmatter included, where the direct editor shows only the body. The
 * leading YAML block keeps none of the body's decorations (a key over `---` read as a heading, `:48:` as a shortcode)
 * and its lines are marked `live-md-frontmatter`, drawn as plain monospace text; it stays text to edit.
 */
export function withFrontmatter(state: EditorState, decorations: DecorationSet): DecorationSet {
  const end = frontmatterEnd(state);
  if (!end) return decorations;
  const last = state.doc.lineAt(end - 1).number;
  const lines = [];
  for (let number = 1; number <= last; number++) lines.push(line.range(state.doc.line(number).from));
  return decorations.update({ filter: from => from >= end, add: lines, sort: true });
}
