import { useSyncExternalStore } from 'react';

/**
 * The Vim key bindings of the CodeMirror editors (live preview and the file source editor), chosen per device in
 * Settings. This module holds only the preference and the DOM contract, so the main bundle never loads the Vim package;
 * the editors, which load lazily, build the extension in `components/live-markdown/vim.ts`.
 */
export const VIM_MODE_STORAGE_KEY = 'github-notes:vim-mode';

/** Raised from the editor's DOM by `:w`, `:q` and `:wq` (or `:x`), for the note around it to commit, close, or both. */
export const VIM_COMMAND_EVENT = 'mygitnotes:vim-command';
export type VimCommand = 'write' | 'quit' | 'writeQuit';

/** The editor's current Vim mode (`normal`, `insert`, `visual`, `replace`) on its `.cm-editor` element. */
export const VIM_MODE_ATTRIBUTE = 'data-vim-mode';

export function readVimMode(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (storage ?? globalThis.localStorage).getItem(VIM_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

let vimMode: boolean | undefined;
const listeners = new Set<() => void>();

/** The current choice, shared by every editor on the page. */
export const getVimMode = () => vimMode ??= readVimMode();

export function subscribeVimMode(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function writeVimMode(value: boolean, storage?: Pick<Storage, 'setItem'>) {
  vimMode = value;
  try {
    (storage ?? globalThis.localStorage).setItem(VIM_MODE_STORAGE_KEY, String(value));
  } catch { /* Keep the in-page preference. */ }
  for (const listener of listeners) listener();
}

/** Off when rendered on the server, where no device has chosen. */
export const useVimMode = () => useSyncExternalStore(subscribeVimMode, getVimMode, () => false);

/**
 * Whether Escape pressed at `target` belongs to Vim: leaving insert, visual or replace mode, or closing its `:` prompt.
 * In normal mode Escape is left to the note, which closes its panel with it.
 */
export function vimOwnsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const mode = target.closest(`[${VIM_MODE_ATTRIBUTE}]`)?.getAttribute(VIM_MODE_ATTRIBUTE);
  if (!mode) return false;
  return mode !== 'normal' || target.closest('.cm-panels') !== null;
}
