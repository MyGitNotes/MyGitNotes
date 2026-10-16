// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VIM_COMMAND_EVENT, type VimCommand } from '../../lib/vim-mode.js';
import { useVimCommands, type VimCommandHandlers } from './useVimCommands.js';

afterEach(cleanup);

function Note(handlers: VimCommandHandlers) {
  const root = useVimCommands(handlers);
  return createElement('div', { ref: root }, createElement('div', { className: 'cm-editor', 'data-testid': 'editor' }));
}

const raise = async (from: Element, command: VimCommand) => {
  await act(async () => {
    from.dispatchEvent(new CustomEvent(VIM_COMMAND_EVENT, { bubbles: true, detail: command }));
  });
};

it('writes on :w, closes on :q, and on :wq closes only once the write succeeded', async () => {
  const write = vi.fn(async () => true), quit = vi.fn();
  const { getByTestId, rerender } = render(createElement(Note, { write, quit }));
  const editor = getByTestId('editor');
  await raise(editor, 'write');
  expect(write).toHaveBeenCalledOnce();
  expect(quit).not.toHaveBeenCalled();
  await raise(editor, 'quit');
  expect(quit).toHaveBeenCalledOnce();
  await raise(editor, 'writeQuit');
  expect(write).toHaveBeenCalledTimes(2);
  expect(quit).toHaveBeenCalledTimes(2);
  // A failed commit keeps the note open, where its error shows.
  const failing = vi.fn(async () => false);
  rerender(createElement(Note, { write: failing, quit }));
  await raise(editor, 'writeQuit');
  expect(failing).toHaveBeenCalledOnce();
  expect(quit).toHaveBeenCalledTimes(2);
});

it('answers only the commands raised inside it, and lets :q pass where the note cannot close', async () => {
  const write = vi.fn(async () => true);
  const { getByTestId } = render(createElement(Note, { write }));
  const outside = document.body.appendChild(document.createElement('div'));
  await raise(outside, 'write');
  expect(write).not.toHaveBeenCalled();
  await raise(getByTestId('editor'), 'quit');
  await raise(getByTestId('editor'), 'writeQuit');
  expect(write).toHaveBeenCalledOnce();
  outside.remove();
});
