// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { deleteCharBackward } from '@codemirror/commands';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { inlineIconAtomicRanges } from './inline-icons.js';
import { QrCodeWidget } from './qrcode-widgets.js';

const toCanvas = vi.hoisted(() => vi.fn(async (canvas: HTMLCanvasElement, _text: string, options: { width: number; }) => {
  canvas.width = options.width;
  canvas.height = options.width;
}));
vi.mock('qrcode', () => ({ default: { toCanvas } }));

const t = (key: string) => key;
const decorations = StateField.define<DecorationSet>({ create: state => liveDecorations(state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), update: (_value, tr) => liveDecorations(tr.state, true, 'n.md', 'link', 'table', 'page', 'owner', t as never), provide: field => EditorView.decorations.from(field) });

const views: EditorView[] = [];
function editor(doc: string, cursor = doc.length) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, decorations, inlineIconAtomicRanges(view => view.state.field(decorations))] }) });
  views.push(view);
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({});
  return view;
}
afterEach(() => {
  while (views.length) views.pop()!.destroy();
  toCanvas.mockClear();
});

/** The QR codes the live editor draws, with the source each replaces. */
function codes(view: EditorView) {
  const found: { url: string; size: string; block: boolean; source: string; }[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (from, to, value: Decoration) => {
    const widget = value.spec.widget;
    if (widget instanceof QrCodeWidget) found.push({ url: widget.spec.url, size: widget.spec.size, block: widget.block, source: view.state.sliceDoc(from, to) });
  });
  return found;
}

const note = 'Scan :qrcode{url="https://example.com/a" size="90"} here.\n\n::qrcode{url="https://example.com/talk" size="160"}\n\nPlain `:qrcode{url="https://example.com/code"}` and\n\n```\n::qrcode{url="https://example.com/fence"}\n:qrcode{url="https://example.com/fence2"}\n```\n\nempty :qrcode{url=""} and\n\n::qrcode{url=""}\n\nend';

describe('QR codes in the live editor', () => {
  it('draws an inline :qrcode and a ::qrcode line as their codes, in place of their source', async () => {
    const view = editor(note);
    expect(codes(view)).toEqual([{ url: 'https://example.com/a', size: '90', block: false, source: ':qrcode{url="https://example.com/a" size="90"}' }, { url: 'https://example.com/talk', size: '160', block: true, source: '::qrcode{url="https://example.com/talk" size="160"}' }]);
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(view.dom.querySelectorAll('.live-md-qrcode canvas')).toHaveLength(2));
    const [inline, block] = [...view.dom.querySelectorAll<HTMLElement>('.live-md-qrcode')];
    expect(inline.tagName).toBe('SPAN');
    expect(inline.querySelector('canvas')!.getAttribute('width')).toBe('90');
    expect(block.tagName).toBe('DIV');
    expect(block.querySelector('a')?.getAttribute('href')).toBe('https://example.com/talk');
    expect(view.dom.textContent).not.toContain('::qrcode{url="https://example.com/talk"');
    expect(view.dom.textContent).toContain('Scan');
    // The open-link button the parser's reading of each address would draw goes with the source.
    expect(view.dom.querySelectorAll('.live-md-external-link')).toHaveLength(0);
  });

  it('leaves code, and a directive that names no address, as text', () => {
    const view = editor(note);
    expect(view.dom.textContent).toContain(':qrcode{url="https://example.com/code"}');
    expect(view.dom.textContent).toContain('::qrcode{url="https://example.com/fence"}');
    expect(view.dom.textContent).toContain(':qrcode{url="https://example.com/fence2"}');
    expect(view.dom.textContent).toContain('empty :qrcode{url=""} and');
    expect(view.dom.textContent).toContain('::qrcode{url=""}');
    expect(codes(view)).toHaveLength(2);
  });

  it('shows the source of the directive the caret is in, and only that one', () => {
    const inline = editor(note, note.indexOf('example.com/a') + 3);
    expect(codes(inline).map(code => code.block)).toEqual([true]);
    expect(inline.dom.textContent).toContain(':qrcode{url="https://example.com/a" size="90"}');
    const leaf = editor(note, note.indexOf('example.com/talk') + 3);
    expect(codes(leaf).map(code => code.block)).toEqual([false]);
    expect(leaf.dom.textContent).toContain('::qrcode{url="https://example.com/talk" size="160"}');
  });

  it('keeps an inline code drawn while the caret sits right beside it, so one just written reads as a code', () => {
    const end = note.indexOf('"90"}') + '"90"}'.length;
    expect(codes(editor(note, end)).map(code => code.url)).toEqual(['https://example.com/a', 'https://example.com/talk']);
  });

  it('removes the whole inline directive with Backspace at its edge', () => {
    const doc = 'a :qrcode{url="https://example.com"} b';
    const view = editor(doc, 2 + ':qrcode{url="https://example.com"}'.length);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe('a  b');
  });

  it('brings the source back when a code is clicked, and follows no link', () => {
    const view = editor(note);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    view.dom.querySelector('.live-md-qrcode a')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    view.dom.querySelector('.live-md-qrcode-inline')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(codes(view).map(code => code.block)).toEqual([true]);
  });

  it('stops drawing when its widget goes', async () => {
    const view = editor(note);
    await vi.waitFor(() => expect(toCanvas).toHaveBeenCalled());
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'nothing' } });
    expect(view.dom.querySelector('.live-md-qrcode')).toBeNull();
  });
});
