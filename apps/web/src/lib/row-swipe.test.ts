import { describe, expect, it } from 'vitest';
import { revealedOffset, ROW_ACTION_PX, rowOffset, settleRow } from './row-swipe.js';

const widths = { start: ROW_ACTION_PX, end: 2 * ROW_ACTION_PX };

describe('a list row pushed aside', () => {
  it("rests at its revealed side's width", () => {
    expect(revealedOffset(null, widths)).toBe(0);
    expect(revealedOffset('start', widths)).toBe(ROW_ACTION_PX);
    expect(revealedOffset('end', widths)).toBe(-2 * ROW_ACTION_PX);
  });

  it('follows the finger as far as the actions reach, and a quarter as fast past them', () => {
    expect(rowOffset(null, 40, widths)).toBe(40);
    expect(rowOffset(null, ROW_ACTION_PX + 40, widths)).toBe(ROW_ACTION_PX + 10);
    expect(rowOffset(null, -100, widths)).toBe(-100);
    expect(rowOffset(null, -(2 * ROW_ACTION_PX + 80), widths)).toBe(-(2 * ROW_ACTION_PX + 20));
  });

  it('moves from where it rested, so an open row pushed back closes', () => {
    expect(rowOffset('start', -ROW_ACTION_PX, widths)).toBe(0);
    expect(rowOffset('end', ROW_ACTION_PX, widths)).toBe(-ROW_ACTION_PX);
  });

  it('barely moves toward a side with no actions', () => {
    expect(rowOffset(null, 80, { start: 0, end: ROW_ACTION_PX })).toBe(20);
    expect(settleRow(20, { start: 0, end: ROW_ACTION_PX })).toBeNull();
  });

  it('settles revealing a side past half its actions, closed short of it, and never runs an action on release', () => {
    expect(settleRow(ROW_ACTION_PX / 2, widths)).toBe('start');
    expect(settleRow(ROW_ACTION_PX / 2 - 1, widths)).toBeNull();
    expect(settleRow(-ROW_ACTION_PX, widths)).toBe('end');
    expect(settleRow(-ROW_ACTION_PX + 1, widths)).toBeNull();
    // Pulled all the way across, the row still only shows its actions.
    expect(settleRow(rowOffset(null, 390, widths), widths)).toBe('start');
  });
});
