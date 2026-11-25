/** How fast the list under a note follows the finger, against the note's own speed. */
export const EDGE_BACK_PARALLAX = 1 / 6;
/** How long the note takes to finish the way it was let go: off to the right, or back into place. */
export const EDGE_BACK_SETTLE_MS = 240;
export const EDGE_BACK_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/**
 * Where the note and the list under it stand with the finger `dx` to the right of where it landed, on a screen `width` wide: the note
 * follows the finger (never left of its place nor past the screen), and the list starts a sixth of the screen to the left and comes in at a
 * sixth of the note's speed, reaching its place as the note leaves.
 */
export function edgeBackFrame(dx: number, width: number): { note: number; list: number; } {
  const note = Math.min(width, Math.max(0, dx));
  return { note, list: -(width - note) * EDGE_BACK_PARALLAX };
}

/** Whether a note let go `dx` to the right goes back to the list: past a third of the screen; short of it, it returns. */
export function edgeBackCommits(dx: number, width: number): boolean {
  return width > 0 && dx > width / 3;
}
