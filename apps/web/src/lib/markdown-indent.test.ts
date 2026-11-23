import { describe, expect, it } from 'vitest';
import { applyEdits } from './markdown-format.js';
import { indentLines } from './markdown-indent.js';

/** Runs the command on a document whose selection is marked `[` (anchor) and `]` (head), or `|` for a caret. */
function run(marked: string, direction: 'more' | 'less') {
  const caret = marked.indexOf('|');
  const anchor = caret >= 0 ? caret : marked.indexOf('[');
  const doc = marked.replace(/[[\]|]/g, '');
  const head = caret >= 0 ? caret : marked.indexOf(']') - 1;
  const result = indentLines(doc, anchor, head, direction);
  const next = applyEdits(doc, result.changes);
  if (result.anchor === result.head) return next.slice(0, result.anchor) + '|' + next.slice(result.anchor);
  return next.slice(0, result.anchor) + '[' + next.slice(result.anchor, result.head) + ']' + next.slice(result.head);
}

describe('Tab and Shift+Tab in the source editor', () => {
  it('nests the list item under the caret and moves the caret with its text', () => {
    expect(run('- a\n- b|\n- c', 'more')).toBe('- a\n  - b|\n- c');
    expect(run('- a\n|- b', 'more')).toBe('- a\n  |- b');
    expect(run('- a\n  - b|', 'less')).toBe('- a\n- b|');
  });

  it('indents every line the selection touches, but not the line it ends at the start of', () => {
    expect(run('[a\nb\n]c', 'more')).toBe('[  a\n  b\n]c');
    expect(run('x[a\nb]', 'more')).toBe('  x[a\n  b]');
  });

  it('removes one level of spaces or a tab, and leaves a line without leading space as it is', () => {
    expect(run('[    a\n\tb\n c\nd]', 'less')).toBe('[  a\nb\nc\nd]');
    expect(run('  a|b', 'less')).toBe('a|b');
    expect(run(' |ab', 'less')).toBe('|ab');
  });

  it('indents an empty last line', () => {
    expect(run('a\n|', 'more')).toBe('a\n  |');
  });
});
