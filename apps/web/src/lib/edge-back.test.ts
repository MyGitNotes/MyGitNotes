import { describe, expect, it } from 'vitest';
import { edgeBackCommits, edgeBackFrame } from './edge-back.js';

describe('a note pulled back from its left edge', () => {
  it('follows the finger, the list under it coming in at a sixth of the speed', () => {
    expect(edgeBackFrame(0, 390)).toEqual({ note: 0, list: -65 });
    expect(edgeBackFrame(156, 390)).toEqual({ note: 156, list: -39 });
    expect(edgeBackFrame(390, 390)).toEqual({ note: 390, list: -0 });
  });
  it('stays on the screen whichever way the finger strays', () => {
    expect(edgeBackFrame(-40, 390)).toEqual({ note: 0, list: -65 });
    expect(edgeBackFrame(500, 390).note).toBe(390);
  });
  it('goes back to the list only when let go past a third of the screen', () => {
    expect(edgeBackCommits(130, 390)).toBe(false);
    expect(edgeBackCommits(131, 390)).toBe(true);
    expect(edgeBackCommits(50, 0)).toBe(false);
  });
});
