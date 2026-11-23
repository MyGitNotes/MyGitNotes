import type { FormatResult, TextEdit } from './markdown-format.js';

/** One level of indentation: CodeMirror's default unit, which nests a list item under a `-` item. */
export const INDENT = '  ';

/**
 * Tab and Shift+Tab in the source textarea, as CodeMirror's `indentMore` and `indentLess` in the other editors: every
 * line the selection touches (not a line the selection merely ends at the start of) gains one level, or loses one level
 * of its leading spaces or a tab. The selection keeps to the same text; a caret at the start of its line moves past the
 * new indentation, as one typed there.
 */
export function indentLines(doc: string, anchor: number, head: number, direction: 'more' | 'less'): FormatResult {
  const from = Math.min(anchor, head), to = Math.max(anchor, head), empty = from === to;
  const changes: TextEdit[] = [];
  for (let start = doc.lastIndexOf('\n', from - 1) + 1; start <= doc.length;) {
    if (!empty && start >= to && start > from) break;
    if (direction === 'more') changes.push({ from: start, to: start, insert: INDENT });
    else {
      const lead = /^(\t| {1,2})/.exec(doc.slice(start, start + 2))?.[0];
      if (lead) changes.push({ from: start, to: start + lead.length, insert: '' });
    }
    const end = doc.indexOf('\n', start);
    if (end < 0 || end >= to) break;
    start = end + 1;
  }
  const map = (position: number) => changes.reduce((moved, change) => change.from > position || (change.from === position && !empty) ? moved : moved + change.insert.length - (Math.min(change.to, position) - change.from), position);
  return { changes, anchor: map(anchor), head: map(head) };
}
