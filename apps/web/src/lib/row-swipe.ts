/** The width of one action a list row reveals when pushed aside. */
export const ROW_ACTION_PX = 88;
/** How much of a pull past the revealed actions still moves the row. */
const RUBBER = 0.25;

/** Which side's actions a row shows: `start` (pushed right, the actions on its left), `end` (pushed left), or none. */
export type RowSide = 'start' | 'end';
export type Revealed = RowSide | null;

/** How wide each side's actions are; a side without actions is 0, and the row barely moves that way. */
export interface RowWidths {
  start: number;
  end: number;
}

/** Where a row rests with a side's actions revealed, or none. */
export function revealedOffset(revealed: Revealed, widths: RowWidths): number {
  return revealed === 'start' ? widths.start : revealed === 'end' ? -widths.end : 0;
}

/**
 * Where the row follows the finger: from where it rested, `dx` across, freely as far as a side's actions reach and a quarter as fast
 * beyond them (on a side without actions, a quarter as fast from the start).
 */
export function rowOffset(from: Revealed, dx: number, widths: RowWidths): number {
  const raw = revealedOffset(from, widths) + dx;
  if (raw > widths.start) return widths.start + (raw - widths.start) * RUBBER;
  if (raw < -widths.end) return -widths.end + (raw + widths.end) * RUBBER;
  return raw;
}

/** Where a released row settles: revealing a side when pulled past half its actions, closed otherwise. Nothing runs on release. */
export function settleRow(offset: number, widths: RowWidths): Revealed {
  if (widths.start > 0 && offset >= widths.start / 2) return 'start';
  if (widths.end > 0 && offset <= -widths.end / 2) return 'end';
  return null;
}
