import { EditorView, WidgetType } from '@codemirror/view';
import { renderNote } from '../lib/markdown.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import type { Translate } from './infographic-editor/labels.js';

/** Puts the cursor in the block, which shows its Markdown source in place of the figure. */
function openMarkdown(view: EditorView, from: number) {
  // Focus first: the block shows its source only while the editor has focus and the cursor is on it.
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.lineAt(from).to } });
}

/**
 * One argument-map block in the live editor: its figure, drawn as a note draws it, with a 「Markdown」 control that puts the
 * cursor in the source. Argument maps are edited as Markdown; there is no structured editor.
 */
export class LiveMarkdownArgumentMap extends WidgetType {
  constructor(readonly text: string, readonly path: string, readonly from: number, readonly readOnly: boolean, readonly t: Translate, readonly notebookId?: string) {
    super();
  }

  eq(other: LiveMarkdownArgumentMap) {
    return this.text === other.text && this.path === other.path && this.from === other.from && this.readOnly === other.readOnly && this.notebookId === other.notebookId;
  }

  // The figure's tabs and collapsible arguments handle their own events; CodeMirror must not treat a click or key in it as an edit.
  ignoreEvent() {
    return true;
  }

  toDOM(view: EditorView) {
    const { t } = this;
    const root = document.createElement('div');
    root.className = 'live-md-directive live-md-argument-map live-md-rendered prose-custom';
    root.contentEditable = 'false';
    root.dataset.directiveFrom = String(this.from);
    root.dataset.directiveType = 'argument-map';

    const children: HTMLElement[] = [];
    if (!this.readOnly) children.push(this.toolbar(view));
    const figure = document.createElement('div');
    figure.className = 'live-directive-preview-content';
    // renderNote ends in DOMPurify, so the parsed nodes are the sanitised figure.
    const rendered = new DOMParser().parseFromString(renderNote(this.text, this.path, undefined, youtubeLabels(t), this.notebookId), 'text/html');
    figure.append(...rendered.body.childNodes);
    figure.addEventListener('dblclick', event => {
      if (this.readOnly || (event.target as HTMLElement).closest('button, select, input, label, a, summary')) return;
      event.preventDefault();
      openMarkdown(view, this.from);
    });
    children.push(figure);
    root.replaceChildren(...children);
    return root;
  }

  private toolbar(view: EditorView): HTMLElement {
    const { t } = this;
    const toolbar = document.createElement('div');
    toolbar.className = 'live-directive-toolbar live-infographic-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', t('argumentMap.editor.toolbarLabel'));

    const badge = document.createElement('span');
    badge.className = 'live-infographic-badge';
    badge.textContent = t('argumentMap.editor.badge');
    toolbar.append(badge);

    const markdown = document.createElement('button');
    markdown.type = 'button';
    markdown.className = 'live-infographic-markdown-btn';
    markdown.textContent = t('argumentMap.editor.markdown');
    markdown.title = t('argumentMap.editor.markdownHint');
    markdown.setAttribute('aria-label', t('argumentMap.editor.markdownHint'));
    markdown.addEventListener('mousedown', event => event.preventDefault());
    markdown.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openMarkdown(view, this.from);
    });
    toolbar.append(markdown);
    return toolbar;
  }
}
