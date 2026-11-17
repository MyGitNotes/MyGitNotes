// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';
import { theme } from './theme.js';

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

it('sizes the content to the room the line-number gutter leaves, not to the whole scroller', () => {
  view = new EditorView({ state: EditorState.create({ doc: 'a long line', extensions: [theme, lineNumbers(), EditorView.lineWrapping] }), parent: document.body });
  const content = getComputedStyle(view.contentDOM);
  // A 100% width beside the gutter made the scroller wider than its pane, so long lines and tables were cut off.
  expect(content.width).not.toBe('100%');
  expect(content.flexBasis).toBe('0px');
  expect(content.minWidth).toBe('0px');
});

// VQ P3: the gutter sat at the scroller's edge, off the page card, and its rule ran on below the card's end.
it('keeps the line-number gutter beside the text and as tall as the card, the pair centred where the text alone was', () => {
  view = new EditorView({ state: EditorState.create({ doc: 'a', extensions: [theme, lineNumbers()] }), parent: document.body });
  const gutters = getComputedStyle(view.dom.querySelector('.cm-gutters')!);
  expect(gutters.marginLeft).toBe('auto');
  expect(gutters.height).toBe('calc(100% - 48px)');
  expect(getComputedStyle(view.contentDOM).marginLeft).toBe('0px');
  expect(getComputedStyle(view.contentDOM).marginRight).toBe('auto');
  view.destroy();
  // Without line numbers the text keeps its own centring.
  view = new EditorView({ state: EditorState.create({ doc: 'a', extensions: [theme] }), parent: document.body });
  expect(getComputedStyle(view.contentDOM).marginLeft).toBe('auto');
});
