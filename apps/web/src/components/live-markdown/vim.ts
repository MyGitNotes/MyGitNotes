import { Compartment, type Extension, Prec } from '@codemirror/state';
import { drawSelection, type EditorView, ViewPlugin } from '@codemirror/view';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import { VIM_COMMAND_EVENT, VIM_MODE_ATTRIBUTE, type VimCommand } from '../../lib/vim-mode.js';

/** The ex commands the note answers, as Vim's name, its shortest form, and what the note does. */
const EX_COMMANDS: readonly (readonly [string, string, VimCommand])[] = [['write', 'w', 'write'], ['quit', 'q', 'quit'], ['wq', 'wq', 'writeQuit'], ['xit', 'x', 'writeQuit']];
let exDefined = false;

/** Mirrors Vim's mode onto the editor element, where the note's Escape handler reads it without loading this package. */
const modeAttribute = ViewPlugin.define(view => {
  const cm = getCM(view);
  view.dom.setAttribute(VIM_MODE_ATTRIBUTE, 'normal');
  const onChange = (event: { mode: string; }) => view.dom.setAttribute(VIM_MODE_ATTRIBUTE, event.mode);
  cm?.on('vim-mode-change', onChange);
  return {
    destroy() {
      cm?.off('vim-mode-change', onChange);
      view.dom.removeAttribute(VIM_MODE_ATTRIBUTE);
    },
  };
});

/**
 * Vim key bindings, ahead of every other keymap so normal mode owns Enter, Tab and the letters before the outline and
 * formatting keymaps; in insert mode Vim passes those keys on. Visual mode draws its selection with `drawSelection`, which
 * the file source editor lacks otherwise. `:w`, `:q`, `:wq` and `:x` ask the note around the editor to commit, close, or
 * both; where no note answers, as in the file source editor, they do nothing.
 */
export function vimKeys(): Extension {
  if (!exDefined) {
    for (const [name, prefix, command] of EX_COMMANDS) {
      Vim.defineEx(name, prefix, (cm: { cm6: EditorView; }) => {
        cm.cm6.dom.dispatchEvent(new CustomEvent<VimCommand>(VIM_COMMAND_EVENT, { bubbles: true, detail: command }));
      });
    }
    exDefined = true;
  }
  return [Prec.highest([vim({ status: true }), modeAttribute]), drawSelection()];
}

/** A compartment holding the Vim bindings while `enabled`, so Settings can turn them on and off in an open editor. */
export function vimCompartment() {
  const compartment = new Compartment();
  const content = (enabled: boolean) => enabled ? vimKeys() : [];
  return { of: (enabled: boolean) => compartment.of(content(enabled)), reconfigure: (enabled: boolean) => compartment.reconfigure(content(enabled)) };
}
