// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getVimMode, readVimMode, subscribeVimMode, VIM_MODE_STORAGE_KEY, vimOwnsEscape, writeVimMode } from './vim-mode.js';

afterEach(() => {
  writeVimMode(false);
  localStorage.clear();
});

it('is off until this device turns it on, and tells every subscriber when it changes', () => {
  expect(readVimMode()).toBe(false);
  const listener = vi.fn();
  const unsubscribe = subscribeVimMode(listener);
  writeVimMode(true);
  expect(getVimMode()).toBe(true);
  expect(localStorage.getItem(VIM_MODE_STORAGE_KEY)).toBe('true');
  expect(readVimMode()).toBe(true);
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
});

it('gives Escape to Vim only inside a Vim editor that is not in normal mode, or in its prompt', () => {
  const plain = document.body.appendChild(document.createElement('textarea'));
  expect(vimOwnsEscape(plain)).toBe(false);
  expect(vimOwnsEscape(null)).toBe(false);
  const editor = document.body.appendChild(document.createElement('div'));
  const line = editor.appendChild(document.createElement('div'));
  const panels = editor.appendChild(document.createElement('div'));
  panels.className = 'cm-panels';
  editor.setAttribute('data-vim-mode', 'normal');
  expect(vimOwnsEscape(line)).toBe(false);
  expect(vimOwnsEscape(panels)).toBe(true);
  editor.setAttribute('data-vim-mode', 'insert');
  expect(vimOwnsEscape(line)).toBe(true);
  plain.remove();
  editor.remove();
});
