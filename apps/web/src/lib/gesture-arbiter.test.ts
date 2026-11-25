// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EDGE_ZONE_PX, lockAxis, overlayOpen, screenOf, sideGestureOf, type SideTouch } from './gesture-arbiter.js';

describe('lockAxis', () => {
  it('waits until the finger has gone 10 px', () => {
    expect(lockAxis(0, 0)).toBeNull();
    expect(lockAxis(9, 2)).toBeNull();
    expect(lockAxis(-9, 0)).toBeNull();
    expect(lockAxis(3, 10)).toBeNull();
  });
  it('reads a move as sideways at 10 px across and one and a half times the height, either way', () => {
    expect(lockAxis(10, 0)).toBe('horizontal');
    expect(lockAxis(-15, 10)).toBe('horizontal');
    expect(lockAxis(15, -10)).toBe('horizontal');
  });
  it('reads a steeper move as up or down, and stays undecided between the two', () => {
    expect(lockAxis(0, 11)).toBe('vertical');
    expect(lockAxis(5, -20)).toBe('vertical');
    // Across 14, down 10: neither one and a half times across nor more down than across, yet.
    expect(lockAxis(14, 10)).toBeNull();
    expect(lockAxis(14, 12)).toBeNull();
  });
});

describe('sideGestureOf', () => {
  const touch = (patch: Partial<SideTouch>): SideTouch => ({ screen: 'list', x: 200, width: 390, onRow: false, owned: false, overlay: false, ...patch });

  it("gives the list's left edge to the drawer, even over a row", () => {
    expect(sideGestureOf(touch({ x: 0, onRow: true }))).toBe('drawer');
    expect(sideGestureOf(touch({ x: EDGE_ZONE_PX, onRow: true }))).toBe('drawer');
    expect(sideGestureOf(touch({ x: EDGE_ZONE_PX + 1, onRow: true }))).toBe('row');
  });
  it('gives a row the touch that starts on it, in either half, before the assistant', () => {
    expect(sideGestureOf(touch({ x: 100, onRow: true }))).toBe('row');
    expect(sideGestureOf(touch({ x: 350, onRow: true }))).toBe('row');
  });
  it("leaves the list's space between rows to the drawer on the left and the assistant on the right", () => {
    expect(sideGestureOf(touch({ x: 100 }))).toBe('drawer');
    expect(sideGestureOf(touch({ x: 300 }))).toBe('assistant');
  });
  it('on a note, takes the left edge back to the list, never to the drawer, and the right half to the assistant', () => {
    expect(sideGestureOf(touch({ screen: 'note', x: 10 }))).toBe('back');
    expect(sideGestureOf(touch({ screen: 'note', x: 100 }))).toBe('none');
    expect(sideGestureOf(touch({ screen: 'note', x: 300 }))).toBe('assistant');
  });
  it('lets another page keep the drawer on the left and the assistant on the right', () => {
    expect(sideGestureOf(touch({ screen: 'page', x: 10 }))).toBe('drawer');
    expect(sideGestureOf(touch({ screen: 'page', x: 300, onRow: true }))).toBe('assistant');
  });
  it('starts nothing while something is open or the finger is on something that moves sideways itself', () => {
    for (const patch of [{ x: 10 }, { x: 100, onRow: true }, { x: 300 }, { screen: 'note' as const, x: 10 }]) {
      expect(sideGestureOf(touch({ ...patch, overlay: true }))).toBe('none');
      expect(sideGestureOf(touch({ ...patch, owned: true }))).toBe('none');
    }
  });
});

describe('the page around a touch', () => {
  it('tells the note screen from the list screen and other pages', () => {
    document.body.innerHTML = "<main class='notes-main'><div class='phone-notes-focus'><p id='note'>Text</p></div><div id='list'></div></main><section><p id='other'></p></section>";
    expect(screenOf(document.getElementById('note')!)).toBe('note');
    expect(screenOf(document.getElementById('list')!)).toBe('list');
    expect(screenOf(document.getElementById('other')!)).toBe('page');
  });
  it('finds a sheet, a dialog, the open drawer or a revealed row, and can leave one kind out', () => {
    document.body.innerHTML = "<div data-responsive-sidebar class='workspace-responsive-sidebar'></div><div data-row-swipe></div>";
    expect(overlayOpen()).toBe(false);
    document.querySelector('[data-responsive-sidebar]')!.classList.add('is-open');
    expect(overlayOpen()).toBe(true);
    expect(overlayOpen(document, 'drawer')).toBe(false);
    document.querySelector('[data-responsive-sidebar]')!.classList.remove('is-open');
    document.querySelector('[data-row-swipe]')!.setAttribute('data-revealed', 'end');
    expect(overlayOpen()).toBe(true);
    expect(overlayOpen(document, 'row')).toBe(false);
    document.body.insertAdjacentHTML('beforeend', "<div class='phone-sheet-layer'></div>");
    expect(overlayOpen(document, 'row')).toBe(true);
  });
});
