/** How far the list must be pulled down before letting go syncs. */
export const PULL_TRIGGER_PX = 64;
/** The farthest the list moves, however far the finger goes. */
export const PULL_MAX_PX = 120;
/** How much of a pull past the trigger still moves the list. */
const PULL_RESISTANCE = 0.4;
/** The room the sync indicator keeps above the list while it syncs. */
export const PULL_SYNC_PX = 52;
/** How long the list takes to settle on the indicator after the lift, and to close over it once the sync answered. */
export const PULL_SETTLE_MS = 240;
export const PULL_CLOSE_MS = 320;

/** How far the list follows a finger `dy` below where it landed: one to one up to the trigger, then less, never past `PULL_MAX_PX`. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  if (dy <= PULL_TRIGGER_PX) return dy;
  return Math.min(PULL_MAX_PX, PULL_TRIGGER_PX + (dy - PULL_TRIGGER_PX) * PULL_RESISTANCE);
}

/** Whether letting go at `distance` syncs. */
export const pullArmed = (distance: number) => distance >= PULL_TRIGGER_PX;

/** What the indicator says: pull further, let go to sync, or syncing. */
export type PullLabel = 'pull' | 'release' | 'syncing';

/**
 * Whether a touch may start a pull: the list is at its top, nothing is open over it, and no sync it started is still under way (one at
 * a time; a pull while one runs is a plain scroll).
 */
export function pullMayStart({ scrollTop, overlay, syncing }: { scrollTop: number; overlay: boolean; syncing: boolean; }): boolean {
  return scrollTop <= 0 && !overlay && !syncing;
}
