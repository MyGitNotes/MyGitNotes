import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { RailAdapter, RailChange } from './adapter.js';
import { landmarksOf, type RailLabels, wholeTree } from './landmarks-of.js';
import { slideNote } from '../live-markdown/slide-structure.js';

export interface CodeMirrorRailOptions {
  /** Read when the landmarks are, so a language change shows at the next read. */
  labels: () => RailLabels;
  /** Where the note's body starts in the view's text: after the frontmatter a collab view holds. */
  bodyFrom?: (state: EditorState) => number;
}

export interface CodeMirrorRail {
  /** Goes in the view's extensions; it tells the rail of the view's changes. */
  extension: Extension;
  adapter: RailAdapter;
}

/**
 * The live editor's rail. Heights come from CodeMirror's height map (`lineBlockAt`), which holds the measured height of every block
 * drawn so far (images, diagrams and formulas included) and an estimate for the rest, so a mark moves as the reader scrolls a tall
 * widget into view and the view measures it; positions never come from counting lines.
 */
export function codeMirrorRail({ labels, bodyFrom = () => 0 }: CodeMirrorRailOptions): CodeMirrorRail {
  let view: EditorView | null = null;
  const listeners = new Set<(change: RailChange) => void>();
  const notify = (change: RailChange) => {
    for (const listener of listeners) listener(change);
  };
  const scrolled = () => notify('layout');
  const extension = ViewPlugin.define(created => {
    view = created;
    created.scrollDOM.addEventListener('scroll', scrolled, { passive: true });
    queueMicrotask(() => notify('doc'));
    return {
      update(update: ViewUpdate) {
        if (update.docChanged || update.startState.facet(slideNote) !== update.state.facet(slideNote)) notify('doc');
        else if (update.geometryChanged || update.heightChanged || update.viewportChanged || update.selectionSet) notify('layout');
      },
      destroy() {
        created.scrollDOM.removeEventListener('scroll', scrolled);
        if (view === created) view = null;
      },
    };
  });
  const adapter: RailAdapter = {
    scroller: () => view?.scrollDOM ?? null,
    landmarks: () => view ? landmarksOf(view.state, wholeTree(view.state), labels(), bodyFrom(view.state)) : { headings: [], breaks: [], endLabel: null },
    tops(places) {
      if (!view) return places.map(() => 0);
      const { doc } = view.state, scroller = view.scrollDOM;
      // The document's top within the scroller's content: the height map counts from there.
      const offset = view.documentTop - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
      return places.map(({ line, column }) => {
        const at = doc.line(Math.max(1, Math.min(line, doc.lines)));
        return offset + view!.lineBlockAt(at.from + Math.max(0, Math.min(column, at.length))).top;
      });
    },
    cursor() {
      if (!view) return null;
      const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
      return { line: line.number, column: head - line.from };
    },
    jumpTo(line) {
      if (!view) return;
      const { doc } = view.state;
      view.dispatch({ effects: EditorView.scrollIntoView(doc.line(Math.max(1, Math.min(line, doc.lines))).from, { y: 'start', yMargin: 20 }) });
    },
    remeasure: () => view?.requestMeasure(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { extension, adapter };
}
