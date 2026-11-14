import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import { parseDirectiveAttributes, QRCODE_LEAF, renderQrCode } from '../../lib/directives.js';
import { DEFAULT_QRCODE_SIZE, hydrateQrCodes, qrCodeSize } from '../../lib/qrcode.js';
import { ExternalLink } from './widgets.js';

/** What a `:qrcode` or `::qrcode` directive encodes and how large it draws; `url` is empty when it names nothing, and then nothing is drawn. */
type QrCodeSpec = { url: string; size: string; };

const specOf = (label: string | undefined, rawAttrs: string | undefined): QrCodeSpec => {
  const attrs = parseDirectiveAttributes(rawAttrs);
  return { url: (attrs.url || label || '').trim(), size: attrs.size || String(DEFAULT_QRCODE_SIZE) };
};

/** The directive when `line` is a `::qrcode{…}` on a line of its own that names an address. */
export function leafQrCode(line: string): QrCodeSpec | null {
  const match = QRCODE_LEAF.exec(line);
  const spec = match && specOf(match[1], match[2]);
  return spec?.url ? spec : null;
}

/**
 * A QR code directive drawn as the code it names, in place of its source: `::qrcode` as a block of its own, `:qrcode` in the line of text. The
 * source returns when the caret is on it; the code is drawn on a canvas once the widget is in the page, as a preview draws it.
 */
export class QrCodeWidget extends WidgetType {
  private stop = () => {};
  constructor(readonly spec: QrCodeSpec, readonly source: string, readonly block: boolean) {
    super();
  }
  eq(other: QrCodeWidget) {
    return this.spec.url === other.spec.url && this.spec.size === other.spec.size && this.source === other.source && this.block === other.block;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement(this.block ? 'div' : 'span');
    dom.className = this.block ? 'live-md-directive live-md-qrcode live-md-rendered prose-custom' : 'live-md-qrcode live-md-qrcode-inline prose-custom';
    dom.innerHTML = renderQrCode(this.spec, undefined, this.block ? 'div' : 'span');
    this.stop = hydrateQrCodes(dom, { onSettled: () => view.requestMeasure() });
    // The code is a link, but a click in the editor puts the caret in the source, which is what shows it.
    dom.addEventListener('click', event => event.preventDefault());
    dom.addEventListener('mousedown', event => {
      event.preventDefault();
      // The position is read when clicked, as the widget is kept while edits above move it.
      const from = view.posAtDOM(dom);
      view.dispatch({ selection: { anchor: this.block ? from : from + this.source.length - 1 } });
      view.focus();
    });
    return dom;
  }
  destroy() {
    this.stop();
  }
  get estimatedHeight() {
    return this.block ? qrCodeSize(this.spec.size) + 16 : -1;
  }
}

/** A `:qrcode{url="…"}` or `:qrcode[address]` in the text; a bare `:qrcode` and the `::qrcode` leaf are not it. Attributes never cross a line. */
const INLINE = /(?<!:):qrcode(?:\[([^\]\n]*)\](?:\{([^}\n]*)\})?|\{([^}\n]*)\})/g;

/**
 * Draws every inline `:qrcode` that names an address as its code, except in `taken` source (code, math, drawn blocks) and where the caret or
 * selection is inside the directive while the editor is being edited; what the Markdown parser made of the directive's text (an address
 * it linked) goes with the source.
 */
export function addInlineQrCodes(marks: Range<Decoration>[], state: EditorState, taken: readonly { from: number; to: number; }[], editing: boolean): void {
  const text = state.doc.toString();
  if (!text.includes(':qrcode')) return;
  const drawn: { from: number; to: number; }[] = [];
  for (const match of text.matchAll(INLINE)) {
    const from = match.index, to = from + match[0].length;
    const spec = specOf(match[1], match[2] ?? match[3]);
    if (!spec.url || taken.some(range => from < range.to && to > range.from)) continue;
    // The caret beside the directive leaves it drawn, so one just written reads as a code; one inside shows the source.
    if (editing && state.selection.ranges.some(range => range.from < to && range.to > from)) continue;
    drawn.push({ from, to });
    marks.push(Decoration.replace({ widget: new QrCodeWidget(spec, match[0], false) }).range(from, to));
  }
  if (drawn.length === 0) return;
  for (let i = marks.length - 1; i >= 0; i--) {
    const { from, to, value } = marks[i];
    if (value.spec.widget instanceof QrCodeWidget) continue;
    // The open-link button the parser's reading of the address gets sits at the address's end, which a directive's closing `"}` follows.
    if (drawn.some(range => from < to ? from >= range.from && to <= range.to : from > range.from && (from < range.to || (from === range.to && value.spec.widget instanceof ExternalLink)))) marks.splice(i, 1);
  }
}
