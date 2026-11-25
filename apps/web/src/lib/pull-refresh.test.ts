import { describe, expect, it } from 'vitest';
import { PULL_MAX_PX, PULL_TRIGGER_PX, pullArmed, pullDistance, pullMayStart } from './pull-refresh.js';

describe('pulling the phone list down', () => {
  it('follows the finger one to one up to 64 px, then less, and never past the most', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(40)).toBe(40);
    expect(pullDistance(PULL_TRIGGER_PX)).toBe(PULL_TRIGGER_PX);
    expect(pullDistance(PULL_TRIGGER_PX + 50)).toBe(PULL_TRIGGER_PX + 20);
    expect(pullDistance(1000)).toBe(PULL_MAX_PX);
  });
  it('syncs only when let go at 64 px or more', () => {
    expect(pullArmed(PULL_TRIGGER_PX - 1)).toBe(false);
    expect(pullArmed(PULL_TRIGGER_PX)).toBe(true);
  });
  it('starts only at the top, with nothing open and no sync under way', () => {
    expect(pullMayStart({ scrollTop: 0, overlay: false, syncing: false })).toBe(true);
    expect(pullMayStart({ scrollTop: 5, overlay: false, syncing: false })).toBe(false);
    expect(pullMayStart({ scrollTop: 0, overlay: true, syncing: false })).toBe(false);
    expect(pullMayStart({ scrollTop: 0, overlay: false, syncing: true })).toBe(false);
  });
});
