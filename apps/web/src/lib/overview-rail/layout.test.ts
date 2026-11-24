import { describe, expect, it } from 'vitest';
import { layoutRail, nearbyHeadings, nearestHeading, placePopover, RAIL_MIN_VISIBLE, railGrip, type RailHeadingMark, railScrolls, railThumbTop, railWidthMode, scrollTopForThumb, sectionLabelAt } from './layout.js';

const marks = (...tops: number[]): RailHeadingMark[] => tops.map((top, index) => ({ index, line: index * 10 + 1, depth: 2, label: `H${index}`, top }));

describe('railWidthMode', () => {
  it('is narrow in a Focus pane and wide from 600 px', () => {
    expect(railWidthMode(360)).toBe('narrow');
    expect(railWidthMode(599)).toBe('narrow');
    expect(railWidthMode(600)).toBe('wide');
    expect(railWidthMode(1100)).toBe('wide');
  });
});

describe('layoutRail', () => {
  const base = { scrollHeight: 4000, clientHeight: 500, scrollTop: 1000, railHeight: 400, breaks: [], endLabel: null, matches: [], cursor: null };

  it('maps content heights onto the rail in proportion, as the scrollbar does', () => {
    const model = layoutRail({ ...base, headings: [{ line: 1, depth: 1, label: 'Top', y: 0 }, { line: 80, depth: 3, label: 'Mid', y: 2000 }, { line: 200, depth: 2, label: 'End', y: 4000 }], cursor: 1100 });
    expect(model.headings.map(heading => heading.top)).toEqual([0, 200, 400]);
    expect(model.headings.map(heading => heading.depth)).toEqual([1, 3, 2]);
    expect(model.cursor).toBeCloseTo(110);
    expect(model.visible).toEqual({ top: 100, height: 50 });
  });

  it('places page breaks and keeps one find dot per rail pixel', () => {
    const model = layoutRail({ ...base, headings: [], breaks: [{ y: 1000, label: 'Page 1' }], endLabel: 'Page 2', matches: [400, 401, 402, 3000] });
    expect(model.breaks).toEqual([{ top: 100, label: 'Page 1' }]);
    expect(model.matches).toEqual([40, 300]);
  });

  it('keeps the visible range visible and inside the rail on a very long note', () => {
    const model = layoutRail({ ...base, headings: [], scrollHeight: 400000, scrollTop: 399500 });
    expect(model.visible.height).toBe(RAIL_MIN_VISIBLE);
    expect(model.visible.top).toBe(400 - RAIL_MIN_VISIBLE);
  });

  it('shows nothing for a note that fits its scroller', () => {
    expect(railScrolls({ scrollHeight: 500, clientHeight: 500, scrollTop: 0, railHeight: 400 })).toBe(false);
    expect(railScrolls({ scrollHeight: 900, clientHeight: 500, scrollTop: 0, railHeight: 400 })).toBe(true);
  });
});

describe('dragging the visible range like a scrollbar thumb', () => {
  const scroll = { scrollHeight: 4000, clientHeight: 500, railHeight: 400 };
  // The thumb is 50 px high and has 350 px of room for a scroll range of 3500 px: one rail pixel is ten content pixels.

  it('scrolls the content one to one with the pointer, keeping where the thumb was grabbed', () => {
    const visible = layoutRail({ ...scroll, scrollTop: 1000, headings: [], breaks: [], endLabel: null, matches: [], cursor: null }).visible;
    const grip = railGrip(120, visible);
    expect(grip).toBe(20);
    // The pointer moves 30 px down: the thumb follows to 130, and the content scrolls 300 px.
    expect(scrollTopForThumb(150 - grip, scroll)).toBe(1300);
    expect(railThumbTop({ ...scroll, scrollTop: scrollTopForThumb(150 - grip, scroll) })).toBe(130);
  });

  it('brings the thumb’s middle to a press on the track at once, and drags on from there', () => {
    const visible = { top: 100, height: 50 };
    const grip = railGrip(300, visible);
    expect(grip).toBe(25);
    expect(scrollTopForThumb(300 - grip, scroll)).toBe(2750);
    // Then centred on the pointer: the view's middle is the content at the press.
    expect(scrollTopForThumb(300 - grip, scroll) + scroll.clientHeight / 2).toBe(300 / 400 * 4000);
    expect(scrollTopForThumb(310 - grip, scroll)).toBe(2850);
  });

  it('stops at the scroll’s ends however far the pointer goes', () => {
    expect(scrollTopForThumb(-80, scroll)).toBe(0);
    expect(scrollTopForThumb(900, scroll)).toBe(3500);
    expect(railThumbTop({ ...scroll, scrollTop: 9999 })).toBe(350);
    expect(scrollTopForThumb(10, { scrollHeight: 400, clientHeight: 500, railHeight: 400 })).toBe(0);
  });

  it('maps a very long note with its least thumb so the thumb still reaches the rail’s ends', () => {
    const long = { scrollHeight: 400000, clientHeight: 500, railHeight: 400 };
    expect(scrollTopForThumb(400 - RAIL_MIN_VISIBLE, long)).toBe(399500);
    expect(railThumbTop({ ...long, scrollTop: 199750 })).toBeCloseTo((400 - RAIL_MIN_VISIBLE) / 2);
  });
});

