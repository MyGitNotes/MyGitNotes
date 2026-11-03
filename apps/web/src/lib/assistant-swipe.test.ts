// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_SWIPE_DISTANCE, attachAssistantSwipe } from './assistant-swipe.js';

let phone = true;
let root: HTMLElement;
let detach: () => void;
let open = false;
const onOpen = vi.fn(() => {
  open = true;
});
const onClose = vi.fn(() => {
  open = false;
});

beforeEach(() => {
  phone = true;
  open = false;
  onOpen.mockClear();
  onClose.mockClear();
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = "<main id='page'><p id='text'>Note</p><div id='wide' style='overflow-x: auto'><table id='table'></table></div><textarea id='field'></textarea><div class='compilation-book'><p id='book'>Page</p></div><div class='study-page'><p id='study'>Card</p></div></main><div id='assistant-dock'><p id='talk'>Hi</p></div>";
  root = document.documentElement;
  root.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  detach = attachAssistantSwipe(root, { isOpen: () => open, onOpen, onClose });
});
afterEach(() => detach());

/** One finger from (x, y) moved by dx (and dy) and lifted, on the element with `id`. */
function swipe(id: string, x: number, dx: number, dy = 0) {
  const target = document.getElementById(id)!;
  const fire = (type: string, touches: { clientX: number; clientY: number; }[]) => target.dispatchEvent(Object.defineProperty(new Event(type, { bubbles: true, cancelable: true }), 'touches', { value: touches }));
  fire('touchstart', [{ clientX: x, clientY: 300 }]);
  fire('touchmove', [{ clientX: x + dx / 2, clientY: 300 + dy / 2 }]);
  fire('touchmove', [{ clientX: x + dx, clientY: 300 + dy }]);
  fire('touchend', []);
}

describe('the assistant swipe on a phone', () => {
  it('opens the dock when a finger moves left from the right half of the page', () => {
    swipe('text', 300, -ASSISTANT_SWIPE_DISTANCE - 10);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it('leaves a swipe from the left half to the sidebar drawer, and a short or upward one to the page', () => {
    swipe('text', 100, -150);
    swipe('text', 300, -ASSISTANT_SWIPE_DISTANCE + 20);
    swipe('text', 300, -80, -200);
    swipe('text', 300, 150);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it('leaves a field, something that scrolls sideways the Book and the study page, whose swipes turn pages, alone', () => {
    const wide = document.getElementById('wide')!;
    Object.defineProperties(wide, { scrollWidth: { value: 900 }, clientWidth: { value: 400 } });
    swipe('table', 300, -150);
    swipe('field', 300, -150);
    swipe('book', 300, -150);
    swipe('study', 300, -150);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it('closes the open dock when a finger moves right on it, and ignores a leftward one', () => {
    open = true;
    swipe('talk', 100, -150);
    expect(onClose).not.toHaveBeenCalled();
    swipe('talk', 100, ASSISTANT_SWIPE_DISTANCE + 10);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.getElementById('assistant-dock')!.classList.contains('is-dragging')).toBe(false);
  });
  it('does nothing above the phone width', () => {
    phone = false;
    swipe('text', 300, -150);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
