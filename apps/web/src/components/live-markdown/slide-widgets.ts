import { type EditorView, WidgetType } from '@codemirror/view';
import { renderNote } from '../../lib/markdown.js';

function placeCaret(view: EditorView, dom: HTMLElement, from: number) {
  dom.addEventListener('mousedown', event => {
    event.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  });
}

/** A `::vertical` of a slide note: a divider lighter than a slide's, labelled with the page (or the slide) that ends there. */
export class SlidePageBreak extends WidgetType {
  constructor(readonly from: number, readonly label: string) {
    super();
  }
  eq(other: SlidePageBreak) {
    return this.from === other.from && this.label === other.label;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'live-md-slide-page-break';
    const rule = document.createElement('div');
    rule.className = 'live-md-slide-page-break-rule';
    dom.append(rule);
    if (this.label) {
      const tag = document.createElement('span');
      tag.className = 'live-md-slide-page-break-tag';
      tag.textContent = this.label;
      rule.append(tag);
    }
    placeCaret(view, dom, this.from);
    return dom;
  }
  get estimatedHeight() {
    return 32;
  }
}

/**
 * A slide directive that stands on a line of its own in a slide note, drawn as the preview draws it: the title bar of a `::block`, or the
 * error box of a directive contour-deck refuses. A `::slide{#id}` shows nothing in the preview, so here its source stays as a quiet line
 * the writer can still reach.
 */
export class SlideDirectiveLine extends WidgetType {
  /** `structure` is the note's `slideOptions.structure`, which decides what contour-deck takes: a `::vertical` is refused in a note read by its headings. */
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly notebookId?: string, readonly structure?: string) {
    super();
  }
  eq(other: SlideDirectiveLine) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.notebookId === other.notebookId && this.structure === other.structure;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement('div');
    dom.className = 'live-md-directive live-md-slide-directive live-md-rendered prose-custom';
    dom.innerHTML = renderNote(this.text, this.path, undefined, undefined, this.notebookId, { slides: 'preview', structure: this.structure });
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
