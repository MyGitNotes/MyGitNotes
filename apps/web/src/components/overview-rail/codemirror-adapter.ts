import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { RailAdapter, RailChange } from './adapter.js';
import { landmarksOf, type RailLabels, wholeTree } from './landmarks-of.js';
import { holdTop, releaseHold } from '../live-markdown/mermaid-scroll.js';
import { slideNote } from '../live-markdown/slide-structure.js';

export interface CodeMirrorRailOptions {
  /** Read when the landmarks are, so a language change shows at the next read. */
  labels: () => RailLabels;
  /** Where the note's body starts in the view's text: after the frontmatter a collab view holds. */
  bodyFrom?: (state: EditorState) => number;
}

/** A jump leaves this much room above the line it goes to. */
const JUMP_MARGIN = 20;

/** The document's top within the scroller's content: the height map counts from there. */
function contentOffset(view: EditorView): number {
  const scroller = view.scrollDOM;
  return view.documentTop - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
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
    landmarks: () => view ? landmarksOf(view.state, wholeTree(view.state), labels(), bodyFrom(view.state)) : { headings: [], breaks: [], endLabel: null, blocks: [] },
    tops(places) {
      if (!view) return places.map(() => 0);
      const { doc } = view.state, offset = contentOffset(view);
      return places.map(({ line, column }) => {
        const at = doc.line(Math.max(1, Math.min(line, doc.lines)));
        return offset + view!.lineBlockAt(at.from + Math.max(0, Math.min(column, at.length))).top;
      });
    },
    extents(lines) {
      if (!view) return lines.map(() => ({ top: 0, bottom: 0 }));
      const { doc } = view.state, offset = contentOffset(view);
      return lines.map(line => {
        const block = view!.lineBlockAt(doc.line(Math.max(1, Math.min(line, doc.lines))).from);
        return { top: offset + block.top, bottom: offset + block.bottom };
      });
    },
    metrics() {
      if (!view) return { lineHeight: 1, columns: 80 };
      return { lineHeight: view.defaultLineHeight, columns: Math.max(20, Math.floor(view.contentDOM.clientWidth / Math.max(1, view.defaultCharacterWidth))) };
    },
    cursor() {
      if (!view) return null;
      const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
      return { line: line.number, column: head - line.from };
    },
    jumpTo(line) {
      if (!view) return;
      const { doc } = view.state;
      // Held there while the heights around it settle: lines never drawn hold estimates, and images load after the jump.
      holdTop(view, doc.line(Math.max(1, Math.min(line, doc.lines))).from, JUMP_MARGIN);
    },
    releaseJump: () => view && releaseHold(view),
    remeasure: () => view?.requestMeasure(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { extension, adapter };
}
