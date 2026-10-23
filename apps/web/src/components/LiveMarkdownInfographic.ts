import { EditorView, WidgetType } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setAttr } from '../lib/infographics/grid.js';
import { INFOGRAPHIC_PALETTES, type InfographicBlock, type InfographicKind, parseInfographic, serializeInfographic } from '../lib/infographics/model.js';
import { renderNote } from '../lib/markdown.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { InfographicEditor } from './infographic-editor/InfographicEditor.js';
import { kindLabel, optionLabel, problemText, type Translate } from './infographic-editor/labels.js';
import { infographicEditorRequest, openInfographicEditor } from './infographic-editor/open-request.js';

const TITLE = { key: 'title', type: 'text' } as const;
const PALETTE = { key: 'palette', type: 'select' } as const;

/** Moves with the widget's DOM: CodeMirror hands a widget whose text is unchanged a new `from` without rebuilding it. */
class InfographicController {
  private editor: Root | null = null;

  constructor(private view: EditorView, private widget: LiveMarkdownInfographic, readonly dom: HTMLElement) {}

  retarget(widget: LiveMarkdownInfographic) {
    this.widget = widget;
    this.dom.dataset.directiveFrom = String(widget.from);
  }

  private get t(): Translate {
    return this.widget.t;
  }

  private figureHtml(source: string): string {
    return renderNote(source, this.widget.path, undefined, youtubeLabels(this.t), this.widget.notebookId);
  }

  /** Writes `next` over the block as one history entry. A source equal to the block's changes nothing. */
  private replace(next: string) {
    const { text, from } = this.widget;
    const insert = next.replace(/\n$/, '');
    if (insert === text || this.view.state.sliceDoc(from, from + text.length) !== text) return;
    this.view.dispatch({ changes: { from, to: from + text.length, insert }, annotations: isolateHistory.of('full'), userEvent: 'input.infographic' });
    this.view.requestMeasure();
  }

  private edit(change: (block: InfographicBlock) => InfographicBlock) {
    const block = parseInfographic(this.widget.text);
    if (block) this.replace(serializeInfographic(change(block)));
  }

  /** Puts the cursor in the block, which shows its Markdown source in place of the figure. */
  openMarkdown() {
    // Focus first: the block shows its source only while the editor has focus and the cursor is on it.
    this.view.focus();
    this.view.dispatch({ selection: { anchor: this.view.state.doc.lineAt(this.widget.from).to } });
  }

  private unmountEditor() {
    const root = this.editor;
    this.editor = null;
    // React must not be unmounted from inside a render; a save unmounts from the document update that follows it.
    if (root) queueMicrotask(() => root.unmount());
  }

  destroy() {
    this.unmountEditor();
  }

  openEditor() {
    const { widget } = this;
    const block = parseInfographic(widget.text);
    if (widget.readOnly || this.editor || !block || block.problems.length) return;
    this.dom.classList.add('live-directive-editing');
    const host = document.createElement('div');
    host.className = 'live-infographic-editor-host';
    this.dom.replaceChildren(host);
    this.editor = createRoot(host);
    this.editor.render(createElement(InfographicEditor, {
      source: widget.text,
      t: this.t,
      renderFigure: source => this.figureHtml(source),
      onSave: next => {
        this.replace(next);
        // A saved change rebuilds this widget; an unchanged block just returns to its figure.
        if (this.dom.isConnected && this.editor) this.closeEditor();
      },
      onClose: () => this.closeEditor(),
    }));
  }

  closeEditor() {
    this.unmountEditor();
    this.renderPreview();
    this.view.focus();
  }

  renderPreview() {
    const { widget, t } = { widget: this.widget, t: this.t };
    const block = parseInfographic(widget.text);
    const problem = block?.problems[0];
    this.dom.classList.remove('live-directive-editing');
    const children: HTMLElement[] = [];
    if (!widget.readOnly) children.push(this.toolbar(block, Boolean(problem)));
    const figure = document.createElement('div');
    figure.className = 'live-directive-preview-content';
    figure.innerHTML = this.figureHtml(widget.text);
    figure.addEventListener('dblclick', event => {
      if (widget.readOnly || (event.target as HTMLElement).closest('button, select, input, a, summary')) return;
      event.preventDefault();
      if (problem) this.openMarkdown();
      else this.openEditor();
    });
    children.push(figure);
    if (problem && !widget.readOnly) {
      const notice = document.createElement('p');
      notice.className = 'live-infographic-notice';
      notice.setAttribute('role', 'note');
      notice.textContent = t('infographic.editor.markdownOnly', { problem: problemText(t, problem, this.view.state.doc.lineAt(widget.from).number) });
      children.push(notice);
    }
    this.dom.replaceChildren(...children);
  }