describe('nearbyHeadings', () => {
  it('picks the nearest heading, the earlier one on a tie', () => {
    expect(nearestHeading(marks(10, 50, 90), 70)).toBe(1);
    expect(nearestHeading(marks(10, 30), 20)).toBe(0);
    expect(nearestHeading([], 20)).toBe(-1);
  });

  it('spreads out a dense stretch around the pointer, nearest first, in the note order', () => {
    const near = nearbyHeadings(marks(0, 100, 198, 200, 203, 205, 207, 300), 201);
    expect(near?.items.map(item => item.index)).toEqual([2, 3, 4, 5, 6]);
    expect(near?.items[near.active].index).toBe(3);
  });

  it('fills a sparse stretch with neighbours so the popover shows where it lies', () => {
    const near = nearbyHeadings(marks(0, 100, 200, 300, 400), 205);
    expect(near?.items.map(item => item.index)).toEqual([1, 2, 3]);
    expect(near?.active).toBe(1);
    const atEnd = nearbyHeadings(marks(0, 100, 200, 300, 400), 399);
    expect(atEnd?.items.map(item => item.index)).toEqual([2, 3, 4]);
    expect(atEnd?.active).toBe(2);
  });

  it('answers what there is in a short outline, and nothing without headings', () => {
    expect(nearbyHeadings(marks(50), 300)?.items.map(item => item.index)).toEqual([0]);
    expect(nearbyHeadings([], 10)).toBeNull();
  });

  it('names the heading nearest a pointer as it moves', () => {
    const headings = marks(20, 60, 64, 120);
    const target = (top: number) => {
      const near = nearbyHeadings(headings, top);
      return near && near.items[near.active].label;
    };
    expect(target(61)).toBe('H1');
    expect(target(63)).toBe('H2');
    expect(target(200)).toBe('H3');
  });
});

describe('sectionLabelAt', () => {
  const model = { breaks: [{ top: 100, label: 'Page 1' }, { top: 250, label: 'Page 2' }], endLabel: 'Page 3' };
  it('names the page that ends at the next break below', () => {
    expect(sectionLabelAt(model, 10)).toBe('Page 1');
    expect(sectionLabelAt(model, 180)).toBe('Page 2');
    expect(sectionLabelAt(model, 300)).toBe('Page 3');
    expect(sectionLabelAt({ breaks: [], endLabel: null }, 300)).toBeNull();
  });
});

describe('placePopover', () => {
  const size = { width: 230, height: 200 };
  const viewport = { width: 1440, height: 900 };

  it('puts a wide rail’s popover left of the rail, its active row on the pointer', () => {
    const place = placePopover({ mode: 'wide', rail: { left: 1086, right: 1102, top: 160, bottom: 780 }, column: { left: 0, right: 1110, top: 160, bottom: 780 }, viewport, size, anchorY: 410, anchorOffset: 100 });
    expect(place).toEqual({ left: 1086 - 12 - 230, top: 310, side: 'inside' });
  });

  it('lends a narrow rail the neighbour’s space past the column and its scrollbar', () => {
    const place = placePopover({ mode: 'narrow', rail: { left: 829, right: 836, top: 160, bottom: 780 }, column: { left: 486, right: 846, top: 160, bottom: 780 }, viewport, size, anchorY: 410, anchorOffset: 100 });
    expect(place.side).toBe('outside');
    expect(place.left).toBe(858);
  });

  it('turns inward only when the window has no room outside', () => {
    const place = placePopover({ mode: 'narrow', rail: { left: 1423, right: 1430, top: 160, bottom: 780 }, column: { left: 1080, right: 1440, top: 160, bottom: 780 }, viewport, size, anchorY: 410, anchorOffset: 100 });
    expect(place).toMatchObject({ side: 'inside', left: 1423 - 12 - 230 });
  });

  it('stays within the window at its top and bottom', () => {
    expect(placePopover({ mode: 'wide', rail: { left: 1086, right: 1102, top: 0, bottom: 900 }, column: { left: 0, right: 1110, top: 0, bottom: 900 }, viewport, size, anchorY: 20, anchorOffset: 100 }).top).toBe(8);
    expect(placePopover({ mode: 'wide', rail: { left: 1086, right: 1102, top: 0, bottom: 900 }, column: { left: 0, right: 1110, top: 0, bottom: 900 }, viewport, size, anchorY: 890, anchorOffset: 100 }).top).toBe(900 - 200 - 8);
  });
});
