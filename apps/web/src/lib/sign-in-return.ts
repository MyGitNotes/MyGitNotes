/*
 * Sign-in ends on `/` whichever provider runs it (each callback redirects there), so a person who opened a link to a
 * note, was asked to sign in and did, landed on the start page instead of the note. The tab keeps the page it was on
 * when the person chose to sign in, and the app opens it when the sign-in lands on `/` in that tab, before it routes.
 */

const KEY = 'mygitnotes.signInReturn';
/** How long a kept page waits for its sign-in: a provider's own screens (a password, MFA) can take a while. */
export const SIGN_IN_RETURN_MS = 30 * 60 * 1000;

type Place = Pick<Location, 'pathname' | 'search' | 'hash'>;

/** A path of this site the app routes: not the start page itself, not another site, not a server route. */
function returnable(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && path !== '/' && !/^\/api(\/|$)/.test(path);
}

/** Keeps the page `place` shows, for the sign-in the person is starting from it. */
export function rememberSignInReturn(place: Place = window.location, storage: Storage = window.sessionStorage, now = Date.now()) {
  const path = place.pathname + place.search + place.hash;
  try {
    if (returnable(path)) storage.setItem(KEY, JSON.stringify({ path, at: now }));
    else storage.removeItem(KEY);
  } catch { /* Storage may be unavailable; the sign-in then lands on the start page, as before. */ }
}

/** The page kept for a sign-in that started at most {@link SIGN_IN_RETURN_MS} ago, taken once: a later visit does not get it again. */
export function takeSignInReturn(storage: Storage = window.sessionStorage, now = Date.now()): string | null {
  try {
    const kept = storage.getItem(KEY);
    if (kept === null) return null;
    storage.removeItem(KEY);
    const { path, at } = JSON.parse(kept) as { path?: unknown; at?: unknown; };
    return returnable(path) && typeof at === 'number' && now - at >= 0 && now - at <= SIGN_IN_RETURN_MS ? path : null;
  } catch {
    return null;
  }
}

/** At boot: a tab on the bare start page, where every sign-in lands, goes on to the page it kept for that sign-in. */
export function resumeSignInReturn(place: Place = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history, storage: Storage = window.sessionStorage, now = Date.now()) {
  if (place.pathname !== '/' || place.search || place.hash) return;
  const path = takeSignInReturn(storage, now);
  if (path) history.replaceState(history.state, '', path);
}
