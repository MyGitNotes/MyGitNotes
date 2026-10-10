/** A server-sent event stream, as far as its page needs to end it. */
interface PageStream {
  close: () => void;
}

/**
 * Keeps a server-sent event stream for as long as its page is shown. `open` starts the stream and wires its listeners.
 * The stream is closed when the page is hidden for good or put in the back/forward cache, and opened again when the cache
 * restores the page. A browser may keep a navigated-away document's stream connected, and a plain HTTP/1.1 server allows
 * a browser only six connections per origin across all its tabs, so a stream left behind soon blocks every request.
 * Returns the function that ends the stream and stops following the page.
 */
export function followPage(open: () => PageStream): () => void {
  let stream: PageStream | undefined = open();
  const leave = () => {
    stream?.close();
    stream = undefined;
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted && !stream) stream = open();
  };
  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', restore);
  return () => {
    window.removeEventListener('pagehide', leave);
    window.removeEventListener('pageshow', restore);
    leave();
  };
}
