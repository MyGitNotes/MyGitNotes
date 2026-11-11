import { Facet } from '@codemirror/state';
import { type EditorView, WidgetType } from '@codemirror/view';
import type { CitationEntry, CitationLookup } from '@mygitnotes/core/citations';

/** The bibliography of the thesis-toolkit project a note belongs to. */
export interface CitationLibrary extends CitationLookup {
  entries: readonly CitationEntry[];
}

export function citationLibraryOf(entries: readonly CitationEntry[]): CitationLibrary {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  return { entries, get: key => byKey.get(key) };
}

/**
 * The bibliography the editor's note cites from, or null for a note outside a thesis-toolkit project (and in remote
 * mode), where `[@key]` stays plain text and `@` keeps completing task tokens only.
 */
export const citationLibrary = Facet.define<CitationLibrary | null, CitationLibrary | null>({ combine: values => values.find(value => value !== null) ?? null });

/** A citation drawn as the PDF prints it, in place of its source; the source comes back when the caret enters its line. */
export class CitationChip extends WidgetType {
  constructor(readonly text: string, readonly source: string) {
    super();
  }
  eq(other: CitationChip) {
    return this.text === other.text && this.source === other.source;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'live-md-citation';
    dom.textContent = this.text;
    dom.title = this.source;
    dom.addEventListener('mousedown', event => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(dom) } });
      view.focus();
    });
    return dom;
  }
}

/**
 * The key being typed when `before`, a line up to the caret, ends inside citation brackets right after an `@`:
 * `[@so`, `[-@so`, `[@a, 23; @so`. Null anywhere else, including after a locator's comma.
 */
export function citationKeyAt(before: string): string | null {
  const open = before.lastIndexOf('[');
  if (open === -1 || before.includes(']', open)) return null;
  const inside = before.slice(open + 1);
  if (!/^\s*-?@/.test(inside)) return null;
  return /^\s*-?@([\p{L}\p{N}_:./-]*)$/u.exec(inside.slice(inside.lastIndexOf(';') + 1))?.[1] ?? null;
}
