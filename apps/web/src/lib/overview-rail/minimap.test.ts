import { describe, expect, it } from 'vitest';
import type { RailBlock } from './blocks.js';
import { layoutMinimap, MINIMAP_INSET, minimapWidth } from './minimap.js';

const text = (line: number, length: number, depth = 0): RailBlock => ({ kind: 'text', line, endLine: line, depth, length });
const base = { scrollHeight: 1000, railHeight: 100, lineHeight: 20, columns: 80 };

describe('layoutMinimap', () => {
  it('draws a line of prose as long as its text, scaled onto the rail', () => {
    const [shape] = layoutMinimap({ ...base, mode: 'wide', blocks: [text(1, 40)], extents: [{ top: 100, bottom: 120 }] });
    expect(shape.kind).toBe('text');
    expect(shape.x).toBe(MINIMAP_INSET.wide);
    expect(shape.width).toBeCloseTo(minimapWidth('wide') / 2);
    expect(shape.y).toBeGreaterThanOrEqual(10);
    expect(shape.y + shape.height).toBeLessThanOrEqual(12);
  });

  it('draws a wrapped line as full rows and the rest on its last', () => {
    const shapes = layoutMinimap({ ...base, mode: 'wide', blocks: [text(1, 200)], extents: [{ top: 0, bottom: 60 }] });
    expect(shapes.map(shape => shape.width / minimapWidth('wide'))).toEqual([1, 1, expect.closeTo(0.5)]);
  });

  it('moves nested lines right and draws a bar along a quote', () => {
    const shapes = layoutMinimap({ ...base, mode: 'wide', blocks: [{ kind: 'quote', line: 1, endLine: 1, depth: 0, length: 0 }, text(1, 80, 1)], extents: [{ top: 0, bottom: 20 }, { top: 0, bottom: 20 }] });
    expect(shapes[0]).toMatchObject({ kind: 'quote', x: MINIMAP_INSET.wide, width: 1.5 });
    expect(shapes[1].x).toBe(MINIMAP_INSET.wide + 4);
    expect(shapes[1].width).toBe(minimapWidth('wide') - 4);
  });

  it('fills the box of code, tables and pictures', () => {
    const [code] = layoutMinimap({ ...base, mode: 'wide', blocks: [{ kind: 'code', line: 1, endLine: 5, depth: 0, length: 0 }], extents: [{ top: 200, bottom: 400 }] });
    expect(code).toEqual({ kind: 'code', x: MINIMAP_INSET.wide, y: 20, width: minimapWidth('wide'), height: 20 });
  });

  it('draws every row across a narrow rail, whatever its length', () => {
    const shapes = layoutMinimap({ ...base, mode: 'narrow', blocks: [text(1, 3, 2), { kind: 'quote', line: 1, endLine: 1, depth: 0, length: 0 }], extents: [{ top: 0, bottom: 20 }, { top: 0, bottom: 20 }] });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ x: MINIMAP_INSET.narrow, width: minimapWidth('narrow') });
  });

  it('keeps a long note’s rows visible', () => {
    const [shape] = layoutMinimap({ ...base, scrollHeight: 100000, mode: 'wide', blocks: [text(1, 10)], extents: [{ top: 0, bottom: 20 }] });
    expect(shape.height).toBe(1);
  });
});
