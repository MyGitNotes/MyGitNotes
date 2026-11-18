// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDoubleTap, createDoubleTapRecognizer, DOUBLE_TAP_DISTANCE_PX, DOUBLE_TAP_GAP_MS, editsOnDoubleTap, TAP_MAX_MS, TAP_SLOP_PX } from './double-tap.js';

const at = (x: number, y: number, time: number) => ({ x, y, time });
/** One tap from `time`, held `held` ms, ending `drift` px to the right of where it started. */
const tap = (recognizer: ReturnType<typeof createDoubleTapRecognizer>, x: number, y: number, time: number, held = 80, drift = 0) => {
  recognizer.start(at(x, y, time), 1);
  return recognizer.end(at(x + drift, y, time + held));
};

describe('createDoubleTapRecognizer', () => {
  it('reads two quick taps at one place as a double tap', () => {
    const recognizer = createDoubleTapRecognizer();
    expect(tap(recognizer, 100, 200, 0)).toBe(false);
    expect(tap(recognizer, 104, 203, 80 + DOUBLE_TAP_GAP_MS)).toBe(true);
  });

  it('starts over after a double tap, so a third tap is a first one', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    expect(tap(recognizer, 100, 200, 200)).toBe(true);
    expect(tap(recognizer, 100, 200, 400)).toBe(false);
  });

  it('ignores taps too far apart in time', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    expect(tap(recognizer, 100, 200, 80 + DOUBLE_TAP_GAP_MS + 1)).toBe(false);
  });

  it('ignores taps too far apart on the screen', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    expect(tap(recognizer, 100 + DOUBLE_TAP_DISTANCE_PX + 1, 200, 200)).toBe(false);
  });

  it('does not count a press held longer than a tap, as a long press that selects text is', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    expect(tap(recognizer, 100, 200, 200, TAP_MAX_MS + 1)).toBe(false);
    const again = createDoubleTapRecognizer();
    tap(again, 100, 200, 0, TAP_MAX_MS + 1);
    expect(tap(again, 100, 200, TAP_MAX_MS + 100)).toBe(false);
  });

  it('does not count a touch that moved, as a scroll does', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    recognizer.start(at(100, 200, 200), 1);
    recognizer.move(at(100, 200 + TAP_SLOP_PX + 1, 230));
    expect(recognizer.end(at(100, 200, 260))).toBe(false);
    expect(tap(recognizer, 100, 200, 300, 80, TAP_SLOP_PX + 1)).toBe(false);
  });

  it('does not count a second finger, as a pinch has', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    recognizer.start(at(100, 200, 200), 2);
    expect(recognizer.end(at(100, 200, 260))).toBe(false);
  });

  it('forgets the first tap when cancelled', () => {
    const recognizer = createDoubleTapRecognizer();
    tap(recognizer, 100, 200, 0);
    recognizer.cancel();
    expect(tap(recognizer, 100, 200, 200)).toBe(false);
  });
});

describe('editsOnDoubleTap', () => {
  afterEach(() => document.body.replaceChildren());
  const live = (inner: string) => {
    document.body.innerHTML = `<div data-markdown-editor><div class="cm-content" contenteditable="false"><div class="cm-line">${inner}</div></div></div>`;
    return document.body;
  };

  it('takes the text of the live editor and the source textarea', () => {
    live('<span id="t">plain</span> text');
    expect(editsOnDoubleTap(document.getElementById('t'))).toBe(true);
    expect(editsOnDoubleTap(document.querySelector('.cm-line'))).toBe(true);
    document.body.innerHTML = '<div data-markdown-editor><textarea readonly></textarea></div>';
    expect(editsOnDoubleTap(document.querySelector('textarea'))).toBe(true);
  });

  it('leaves links, buttons, checkboxes, images and widgets to themselves', () => {
    live('<span id="l" data-workspace-link="b.md" role="link">B</span><a id="a" href="https://x"><span id="ai">x</span></a><button id="b">b</button><input id="c" type="checkbox"><img id="i" alt=""><span contenteditable="false" class="cm-widget"><span id="w">table cell</span></span><label id="lb">label</label><span role="button" id="rb">rb</span>');
    for (const id of ['l', 'a', 'ai', 'b', 'c', 'i', 'w', 'lb', 'rb']) expect(editsOnDoubleTap(document.getElementById(id)), id).toBe(false);
  });

  it('takes nothing outside a note editor', () => {
    document.body.innerHTML = '<div class="cm-content"><span id="t">x</span></div><p id="p">x</p>';
    expect(editsOnDoubleTap(document.getElementById('t'))).toBe(false);
    expect(editsOnDoubleTap(document.getElementById('p'))).toBe(false);
    expect(editsOnDoubleTap(null)).toBe(false);
  });
});

/** Dispatches a touch event with one touch at (x, y); `fingers` sets how many touches are down. */
function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y: number, fingers = 1): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, target };
  const down = type === 'touchend' || type === 'touchcancel' ? fingers - 1 : fingers;
  Object.defineProperties(event, {
    touches: { value: Array.from({ length: down }, () => point) },
    changedTouches: { value: [point] },
  });
  target.dispatchEvent(event);
  return event;
}

describe('attachDoubleTap', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });
  const setUp = () => {
    document.body.innerHTML = '<div id="root"><div data-markdown-editor><div class="cm-content"><span id="t">text</span><a id="a" href="#x">link</a></div></div></div>';
    const onDoubleTap = vi.fn();
    const detach = attachDoubleTap(document.getElementById('root')!, onDoubleTap);
    return { onDoubleTap, detach, text: document.getElementById('t')!, link: document.getElementById('a')! };
  };
  const tapOn = (target: Element, x: number, y: number) => {
    touch(target, 'touchstart', x, y);
    return touch(target, 'touchend', x, y);
  };

  it('hands over the second tap and keeps the browser from acting on it', () => {
    const { onDoubleTap, text } = setUp();
    expect(tapOn(text, 50, 60).defaultPrevented).toBe(false);
    const second = tapOn(text, 52, 61);
    expect(onDoubleTap).toHaveBeenCalledExactlyOnceWith(52, 61);
    expect(second.defaultPrevented).toBe(true);
  });

  it('leaves a double tap on a link alone', () => {
    const { onDoubleTap, link, text } = setUp();
    tapOn(link, 50, 60);
    expect(tapOn(link, 50, 60).defaultPrevented).toBe(false);
    tapOn(text, 50, 60);
    expect(tapOn(link, 50, 60).defaultPrevented).toBe(false);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('starts over when the page scrolls between the taps', () => {
    const { onDoubleTap, text } = setUp();
    tapOn(text, 50, 60);
    document.dispatchEvent(new Event('scroll'));
    tapOn(text, 50, 60);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('ignores a pinch and a cancelled touch', () => {
    const { onDoubleTap, text } = setUp();
    tapOn(text, 50, 60);
    touch(text, 'touchstart', 50, 60, 2);
    touch(text, 'touchend', 50, 60, 2);
    tapOn(text, 50, 60);
    touch(text, 'touchstart', 50, 60);
    touch(text, 'touchcancel', 50, 60);
    tapOn(text, 50, 60);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('stops listening once detached', () => {
    const { onDoubleTap, detach, text } = setUp();
    detach();
    tapOn(text, 50, 60);
    tapOn(text, 50, 60);
    expect(onDoubleTap).not.toHaveBeenCalled();
  });
});
