// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { afterEach, expect, it } from 'vitest';
import { gutterWidth, theme } from './theme.js';

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

// FU P3: turning line numbers on moved the text by half the gutter, the pair being centred where the text alone was.
it('keeps room on the right for the gutter, out of the margin beside the text, so the text stays where it was', async () => {
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('cm-gutters') ? 26 : 0;
    },
  });
  try {
    view = new EditorView({ state: EditorState.create({ doc: 'a', extensions: [theme, lineNumbers(), gutterWidth] }), parent: document.body });
    expect(getComputedStyle(view.scrollDOM).paddingRight).toBe('calc(16px + min(var(--cm-gutter-width, 0px), max(0px, (100% - 32px - var(--note-content-width, 880px)) / 2)))');
    await new Promise(resolve => requestAnimationFrame(resolve));
    await Promise.resolve();
    expect(view.dom.style.getPropertyValue('--cm-gutter-width')).toBe('26px');
    view.destroy();
    // Without a gutter the scroller keeps its own padding and the editor writes no width.
    view = new EditorView({ state: EditorState.create({ doc: 'a', extensions: [theme, gutterWidth] }), parent: document.body });
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(getComputedStyle(view.scrollDOM).paddingRight).toBe('16px');
    expect(view.dom.style.getPropertyValue('--cm-gutter-width')).toBe('');
  } finally {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
  }
});