  private toolbar(block: InfographicBlock | null, markdownOnly: boolean): HTMLElement {
    const { t } = this;
    const toolbar = document.createElement('div');
    toolbar.className = 'live-directive-toolbar live-infographic-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', t('infographic.editor.toolbarLabel'));

    const badge = document.createElement('span');
    badge.className = 'live-infographic-badge';
    badge.textContent = kindLabel(t, this.widget.kind);
    toolbar.append(badge);

    if (block && !markdownOnly) {
      const title = document.createElement('input');
      title.type = 'text';
      title.className = 'live-directive-title-input';
      title.value = block.attrs.title ?? '';
      title.placeholder = t('infographic.editor.titlePlaceholder');
      title.title = t('infographic.editor.titleField');
      title.setAttribute('aria-label', t('infographic.editor.titleField'));
      title.addEventListener('mousedown', event => event.stopPropagation());
      const commit = () => {
        if (title.value !== (block.attrs.title ?? '')) this.edit(current => setAttr(current, TITLE, title.value));
      };
      title.addEventListener('blur', commit);
      title.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          title.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          title.value = block.attrs.title ?? '';
          title.blur();
        }
      });
      toolbar.append(title);

      const palette = document.createElement('select');
      palette.className = 'live-infographic-palette';
      palette.title = t('infographic.editor.palette');
      palette.setAttribute('aria-label', t('infographic.editor.palette'));
      const current = block.attrs.palette ?? '';
      const options = ['', ...INFOGRAPHIC_PALETTES, ...(current && !INFOGRAPHIC_PALETTES.includes(current) ? [current] : [])];
      for (const value of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value ? optionLabel(t, value) : t('infographic.option.default');
        palette.append(option);
      }
      palette.value = current;
      palette.addEventListener('mousedown', event => event.stopPropagation());
      palette.addEventListener('change', () => this.edit(next => setAttr(next, PALETTE, palette.value)));
      toolbar.append(palette);

      toolbar.append(this.button('live-directive-edit-btn', t('infographic.editor.editData'), t('infographic.editor.editDataHint'), () => this.openEditor()));
    }
    toolbar.append(this.button('live-infographic-markdown-btn', t('infographic.editor.markdown'), t('infographic.editor.markdownHint'), () => this.openMarkdown()));
    return toolbar;
  }

  private button(className: string, label: string, title: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', label);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    return button;
  }
}

const controllers = new WeakMap<HTMLElement, InfographicController>();

/** One infographic block in the live editor: its figure with a toolbar, and the data editor in the figure's place. */
export class LiveMarkdownInfographic extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly readOnly: boolean, readonly kind: InfographicKind, readonly t: Translate, readonly notebookId?: string) {
    super();
  }

  eq(other: LiveMarkdownInfographic) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.readOnly === other.readOnly && this.kind === other.kind && this.notebookId === other.notebookId;
  }

  // Everything inside the widget handles its own events; CodeMirror must not treat a click or key in it as an edit.
  ignoreEvent() {
    return true;
  }

  updateDOM(dom: HTMLElement) {
    const controller = controllers.get(dom);
    if (!controller) return false;
    // Only a block that moved keeps its DOM, and with it an open editor; a changed block is drawn afresh.
    if (dom.dataset.infographicText !== this.text || dom.dataset.infographicPath !== this.path || dom.dataset.infographicReadOnly !== String(this.readOnly)) return false;
    controller.retarget(this);
    return true;
  }

  destroy(dom: HTMLElement) {
    controllers.get(dom)?.destroy();
    controllers.delete(dom);
  }

  toDOM(view: EditorView) {
    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-infographic live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = this.kind;
    root.dataset.infographicText = this.text;
    root.dataset.infographicPath = this.path;
    root.dataset.infographicReadOnly = String(this.readOnly);
    const controller = new InfographicController(view, this, root);
    controllers.set(root, controller);
    controller.renderPreview();
    // A block just inserted asks to be opened; the request is withdrawn once taken so a rebuilt widget does not reopen.
    if (!this.readOnly && view.state.field(infographicEditorRequest, false) === this.from) {
      controller.openEditor();
      queueMicrotask(() => view.dispatch({ effects: openInfographicEditor.of(null) }));
    }
    return root;
  }
}
