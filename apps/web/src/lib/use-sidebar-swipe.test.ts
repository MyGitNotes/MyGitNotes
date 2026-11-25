// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSidebarSwipe, SIDEBAR_SWIPE_DISTANCE } from './use-sidebar-swipe.js';

let open = false;
let detach: () => void;
const onChange = vi.fn((next: boolean) => {
  open = next;
});

beforeEach(() => {
  open = false;
  onChange.mockClear();
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 1100px'), media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  document.body.innerHTML = `<div id='root'>
    <div data-responsive-sidebar class='workspace-responsive-sidebar'><p id='drawer'>Notebooks</p></div>
    <main class='notes-main'>
      <div id='list'><div data-row-swipe><span id='row'>A note</span></div><p id='gap'>More</p></div>
      <div class='phone-notes-focus'><p id='note'>Text</p></div>
    </main>
  </div>`;
  const root = document.getElementById('root')!;
  root.getBoundingClientRect = () => ({ left: 0, width: 390, top: 0, height: 800, right: 390, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  document.querySelector<HTMLElement>('[data-responsive-sidebar]')!.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 800, right: 300, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  detach = attachSidebarSwipe(root, { isOpen: () => open, onChange });
});
afterEach(() => detach());

/** One finger from x moved by dx (and dy) and lifted, on the element with `id`. */
function swipe(id: string, x: number, dx: number, dy = 0) {
  const target = document.getElementById(id)!;
  const fire = (type: string, touches: { clientX: number; clientY: number; }[]) => target.dispatchEvent(Object.defineProperty(new Event(type, { bubbles: true, cancelable: true }), 'touches', { value: touches }));
  fire('touchstart', [{ clientX: x, clientY: 300 }]);
  fire('touchmove', [{ clientX: x + dx / 2, clientY: 300 + dy / 2 }]);
  fire('touchmove', [{ clientX: x + dx, clientY: 300 + dy }]);
  fire('touchend', []);
}

describe("the drawer's swipe on a phone's Notes page", () => {
  it("opens the drawer from the list's left edge, over a row too, and from the space between rows in the left half", () => {
    swipe('row', 10, SIDEBAR_SWIPE_DISTANCE + 10);
    expect(onChange).toHaveBeenLastCalledWith(true);
    open = false;
    swipe('gap', 120, SIDEBAR_SWIPE_DISTANCE + 10);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('leaves a swipe that starts on a row past the edge to the row', () => {
    swipe('row', 60, 150);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('never opens from a note, whose left edge goes back to the list', () => {
    swipe('note', 8, 200);
    swipe('note', 100, 200);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('waits for a sideways move and leaves a scroll alone', () => {
    swipe('gap', 10, 30, 200);
    swipe('gap', 10, 12, 10);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('starts nothing while a sheet is open over the page', () => {
    document.body.insertAdjacentHTML('beforeend', "<div class='phone-sheet-layer'></div>");
    swipe('gap', 10, 200);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('closes the open drawer with a leftward swipe, wherever it starts', () => {
    open = true;
    swipe('drawer', 200, -(SIDEBAR_SWIPE_DISTANCE + 10));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
