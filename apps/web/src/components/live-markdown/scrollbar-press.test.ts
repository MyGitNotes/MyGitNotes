// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { isScrollbarPress, scrollbarPressGuard } from './scrollbar-press.js';

afterEach(() => document.body.replaceChildren());

/** A 300×100 scroller at (0, 0) whose bars take 6px: content 294 wide and 94 tall shows, the rest is scrollbar. */
function scroller(element: HTMLElement, { wide = true, tall = false } = {}) {
  const sizes = { clientWidth: 294, clientHeight: 94, scrollWidth: wide ? 900 : 294, scrollHeight: tall ? 400 : 94, clientLeft: 0, clientTop: 0 };
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(element, key, { value });
  element.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100);
  return element;
}

function press(target: Element, clientX: number, clientY: number) {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY });
  target.dispatchEvent(event);
  return event;
}

describe('isScrollbarPress', () => {
  it('tells a press on a horizontal scrollbar from one on the content above it', () => {
    const element = scroller(document.createElement('div'));
    document.body.append(element);
    const results: boolean[] = [];
    element.addEventListener('mousedown', event => results.push(isScrollbarPress(event)));
    press(element, 40, 97);
    press(element, 40, 50);
    expect(results).toEqual([true, false]);
  });
  it('counts a scrollbar only where the element scrolls on that axis', () => {
    const element = scroller(document.createElement('div'), { wide: false, tall: true });
    document.body.append(element);
    const results: boolean[] = [];
    element.addEventListener('mousedown', event => results.push(isScrollbarPress(event)));
    press(element, 40, 97);
    press(element, 297, 40);
    expect(results).toEqual([false, true]);
  });
});

class Diagram extends WidgetType {
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'diagram';
    const canvas = scroller(document.createElement('div'));
    canvas.className = 'canvas';
    canvas.append(document.createElement('svg'));
    wrapper.append(canvas);
    return wrapper;
  }
  ignoreEvent() {
    return true;
  }
}

describe('scrollbarPressGuard', () => {
  it('keeps a scrollbar press inside a drawn block from the block and the editor, and lets other presses through', () => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'a\nb', extensions: [scrollbarPressGuard, EditorView.decorations.of(Decoration.set([Decoration.replace({ widget: new Diagram(), block: true }).range(0, 1)]))] }) });
    const blockPress = vi.fn();
    const canvas = view.dom.querySelector<HTMLElement>('.canvas')!;
    view.dom.querySelector('.diagram')!.addEventListener('mousedown', blockPress);
    const onBar = press(canvas, 40, 97);
    expect(blockPress).not.toHaveBeenCalled();
    // The browser still drags the scrollbar: the press is not cancelled.
    expect(onBar.defaultPrevented).toBe(false);
    press(canvas, 40, 50);
    press(canvas.firstElementChild!, 40, 97);
    expect(blockPress).toHaveBeenCalledTimes(2);
    view.destroy();
  });
});
