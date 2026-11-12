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
