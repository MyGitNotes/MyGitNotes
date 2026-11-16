/*
 * The sockets of a note's collab editors that were closed and may still be closing. The server counts an editor's person
 * as editing until its socket's close reached it, so a check-in sent at once could find this very tab still editing and
 * refuse to release the note (VQ P1-a). A check-in waits for them first.
 */

/** How long a check-in waits for a socket that never reports its close; the server then judges what it has. */
export const LIVE_CLOSE_WAIT_MS = 2000;

/** A browser socket, as far as its close is concerned. */
type ClosingSocket = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly readyState: number; };

const CLOSED = 3;
const closing = new Map<string, Set<Promise<void>>>();
const noteKey = (notebookId: string, path: string) => `${notebookId}\u0000${path}`;

/** Notes that a collab editor of the note closed `socket`: a check-in of the note waits until it closed, or `LIVE_CLOSE_WAIT_MS` passed. */
export function noteLiveSocketClosing(notebookId: string, path: string, socket: ClosingSocket | null | undefined): void {
  if (!socket || socket.readyState === CLOSED) return;
  const key = noteKey(notebookId, path);
  const pending = closing.get(key) ?? new Set<Promise<void>>();
  closing.set(key, pending);
  const closed = new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      socket.removeEventListener('close', done);
      resolve();
    };
    const timer = setTimeout(done, LIVE_CLOSE_WAIT_MS);
    socket.addEventListener('close', done);
  }).finally(() => {
    pending.delete(closed);
    if (!pending.size && closing.get(key) === pending) closing.delete(key);
  });
  pending.add(closed);
}

/** Resolves once every socket a collab editor of the note closed has closed. */
export async function liveSocketsClosed(notebookId: string, path: string): Promise<void> {
  await Promise.all(closing.get(noteKey(notebookId, path)) ?? []);
}
