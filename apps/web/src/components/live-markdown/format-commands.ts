import { Prec } from '@codemirror/state';
import { type EditorView, keymap } from '@codemirror/view';
import { formatMarkdown, type MarkdownFormat } from '../../lib/markdown-format.js';
import { reportRefusal } from '../../lib/format-request.js';
import { codeMirrorBindings } from './editor-keymap.js';

/** Applies `format` to the main selection as one undoable edit. */
export function applyMarkdownFormat(view: EditorView, format: MarkdownFormat): boolean {
  if (view.state.readOnly) return false;
  const { from, to } = view.state.selection.main;
  const result = formatMarkdown(view.state.doc.toString(), from, to, format);
  if (result.refused) {
    reportRefusal(view.dom, result.refused);
    return true;
  }
  view.dispatch({ changes: result.changes, selection: { anchor: result.anchor, head: result.head }, scrollIntoView: true, userEvent: 'input.format' });
  view.focus();
  return true;
}

/** Bold, italic and underline (Mod-b, Mod-i, Mod-u in the table) and Turn into QR code, ahead of the other editing keys. */
export const formatKeymap = Prec.high(keymap.of(codeMirrorBindings('markdown-editor', { 'format.bold': { run: view => applyMarkdownFormat(view, 'bold') }, 'format.italic': { run: view => applyMarkdownFormat(view, 'italic') }, 'format.underline': { run: view => applyMarkdownFormat(view, 'underline') }, 'format.qrcode': { run: view => applyMarkdownFormat(view, 'qrcode') } })));
