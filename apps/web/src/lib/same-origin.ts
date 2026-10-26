/**
 * Whether an address belongs to this site. Its new tab then keeps the Referer: the server reads the page a request comes
 * from, so an asset opened from a demo page is asked for as the demo's and not as the person who is signed in.
 */
const sameOrigin = (url: string) => {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

/** The `rel` of a link that opens `url` in a new tab: only an address of another site is denied the Referer. */
export const newTabRel = (url: string) => sameOrigin(url) ? 'noopener' : 'noopener noreferrer';
