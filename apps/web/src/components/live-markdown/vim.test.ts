// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { VIM_COMMAND_EVENT, type VimCommand } from '../../lib/vim-mode.js';
import { vimCompartment, vimKeys } from './vim.js';

// jsdom lays nothing out; CodeMirror measures text ranges when Vim's prompt opens.
beforeAll(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
});

const editor = (extension = vimKeys()) => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'one two\nthree', extensions: [extension] }) });
  views.push(view);
  return view;
};
const keys = (view: EditorView, ...sequence: string[]) => {
  for (const key of sequence) Vim.handleKey(getCM(view)!, key, 'user');
};

it("puts Vim's mode on the editor element and shows Vim's status line", () => {
  const view = editor();
  expect(view.dom.getAttribute('data-vim-mode')).toBe('normal');
  keys(view, 'i');
  expect(view.dom.getAttribute('data-vim-mode')).toBe('insert');
  keys(view, '<Esc>', 'v');
  expect(view.dom.getAttribute('data-vim-mode')).toBe('visual');
  keys(view, '<Esc>');
  expect(view.dom.getAttribute('data-vim-mode')).toBe('normal');
  expect(view.dom.querySelector('.cm-vim-panel')).not.toBeNull();
});

it('edits in normal mode: dd deletes the line', () => {
  const view = editor();
  keys(view, 'd', 'd');
  expect(view.state.doc.toString()).toBe('three');
});

it('raises :w, :q, :wq and :x from the editor element for the note around it', () => {
  const view = editor();
  const raised: VimCommand[] = [];
  document.body.addEventListener(VIM_COMMAND_EVENT, event => raised.push((event as CustomEvent<VimCommand>).detail));
  // The `:` prompt hands what was typed to the same dispatcher.
  for (const command of ['w', 'q', 'wq', 'x', 'write']) Vim.handleEx(getCM(view) as Parameters<typeof Vim.handleEx>[0], command);
  expect(raised).toEqual(['write', 'quit', 'writeQuit', 'writeQuit', 'write']);
});

it('turns the bindings on and off in an open editor through its compartment', () => {
  const vim = vimCompartment();
  const view = editor(vim.of(false));
  expect(view.dom.hasAttribute('data-vim-mode')).toBe(false);
  view.dispatch({ effects: vim.reconfigure(true) });
  expect(view.dom.getAttribute('data-vim-mode')).toBe('normal');
  view.dispatch({ effects: vim.reconfigure(false) });
  expect(view.dom.hasAttribute('data-vim-mode')).toBe(false);
  expect(getCM(view)).toBeNull();
});
