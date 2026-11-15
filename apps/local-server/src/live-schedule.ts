import { templateTimeZone } from '@mygitnotes/core';

/*
 * The nightly check-in of live notes (docs/specs/2026-11-15-live-notes/spec.md §5.1): a sweep for instant I takes the
 * links checked out before I, where I is the latest MYGITNOTES_LIVE_CHECKIN_AT in MYGITNOTES_TIMEZONE at or before
 * now. A process sweeps at I and 10, 20 and 30 minutes after it, for releases refused while someone was still
 * editing, and once 60 to 120 s after it starts, which catches up after downtime. Every process of a deployment may
 * run it: the adapter's lease makes each link single-flight.
 */

/** When the nightly check-in runs: a wall-clock time and the time zone it is read in. */
export interface LiveScheduleSetting {
  /** `HH:mm`. */
  at: string;
  timeZone: string;
}

/** The setting of an environment; null when `MYGITNOTES_LIVE_CHECKIN_AT` is `off`, and a thrown Error for a value that is no time. */
export function liveScheduleSetting(env: Record<string, string | undefined> = process.env): LiveScheduleSetting | null {
  const value = env.MYGITNOTES_LIVE_CHECKIN_AT?.trim() || '03:00';
  if (value.toLowerCase() === 'off') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`MYGITNOTES_LIVE_CHECKIN_AT '${value}' is not a time such as 03:00, or off.`);
  return { at: value, timeZone: templateTimeZone(env) };
}

/** The wall clock of an instant in a time zone. */
function wallClock(time: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(time)).map(part => [part.type, Number(part.value)]));
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** How far a time zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function offsetAt(time: number, timeZone: string): number {
  const wall = wallClock(time, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(time / 1000) * 1000;
}

/** The instant a wall-clock time of a day has in a time zone; a time a clock change skips falls after the change. */
function instantOf(year: number, month: number, day: number, at: string, timeZone: string): number {
  const [hour, minute] = at.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return second;
}

/** The check-in time on the day `days` after the day of `time` in the setting's time zone. */
function instantOnDay(time: number, days: number, setting: LiveScheduleSetting): number {
  const wall = wallClock(time, setting.timeZone);
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), setting.at, setting.timeZone);
}

/** The latest check-in instant at or before `now`: the sweep for it takes the links checked out before it. */
export function liveDueInstant(now: Date, setting: LiveScheduleSetting): Date {
  const time = now.getTime();
  const today = instantOnDay(time, 0, setting);
  return new Date(today <= time ? today : instantOnDay(time, -1, setting));
}

/** Minutes after an instant at which the schedule sweeps for it. */
const TICKS = [0, 10, 20, 30];

/** The next time the schedule sweeps after `now`, and the instant that sweep is for. */
function nextTick(now: number, setting: LiveScheduleSetting): { at: number; instant: number; } {
  const last = liveDueInstant(new Date(now), setting).getTime();
  for (const minutes of TICKS) {
    const at = last + minutes * 60_000;
    if (at > now) return { at, instant: last };
  }
  const today = instantOnDay(now, 0, setting);
  const upcoming = today > now ? today : instantOnDay(now, 1, setting);
  return { at: upcoming, instant: upcoming };
}

export interface LiveScheduleOptions {
  setting: LiveScheduleSetting;
  /** Checks in the links due at `instant`; it reports its own failures. */
  sweep(instant: Date): Promise<unknown>;
  /** In [0, 1); jitters every timer by up to 60 s. */
  random?: () => number;
}

/** Starts the schedule; its timers keep no process alive. Returns how to stop it. */
export function startLiveSchedule({ setting, sweep, random = Math.random }: LiveScheduleOptions): { stop(): void; } {
  let stopped = false;
  let running = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (delay: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, Math.max(0, delay));
    timer.unref?.();
    timers.add(timer);
  };
  const jitter = () => Math.floor(random() * 60_000);
  /** One sweep at a time in this process: a tick that finds the last one still running is skipped. */
  const fire = (instant: number) => {
    if (stopped || running) return;
    running = true;
    void sweep(new Date(instant)).catch(error => console.warn(`[live-notes] scheduled check-in failed: ${(error as Error)?.name ?? 'error'}`)).finally(() => (running = false));
  };
  const plan = () => {
    if (stopped) return;
    const { at, instant } = nextTick(Date.now(), setting);
    later(at - Date.now() + jitter(), () => {
      fire(instant);
      plan();
    });
  };
  later(60_000 + jitter(), () => fire(liveDueInstant(new Date(), setting).getTime()));
  plan();
  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
