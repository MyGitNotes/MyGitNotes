/**
 * Which one gesture a touch on a phone belongs to. One touch does one thing: the sideways gestures (the drawer, a note's way back to
 * the list, a list row's actions, the assistant) each ask `sideGestureOf` when a finger lands and start only if the answer is theirs,
 * and every gesture waits for `lockAxis` before it moves anything.
 */

/** How far from the page's left edge a finger opens the drawer on the list, or goes back to the list from a note. */
export const EDGE_ZONE_PX = 24;
/** How far a finger travels before a gesture knows which way it goes. */
export const AXIS_LOCK_PX = 10;
/** How much more sideways than up or down a move must be to count as sideways. */
export const AXIS_RATIO = 1.5;

/** What a list row with swipe actions carries, so the other sideways gestures leave a touch on it to the row. */
export const ROW_SWIPE_SELECTOR = '[data-row-swipe]';

export type Axis = 'horizontal' | 'vertical';

/**
 * Which way a move from where the finger landed goes, or null while it cannot tell yet: sideways once it has gone at least 10 px across and
 * one and a half times as far across as up or down; up or down once it has gone over 10 px that way and more that way than across.
 */
export function lockAxis(dx: number, dy: number): Axis | null {
  const x = Math.abs(dx), y = Math.abs(dy);
  if (y > AXIS_LOCK_PX && y > x) return 'vertical';
  if (x >= AXIS_LOCK_PX && x >= y * AXIS_RATIO) return 'horizontal';
  return null;
}

export type SideGesture = 'drawer' | 'back' | 'row' | 'assistant' | 'none';

export interface SideTouch {
  /** The phone Notes screen the finger is on, or another page. */
  screen: 'list' | 'note' | 'page';
  /** Where the finger landed from the page's left edge, and the page's width. */
  x: number;
  width: number;
  /** Whether it landed on a list row with swipe actions. */
  onRow: boolean;
  /** Whether what it landed on moves sideways itself: a field, a slider, an embed, something that scrolls sideways, the Book, the study page. */
  owned: boolean;
  /** Whether a sheet, menu, dialog, the drawer or a row's actions are open: they close first, and the touch starts nothing else. */
  overlay: boolean;
}

/**
 * The sideways gesture a touch starts, with nothing open. On a note the left edge goes back to the list (never the drawer) and the right
 * half opens the assistant. On the list the left edge opens the drawer before anything under it; elsewhere a row takes a touch that starts
 * on it, even in the right half, and the rest is the drawer's in the left half and the assistant's in the right half.
 */
export function sideGestureOf({ screen, x, width, onRow, owned, overlay }: SideTouch): SideGesture {
  if (overlay || owned) return 'none';
  const edge = x <= EDGE_ZONE_PX, right = x > width / 2;
  if (screen === 'note') return edge ? 'back' : right ? 'assistant' : 'none';
  if (edge) return 'drawer';
  if (screen === 'list' && onRow) return 'row';
  return right ? 'assistant' : 'drawer';
}

/** The phone Notes screen an element is on: the note screen, the list screen, or neither. */
export function screenOf(target: Element): SideTouch['screen'] {
  if (target.closest('.phone-notes-focus')) return 'note';
  if (target.closest('.notes-main')) return 'list';
  return 'page';
}

/** What lies open over a phone's page and closes before anything else answers a touch: a sheet, a dialog, the drawer, a list row's actions. */
const OVERLAYS = { sheet: '.phone-sheet-layer, dialog[open], [role="dialog"][aria-modal="true"]', drawer: '[data-responsive-sidebar].is-open', row: '[data-row-swipe][data-revealed]' } as const;
export type Overlay = keyof typeof OVERLAYS;

/** Whether something other than `except` is open over the page. */
export function overlayOpen(root: ParentNode = document, except?: Overlay): boolean {
  return (Object.keys(OVERLAYS) as Overlay[]).some(kind => kind !== except && root.querySelector(OVERLAYS[kind]) !== null);
}
