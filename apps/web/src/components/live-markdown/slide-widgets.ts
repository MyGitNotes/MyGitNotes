import { type EditorView, WidgetType } from '@codemirror/view';
import { renderNote } from '../../lib/markdown.js';

function placeCaret(view: EditorView, dom: HTMLElement, from: number) {
  dom.addEventListener('mousedown', event => {
    event.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
}

/**
 * A slide directive that stands on a line of its own in a slide note, drawn as the preview draws it: the title bar of a `::block`, or the
 * error box of a directive contour-deck refuses. A `::slide{#id}` shows nothing in the preview, so here its source stays as a quiet line
 * the writer can still reach.
 */
export class SlideDirectiveLine extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly notebookId?: string) {
    super();
  }
  eq(other: SlideDirectiveLine) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.notebookId === other.notebookId;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'live-md-directive live-md-slide-directive live-md-rendered prose-custom';
    dom.innerHTML = renderNote(this.text, this.path, undefined, undefined, this.notebookId, { slides: 'preview' });
    if (dom.querySelector('.slide-anchor')) {
      dom.className = 'live-md-directive live-md-slide-directive live-md-slide-quiet';
      dom.textContent = this.text.trim();
    }
    placeCaret(view, dom, this.from);
    return dom;
  }
  get estimatedHeight() {
    return 36;
  }
}

/** A `::block` or `::slide` line of a note that is no deck: it draws nothing there, so its source reads as a quiet chip. */
export class SlideDirectiveChip extends WidgetType {
  constructor(readonly text: string, readonly from: number) {
    super();
  }
  eq(other: SlideDirectiveChip) {
    return this.text === other.text && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('span');
    dom.className = 'live-md-slide-quiet';
    dom.textContent = this.text.trim();
    placeCaret(view, dom, this.from);
    return dom;
  }
}
