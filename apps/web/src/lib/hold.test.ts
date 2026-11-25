import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_GAP_MS, TAP_MAX_MS } from './double-tap.js';
import { createHoldRecognizer, HOLD_MS, HOLD_SLOP_PX } from './hold.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createHoldRecognizer', () => {
  it('fires once when a finger rests 450 ms where it landed', () => {
    const onHold = vi.fn();
    const hold = createHoldRecognizer(onHold);
    hold.start({ x: 100, y: 100 }, 1);
    expect(hold.pending).toBe(true);
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(onHold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(hold.pending).toBe(false);
    expect(hold.fired).toBe(true);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('lets the finger drift up to 8 px, and cancels past it', () => {
    const onHold = vi.fn();
    const hold = createHoldRecognizer(onHold);
    hold.start({ x: 100, y: 100 }, 1);
    hold.move({ x: 100 + HOLD_SLOP_PX, y: 100 });
    hold.move({ x: 104, y: 105 });
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(1);

    hold.start({ x: 100, y: 100 }, 1);
    hold.move({ x: 107, y: 107 });
    expect(hold.pending).toBe(false);
    expect(hold.fired).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('never fires for a second finger, a lift first, or the two short taps of a double tap', () => {
    const onHold = vi.fn();
    const hold = createHoldRecognizer(onHold);
    hold.start({ x: 10, y: 10 }, 2);
    vi.advanceTimersByTime(HOLD_MS);
    hold.start({ x: 10, y: 10 }, 1);
    vi.advanceTimersByTime(HOLD_MS - 50);
    hold.cancel();
    vi.advanceTimersByTime(HOLD_MS);
    // A double tap: two presses lifted within the tap limit, the second soon after the first.
    hold.start({ x: 10, y: 10 }, 1);
    vi.advanceTimersByTime(TAP_MAX_MS);
    hold.cancel();
    vi.advanceTimersByTime(DOUBLE_TAP_GAP_MS - 50);
    hold.start({ x: 12, y: 10 }, 1);
    vi.advanceTimersByTime(TAP_MAX_MS);
    hold.cancel();
    vi.advanceTimersByTime(HOLD_MS);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('starts each press afresh: a held press is no longer fired once the next one lands', () => {
    const hold = createHoldRecognizer(() => {});
    hold.start({ x: 0, y: 0 }, 1);
    vi.advanceTimersByTime(HOLD_MS);
    expect(hold.fired).toBe(true);
    hold.start({ x: 0, y: 0 }, 1);
    expect(hold.fired).toBe(false);
  });
});
