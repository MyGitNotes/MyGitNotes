/** How long a finger rests on a list row or a whiteboard card before its note's menu opens. */
export const HOLD_MS = 450;
/** How far it may drift meanwhile; farther, it is a scroll, a swipe or a drag, and no menu opens. */
export const HOLD_SLOP_PX = 8;

export interface HoldPoint {
  x: number;
  y: number;
}

/** A press that turns into a hold when it rests long enough. */
export interface HoldRecognizer {
  /** A touch began; `fingers` is how many are on the screen now. A second finger cancels. */
  start: (point: HoldPoint, fingers: number) => void;
  /** The finger moved: past the slop the press is no hold. */
  move: (point: HoldPoint) => void;
  /** The finger lifted or the touch was taken over: nothing fires after this. */
  cancel: () => void;
  /** Whether a press is waiting to become a hold. */
  readonly pending: boolean;
  /** Whether the last press became a hold, until the next one starts: its lift is no tap. */
  readonly fired: boolean;
}

interface Timers {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const browserTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * Reads one finger's press as a hold: resting `HOLD_MS` within `HOLD_SLOP_PX` of where it landed calls `onHold` once. Moving farther,
 * a second finger, or a lift first cancels it, so the move is left to a scroll, a swipe or a drag, and a tap or a double tap (each lifted
 * well within 300 ms) never reaches it.
 */
export function createHoldRecognizer(onHold: () => void, timers: Timers = browserTimers): HoldRecognizer {
  let origin: HoldPoint | null = null;
  let timer: unknown;
  let fired = false;
  const cancel = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
    origin = null;
  };
  return {
    start(point, fingers) {
      cancel();
      fired = false;
      if (fingers !== 1) return;
      origin = point;
      timer = timers.set(() => {
        timer = undefined;
        origin = null;
        fired = true;
        onHold();
      }, HOLD_MS);
    },
    move(point) {
      if (origin && Math.hypot(point.x - origin.x, point.y - origin.y) > HOLD_SLOP_PX) cancel();
    },
    cancel,
    get pending() {
      return origin !== null;
    },
    get fired() {
      return fired;
    },
  };
}

/** How long after a hold, a drag or a closing tap the browser's compatibility click is swallowed. */
export const CLICK_GUARD_MS = 500;

/**
 * Swallows the next click anywhere within `CLICK_GUARD_MS` of now: the one a lift sends after a hold (which would land on the sheet's
 * backdrop that opened under the finger and close it), or after a touch that only closed something. Call it on the lift.
 */
export function swallowNextClick(): void {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const timer = setTimeout(() => done(), CLICK_GUARD_MS);
  function done() {
    window.removeEventListener('click', swallow, true);
    clearTimeout(timer);
  }
  window.addEventListener('click', swallow, true);
}
