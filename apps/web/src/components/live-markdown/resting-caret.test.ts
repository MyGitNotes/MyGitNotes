// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { restingCaret } from './resting-caret.js';

// jsdom lays nothing out; drawSelection measures the caret's rectangle.
beforeAll(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.remove();
  }
  document.body.replaceChildren();
});

const editor = () => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'one two\nthree', extensions: [drawSelection(), restingCaret] }) });
  views.push(view);
  return view;
};

/** Focus moves to the chat input beside the editor, as when the writer turns to the agent. */
const focusChatInput = () => {
  const input = document.createElement('textarea');
  document.body.append(input);
  input.focus();
};

const settle = async () => {
  await vi.waitFor(() => expect(document.activeElement).not.toBeNull());
  await new Promise(resolve => setTimeout(resolve, 20));
};

it('marks no resting caret in an editor nobody has focused', () => {
  expect(editor().dom.classList.contains('cm-caret-placed')).toBe(false);
});

it('keeps the caret marked after focus moves from the editor to another input', async () => {
  const view = editor();
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(4) });
  await settle();
  expect(view.hasFocus).toBe(true);
  expect(view.dom.classList.contains('cm-caret-placed')).toBe(true);

  focusChatInput();
  await settle();
  expect(view.hasFocus).toBe(false);
  expect(view.dom.classList.contains('cm-caret-placed')).toBe(true);
  expect(view.dom.classList.contains('cm-focused')).toBe(false);
  expect(view.state.selection.main.head).toBe(4);
});
