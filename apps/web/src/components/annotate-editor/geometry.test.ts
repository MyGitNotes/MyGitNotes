import { describe, expect, it } from 'vitest';
import { dragShape, exceedsThreshold, moveShape, nudgeShape, pointToPercent, resizeRegion } from './geometry.js';

const rect = { left: 100, top: 50, width: 400, height: 200 } as DOMRect;

describe('pointToPercent', () => {
  it('measures from the top-left corner of the image', () => {
    expect(pointToPercent({ clientX: 300, clientY: 150 }, rect)).toEqual({ x: 50, y: 50 });
  });

  it('clamps a point outside the image', () => {
    expect(pointToPercent({ clientX: 0, clientY: 900 }, rect)).toEqual({ x: 0, y: 100 });
  });

  it('is safe on an empty box', () => {
    expect(pointToPercent({ clientX: 5, clientY: 5 }, { left: 0, top: 0, width: 0, height: 0 } as DOMRect)).toEqual({ x: 0, y: 0 });
  });
});

describe('exceedsThreshold', () => {
  it('is 4px for a mouse and 8px for touch', () => {
    expect(exceedsThreshold(2, 2, 'mouse')).toBe(false);
    expect(exceedsThreshold(4, 0, 'mouse')).toBe(true);
    expect(exceedsThreshold(5, 5, 'touch')).toBe(false);
    expect(exceedsThreshold(0, 8, 'touch')).toBe(true);
  });
});

describe('dragShape', () => {
  it('frames a region normalised to min and max whichever way it is dragged', () => {
    expect(dragShape({ x: 40, y: 50 }, { x: 10, y: 20 })).toEqual({ kind: 'region', x: 10, y: 20, w: 30, h: 30 });
  });

  it('is a pin at the start when the region is under 1% in either dimension', () => {
    expect(dragShape({ x: 40, y: 50 }, { x: 40.5, y: 70 })).toEqual({ kind: 'pin', x: 40, y: 50 });
    expect(dragShape({ x: 40, y: 50 }, { x: 60, y: 50.9 })).toEqual({ kind: 'pin', x: 40, y: 50 });
  });
});

describe('moveShape', () => {
  it('moves a pin and keeps it inside', () => {
    expect(moveShape({ kind: 'pin', x: 95, y: 10 }, 20, -30)).toEqual({ kind: 'pin', x: 100, y: 0 });
  });

  it('moves a region whole and keeps all of it inside', () => {
    expect(moveShape({ kind: 'region', x: 60, y: 60, w: 30, h: 30 }, 50, 50)).toEqual({ kind: 'region', x: 70, y: 70, w: 30, h: 30 });
    expect(moveShape({ kind: 'region', x: 10, y: 10, w: 30, h: 30 }, -50, 5)).toEqual({ kind: 'region', x: 0, y: 15, w: 30, h: 30 });
  });
});

describe('resizeRegion', () => {
  const region = { kind: 'region', x: 20, y: 20, w: 40, h: 40 } as const;

  it('drags a corner while the opposite one stays', () => {
    expect(resizeRegion(region, 'se', { x: 80, y: 90 })).toEqual({ kind: 'region', x: 20, y: 20, w: 60, h: 70 });
    expect(resizeRegion(region, 'nw', { x: 10, y: 5 })).toEqual({ kind: 'region', x: 10, y: 5, w: 50, h: 55 });
  });

  it('flips when a corner is dragged past the opposite one', () => {
    expect(resizeRegion(region, 'se', { x: 10, y: 10 })).toEqual({ kind: 'region', x: 10, y: 10, w: 10, h: 10 });
  });

  it('keeps at least 1% in each dimension', () => {
    expect(resizeRegion(region, 'se', { x: 20, y: 20 })).toEqual({ kind: 'region', x: 20, y: 20, w: 1, h: 1 });
  });
});

describe('nudgeShape', () => {
  it('moves by 0.5% and by 5% with Shift', () => {
    expect(nudgeShape({ kind: 'pin', x: 10, y: 10 }, 'ArrowRight', { shift: false, alt: false })).toEqual({ kind: 'pin', x: 10.5, y: 10 });
    expect(nudgeShape({ kind: 'pin', x: 10, y: 10 }, 'ArrowUp', { shift: true, alt: false })).toEqual({ kind: 'pin', x: 10, y: 5 });
  });

  it('stays inside the image', () => {
    expect(nudgeShape({ kind: 'pin', x: 0, y: 0 }, 'ArrowLeft', { shift: false, alt: false })).toEqual({ kind: 'pin', x: 0, y: 0 });
    expect(nudgeShape({ kind: 'region', x: 70, y: 0, w: 30, h: 10 }, 'ArrowRight', { shift: true, alt: false })).toEqual({ kind: 'region', x: 70, y: 0, w: 30, h: 10 });
  });

  it('resizes a region with Alt: right and down grow it, left and up shrink it', () => {
    const region = { kind: 'region', x: 10, y: 10, w: 20, h: 20 } as const;
    expect(nudgeShape(region, 'ArrowRight', { shift: false, alt: true })).toEqual({ kind: 'region', x: 10, y: 10, w: 20.5, h: 20 });
    expect(nudgeShape(region, 'ArrowUp', { shift: true, alt: true })).toEqual({ kind: 'region', x: 10, y: 10, w: 20, h: 15 });
  });

  it('does not resize a pin', () => {
    expect(nudgeShape({ kind: 'pin', x: 10, y: 10 }, 'ArrowRight', { shift: false, alt: true })).toEqual({ kind: 'pin', x: 10, y: 10 });
  });

  it('shrinks a region no smaller than 1%', () => {
    expect(nudgeShape({ kind: 'region', x: 0, y: 0, w: 1, h: 1 }, 'ArrowLeft', { shift: false, alt: true })).toEqual({ kind: 'region', x: 0, y: 0, w: 1, h: 1 });
  });
});
