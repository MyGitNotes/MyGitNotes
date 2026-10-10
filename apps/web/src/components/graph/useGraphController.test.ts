import { describe, expect, it } from 'vitest';
import { keepLaneGeometry } from './useGraphController.js';

const geometry = (x: number) => ({ nodes: [{ id: 'notes:a.md', x, y: 20, expanded: true }] });

describe('keepLaneGeometry', () => {
  it('keeps the previous object when a new measurement holds the same content, so React does not render again', () => {
    const previous = geometry(10);
    expect(keepLaneGeometry(previous, geometry(10))).toBe(previous);
  });

  it('takes the new object when a card moved', () => {
    const previous = geometry(10);
    const next = geometry(11);
    expect(keepLaneGeometry(previous, next)).toBe(next);
  });
});
