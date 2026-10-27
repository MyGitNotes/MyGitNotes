// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, WidgetType } from '@codemirror/view';
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

const editor = (extensions: unknown[] = []) => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'one two\nthree', extensions: [drawSelection(), restingCaret, ...extensions as never[]] }) });
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

class Card extends WidgetType {
  toDOM() {
    return document.createElement('div');
  }
}

it('draws no resting caret inside a block the blurred editor shows as a card, and keeps it beside one', async () => {
  // The live editor replaces a directive's lines with its card while unfocused; here the card covers both lines throughout.
  const collapsed = EditorView.decorations.of(Decoration.set(Decoration.replace({ widget: new Card() }).range(0, 13)));
  const view = editor([collapsed]);
  view.focus();
  view.dispatch({ selection: EditorSelection.cursor(4) });
  await settle();
  expect(view.dom.classList.contains('cm-caret-covered')).toBe(false);
  focusChatInput();
  await settle();
  expect(view.dom.classList.contains('cm-caret-covered')).toBe(true);
  expect(view.state.selection.main.head).toBe(4);

  const inline = editor([EditorView.decorations.of(Decoration.set(Decoration.replace({}).range(0, 3)))]);
  inline.focus();
  inline.dispatch({ selection: EditorSelection.cursor(2) });
  await settle();
  focusChatInput();
  await settle();
  expect(inline.dom.classList.contains('cm-caret-placed')).toBe(true);
  expect(inline.dom.classList.contains('cm-caret-covered')).toBe(false);
});
