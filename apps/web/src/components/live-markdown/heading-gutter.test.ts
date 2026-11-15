import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { collabHeadingGutter, headingGutter } from './heading-gutter.js';

function marked(doc: string, field: typeof headingGutter) {
  // A full parse changes the tree, so the field recomputes over the whole document.
  const start = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), field] });
  ensureSyntaxTree(start, start.doc.length, 5000);
  const state = start.update({}).state;
  const lines: [number, string][] = [];
  for (const iter = state.field(field).iter(); iter.value; iter.next()) lines.push([state.doc.lineAt(iter.from).number, (iter.value as unknown as { elementClass: string; }).elementClass]);
  return lines;
}

describe('heading gutter', () => {
  const doc = '---\ntitle: Ideas\nstatus: draft\n---\n\n# Body\n';

  it('marks body headings in the collab editor but not the leading frontmatter read as a setext heading', () => {
    expect(marked(doc, collabHeadingGutter)).toEqual([[6, 'cm-heading-gutter cm-heading-gutter-1']]);
  });

  it('keeps the setext heading in the direct editor, whose decorations still draw it', () => {
    expect(marked(doc, headingGutter).map(([line]) => line)).toEqual([2, 6]);
  });
});
