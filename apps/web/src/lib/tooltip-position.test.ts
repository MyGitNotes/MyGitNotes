import { expect, it } from 'vitest';
import { placeTooltip } from './tooltip-position.js';

const viewport = { width: 1000, height: 800 };
const rail = { left: 8, top: 100, width: 40, height: 40 };

it('sits beside the trigger on the side asked, centred on it, the arrow at the trigger centre', () => {
  const placed = placeTooltip(rail, { width: 120, height: 30 }, viewport, 'right');
  expect(placed).toEqual({ side: 'right', left: 56, top: 105, arrow: 15 });
});

it('flips to the other side where the asked side has no room', () => {
  const nearRight = { left: 950, top: 100, width: 40, height: 40 };
  expect(placeTooltip(nearRight, { width: 120, height: 30 }, viewport, 'right').side).toBe('left');
  const nearBottom = { left: 400, top: 770, width: 40, height: 24 };
  expect(placeTooltip(nearBottom, { width: 120, height: 30 }, viewport, 'bottom')).toMatchObject({ side: 'top', top: 732 });
});

it('stays inside the viewport along the trigger, moving the arrow to keep pointing at it', () => {
  const corner = { left: 4, top: 4, width: 28, height: 28 };
  const placed = placeTooltip(corner, { width: 200, height: 30 }, viewport, 'bottom');
  expect(placed.left).toBe(8);
  expect(placed.top).toBe(40);
  expect(placed.arrow).toBe(10);
  const low = placeTooltip({ left: 8, top: 780, width: 40, height: 16 }, { width: 120, height: 30 }, viewport, 'right');
  expect(low.top).toBe(762);
  expect(low.arrow).toBe(22);
});
