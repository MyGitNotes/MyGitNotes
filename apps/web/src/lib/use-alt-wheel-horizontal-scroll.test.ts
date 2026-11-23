// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react', () => ({ useEffect: (effect: () => unknown) => effect() }));
import { useAltWheelHorizontalScroll } from './use-alt-wheel-horizontal-scroll.js';

afterEach(() => {
  document.body.replaceChildren();
});

/** An element whose content is `scrollWidth` wide in a `clientWidth` box, scrolling sideways when its style lets it. */
function box(tag: string, className: string, scrollWidth = 300, clientWidth = 300) {
  const element = document.createElement(tag);
  element.className = className;
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth });
  Object.defineProperty(element, 'clientWidth', { value: clientWidth });
  return element;
}

function setup(nested = true, enabled = true) {
  const host = box('div', 'surface');
  const prose = box('div', 'prose-custom');
  const table = box('div', 'table-scroll', 900, 300);
  table.style.overflowX = 'auto';
  const plain = box('div', 'plain', 900, 300);
  const cell = document.createElement('td');
  const text = document.createElement('p');
  table.append(cell);
  prose.append(table, plain, text);
  const aside = document.createElement('aside');
  host.append(prose, aside);
  document.body.append(host);
  const added = vi.spyOn(host, 'addEventListener');
  /* eslint-disable react-hooks/rules-of-hooks -- This unit harness invokes mocked React hooks to exercise event registration without rendering. */
  useAltWheelHorizontalScroll({ current: host }, { current: host }, nested ? '.prose-custom *' : undefined, enabled, nested ? '.prose-custom' : undefined);
  /* eslint-enable react-hooks/rules-of-hooks */
  let time = 0;
  const wheel = (target: Element, init: WheelEventInit & { at?: number; } = {}) => {
    time = init.at ?? time + 16;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, altKey: true, deltaY: 40, ...init });
    Object.defineProperty(event, 'timeStamp', { value: time });
    const stop = vi.spyOn(event, 'stopPropagation');
    target.dispatchEvent(event);
    return { prevented: event.defaultPrevented, stopped: stop.mock.calls.length > 0 };
  };
  return { host, table, plain, cell, text, aside, added, wheel };
}

describe('Alt wheel horizontal scrolling', () => {
  it('routes vertical wheel input to the sideways scroller under the pointer and keeps it from the page', () => {
    const { table, cell, wheel } = setup();
    expect(wheel(cell)).toEqual({ prevented: true, stopped: true });
    expect(table.scrollLeft).toBe(40);
  });
  it('takes the first event of a gesture even when it carries no vertical movement, so the page never scrolls with it', () => {
    const { table, cell, wheel } = setup();
    // A trackpad gesture can open with an empty or sideways event; Chrome lets the page cancel only that first event.
    expect(wheel(cell, { deltaY: 0 }).prevented).toBe(true);
    expect(wheel(cell, { deltaX: 30, deltaY: 2 }).prevented).toBe(true);
    expect(wheel(cell, { deltaY: 40 }).prevented).toBe(true);
    expect(table.scrollLeft).toBe(70);
  });
  it('keeps the gesture on its scroller while it lasts, through a released Alt key, and lets go after a pause', () => {
    const { table, cell, text, wheel } = setup();
    wheel(cell, { at: 0 });
    expect(wheel(text, { altKey: false, at: 100 }).prevented).toBe(true);
    expect(table.scrollLeft).toBe(80);
    expect(wheel(text, { altKey: false, at: 1000 }).prevented).toBe(false);
    expect(table.scrollLeft).toBe(80);
  });
  it('leaves ordinary wheel input and Alt+wheel outside the note text to the browser', () => {
    const { table, cell, aside, wheel } = setup();
    expect(wheel(cell, { altKey: false }).prevented).toBe(false);
    expect(wheel(aside).prevented).toBe(false);
    expect(wheel(cell, { ctrlKey: true }).prevented).toBe(false);
    expect(table.scrollLeft).toBe(0);
  });
  // Boss: holding Alt in the editor, the note must not scroll up or down, also where nothing under the pointer scrolls sideways.
  it('keeps Alt+wheel over note text with nothing to scroll sideways from scrolling the note vertically', () => {
    const { table, plain, text, wheel } = setup();
    // `plain` is wider than its box but its style does not scroll; `text` is not wider at all.
    expect(wheel(plain)).toEqual({ prevented: true, stopped: false });
    expect(wheel(text, { at: 1000 }).prevented).toBe(true);
    expect(plain.scrollLeft).toBe(0);
    expect(table.scrollLeft).toBe(0);
  });
  it('scrolls its own scroller in line units without a nested selector', () => {
    const { host, text, wheel } = setup(false);
    const result = wheel(text, { deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(result).toEqual({ prevented: true, stopped: false });
    expect(host.scrollLeft).toBe(640);
  });
  it('registers nothing where the scroller does not scroll sideways', () => {
    const { added } = setup(false, false);
    expect(added).not.toHaveBeenCalled();
  });
  it('leaves events already handled by a nested scroller alone', () => {
    const { host, text } = setup(false);
    text.addEventListener('wheel', event => event.preventDefault());
    text.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, altKey: true, deltaY: 40 }));
    expect(host.scrollLeft).toBe(0);
  });
});
