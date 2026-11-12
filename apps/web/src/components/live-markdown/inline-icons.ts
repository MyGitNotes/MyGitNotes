import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import { findInlineIcons, inlineIconHtml } from '../../lib/icons/inline-icon.js';

/** An icon directive drawn as the icon it names, in place of its source; the source returns when the caret enters it. */
export class InlineIconWidget extends WidgetType {
  constructor(readonly name: string, readonly size: string | undefined, readonly source: string) {
    super();
  }
  eq(other: InlineIconWidget) {
    return this.name === other.name && this.size === other.size && this.source === other.source;
  }
  toDOM(view: EditorView) {
    const template = document.createElement('template');
    template.innerHTML = inlineIconHtml(this.name || 'circle', this.size);
    const dom = template.content.firstElementChild as HTMLElement;
    dom.classList.add('live-md-icon');
    // A click puts the caret inside the source, which is what shows it.
    dom.addEventListener('mousedown', event => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(dom) + this.source.length - 1 } });
      view.focus();
    });
    return dom;
  }
}

/** Makes a drawn icon one unit for the caret and for Backspace/Delete, so deleting beside it removes the whole directive. */
export function inlineIconAtomicRanges(decorations: (view: EditorView) => DecorationSet) {
  return EditorView.atomicRanges.of(view => decorations(view).update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof InlineIconWidget }));
}

/**
 * Draws every `:icon` directive of the note as its icon, except in `taken` source (code, math, drawn blocks) and where
 * the caret or selection is inside the directive while the editor is being edited; what the Markdown parser made of the
 * directive's text (a styled underscore, a link button) goes with the source.
 */
export function addInlineIcons(marks: Range<Decoration>[], state: EditorState, taken: readonly { from: number; to: number; }[], editing: boolean): void {
  const text = state.doc.toString();
  if (!text.includes(':icon')) return;
  const drawn: { from: number; to: number; }[] = [];
  for (const icon of findInlineIcons(text)) {
    if (taken.some(range => icon.from < range.to && icon.to > range.from)) continue;
    // The caret beside the directive leaves it drawn, so a freshly inserted icon reads as one; one inside shows the source.
    if (editing && state.selection.ranges.some(range => range.from < icon.to && range.to > icon.from)) continue;
    drawn.push(icon);
    marks.push(Decoration.replace({ widget: new InlineIconWidget(icon.name, icon.size, text.slice(icon.from, icon.to)) }).range(icon.from, icon.to));
  }
  if (drawn.length === 0) return;
  for (let i = marks.length - 1; i >= 0; i--) {
    const { from, to, value } = marks[i];
    if (value.spec.widget instanceof InlineIconWidget) continue;
    if (drawn.some(range => from < to ? from >= range.from && to <= range.to : from > range.from && from < range.to)) marks.splice(i, 1);
  }
}
