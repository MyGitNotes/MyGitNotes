import type { TranslationKey } from '../i18n/en.js';

/**
 * The Vim keys the shortcut help lists while Vim mode is on. Vim handles them itself (`@replit/codemirror-vim`), so they
 * are not KEYMAP entries; the ex commands are the ones the note answers (`components/live-markdown/vim.ts`). A key with a
 * modifier, or Escape, is shown in the platform's form; the rest are typed as written, `…` standing for what follows.
 */
export interface VimCheatsheetEntry {
  id: string;
  keys: readonly string[];
  title: TranslationKey;
}

const entry = (id: string, keys: readonly string[]): VimCheatsheetEntry => ({ id, keys, title: `vim.${id}` as TranslationKey });

export const VIM_CHEATSHEET: readonly VimCheatsheetEntry[] = [
  // Moving
  entry('moveChar', ['h', 'j', 'k', 'l']),
  entry('moveWord', ['w', 'b', 'e']),
  entry('moveLine', ['0', '^', '$']),
  entry('moveDocument', ['gg', 'G']),
  entry('moveParagraph', ['{', '}']),
  entry('moveHalfPage', ['Ctrl+D', 'Ctrl+U']),
  entry('findChar', ['f…', 't…']),
  entry('matchBracket', ['%']),
  // Typing
  entry('insert', ['i', 'a']),
  entry('insertLine', ['I', 'A']),
  entry('openLine', ['o', 'O']),
  entry('normal', ['Escape']),
  // Changing
  entry('deleteChar', ['x']),
  entry('deleteLine', ['dd']),
  entry('yankLine', ['yy']),
  entry('paste', ['p', 'P']),
  entry('operator', ['d…', 'c…', 'y…']),
  entry('undo', ['u', 'Ctrl+R']),
  entry('repeat', ['.']),
  entry('indent', ['>>', '<<']),
  // Selecting
  entry('visual', ['v', 'V', 'Ctrl+V']),
  entry('visualAct', ['d', 'y', 'c', '>']),
  // Searching
  entry('search', ['/', '?']),
  entry('searchNext', ['n', 'N']),
  entry('searchWord', ['*', '#']),
  // Commands
  entry('write', [':w']),
  entry('quit', [':q']),
  entry('writeQuit', [':wq', ':x']),
  entry('substitute', [':s/a/b/g', ':%s/a/b/g']),
];

/** Whether `keys` is a chord to show in the platform's form rather than typed text. */
export const isVimChord = (keys: string) => keys === 'Escape' || /^Ctrl\+./.test(keys);
