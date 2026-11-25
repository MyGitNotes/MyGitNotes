import { describe, expect, it } from 'vitest';
import { arrowLabelsShown, boardToScreen, cameraAt, cameraCentre, cardDetail, cardTitleStyle, clampZoom, fitCamera, screenToBoard, sectionTitleSize, steppedZoom, visibleRect, zoomAround } from './zoom.js';

describe('semantic zoom', () => {
  it('shows a card body while it renders at 11 px or more, else the title only', () => {
    expect(cardDetail(1)).toBe('full');
    expect(cardDetail(.85)).toBe('full');
    expect(cardDetail(11 / 13)).toBe('full');
    expect(cardDetail(.84)).toBe('title');
    expect(cardDetail(.25)).toBe('title');
  });

  it('never renders a card title under 12 px, wrapping to at most three lines inside the card and at least one', () => {
    for (const zoom of [.25, .3, .4, .5, .6, .75, .85, 1, 1.5, 2]) {
      const { fontSize, lines } = cardTitleStyle(zoom);
      expect(fontSize * zoom).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(lines).toBeGreaterThanOrEqual(1);
      expect(lines).toBeLessThanOrEqual(3);
      // The lines fit the card's inner height, except the single line a huge title still gets.
      if (lines > 1) expect(lines * fontSize * 1.25).toBeLessThanOrEqual(128 - 24);
    }
    expect(cardTitleStyle(1)).toEqual({ fontSize: 14, lines: 3 });
    expect(cardTitleStyle(.25)).toEqual({ fontSize: 48, lines: 1 });
  });

  it('keeps section titles at 13 px or more and hides arrow labels under 10 px', () => {
    for (const zoom of [.25, .5, 1, 2]) expect(sectionTitleSize(zoom) * zoom).toBeGreaterThanOrEqual(13 - 1e-6);
    expect(sectionTitleSize(1)).toBe(15);
    expect(arrowLabelsShown(1)).toBe(true);
    expect(arrowLabelsShown(.85)).toBe(true);
    expect(arrowLabelsShown(10 / 13)).toBe(true);
    expect(arrowLabelsShown(.76)).toBe(false);
  });
});

describe('camera', () => {
  it('converts between board and screen points', () => {
    const camera = { x: 100, y: -50, zoom: .5 };
    expect(boardToScreen(camera, { x: 200, y: 300 })).toEqual({ x: 200, y: 100 });
    expect(screenToBoard(camera, { x: 200, y: 100 })).toEqual({ x: 200, y: 300 });
    expect(visibleRect(camera, { width: 400, height: 300 })).toEqual({ x: -200, y: 100, w: 800, h: 600 });
  });

  it('zooms around a screen point within 25%–200%', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const next = zoomAround(camera, { x: 100, y: 100 }, 2);
    expect(screenToBoard(next, { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    expect(zoomAround(camera, { x: 0, y: 0 }, 9).zoom).toBe(2);
    expect(zoomAround(camera, { x: 0, y: 0 }, .01).zoom).toBe(.25);
    expect(clampZoom(.1)).toBe(.25);
  });

  it('steps the zoom by a quarter, on whole percents, inside the range', () => {
    expect(steppedZoom(1, 1)).toBe(1.25);
    expect(steppedZoom(1, -1)).toBe(.8);
    expect(steppedZoom(1.9, 1)).toBe(2);
    expect(steppedZoom(.3, -1)).toBe(.25);
  });

  it('shows both edges of a wide board on first phone open', () => {
    const camera = fitCamera({ x: -500, y: -100, w: 1800, h: 600 }, { width: 390, height: 844 });
    expect(camera.x - 500 * camera.zoom).toBeGreaterThanOrEqual(0);
    expect(camera.x + 1300 * camera.zoom).toBeLessThanOrEqual(390);
  });
  it('fits content clamped to 60%–100%, centring what fits and starting at the top-left of what does not', () => {
    const viewport = { width: 1000, height: 600 };
    const small = fitCamera({ x: 0, y: 0, w: 200, h: 100 }, viewport);
    expect(small.zoom).toBe(1);
    expect(boardToScreen(small, { x: 100, y: 50 })).toEqual({ x: 500, y: 300 });
    const medium = fitCamera({ x: 0, y: 0, w: 1200, h: 400 }, viewport);
    expect(medium.zoom).toBeCloseTo(936 / 1200);
    const huge = fitCamera({ x: -500, y: -500, w: 10000, h: 10000 }, viewport);
    expect(huge.zoom).toBe(.6);
    expect(boardToScreen(huge, { x: -500, y: -500 })).toEqual({ x: 32, y: 32 });
    expect(fitCamera(undefined, viewport).zoom).toBe(1);
  });

  it('keeps the board point at the viewport centre through a saved camera', () => {
    const viewport = { width: 800, height: 600 };
    const camera = cameraAt({ x: 120, y: -40 }, .75, viewport);
    expect(cameraCentre(camera, viewport)).toEqual({ x: 120, y: -40 });
  });
});
