import { EditorView, WidgetType } from '@codemirror/view';
import { AnnotateController } from './annotate-editor/controller.js';
import { annotateRequest, openAnnotateMode } from './annotate-editor/open-request.js';
import { controllerOf, forgetController, registerController } from './annotate-editor/registry.js';
import type { Translate } from './infographic-editor/labels.js';

/**
 * The last drawn height of each block, by note and position. A text change inside the block replaces its widget, and the
 * editor sizes the new one by `estimatedHeight` until it measures it; with the default estimate a tall block shrinks to
 * a line for a moment and the editor, which keeps the scroll anchored inside it, jumps far from where the writer was.
 */
const drawnHeights = new Map<string, number>();

/**
 * One `:::annotate` block in the live editor: the annotated image, edited in place. Unlike the other figure widgets, every
 * action is written to the note at once, so the widget is kept across the text change it causes (`updateDOM` accepts the new
 * text and the controller redraws), which keeps the selection, the mode and an open comment form.
 */
export class LiveMarkdownAnnotate extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly readOnly: boolean, readonly t: Translate, readonly notebookId?: string) {
    super();
  }

  /** Drawn but not edited: a block inside a blockquote carries the quote's markers on every line. */
  get quoted(): boolean {
    return /^\s*>/.test(this.text);
  }

  eq(other: LiveMarkdownAnnotate) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.readOnly === other.readOnly && this.notebookId === other.notebookId;
  }

  get estimatedHeight() {
    return drawnHeights.get(`${this.path}:${this.from}`) ?? -1;
  }

  // The widget handles its own events; CodeMirror must not treat a click or key in it as an edit.
  ignoreEvent() {
    return true;
  }

  updateDOM(dom: HTMLElement) {
    const controller = controllerOf(dom);
    // A widget is only kept for the block at the position it was drawn for: when another block moves into the place of a removed one,
    // taking its DOM would carry the other block's mode, selection and open comment form over.
    if (!controller || dom.dataset.directiveFrom !== String(this.from) || dom.dataset.annotatePath !== this.path || dom.dataset.annotateReadOnly !== String(this.readOnly)) return false;
    controller.retarget(this);
    return true;
  }

  destroy(dom: HTMLElement) {
    controllerOf(dom)?.destroy();
    forgetController(dom);
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-annotate live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = 'annotate';
    root.dataset.annotatePath = this.path;
    root.dataset.annotateReadOnly = String(this.readOnly);
    const controller = new AnnotateController(view, this, root, (host, height) => drawnHeights.set(`${host.path}:${host.from}`, height));
    registerController(root, controller);
    // A block just made from an image asks to start in annotate mode; the request is withdrawn once taken so a rebuilt widget does not repeat it.
    if (!this.readOnly && !this.quoted && view.state.field(annotateRequest, false) === this.from) {
      controller.startAnnotating();
      queueMicrotask(() => view.dispatch({ effects: openAnnotateMode.of(null) }));
    }
    return root;
  }
}
