import { useEffect } from 'react';

/**
 * Asks the browser to confirm leaving the page while `pending` holds; the browser shows its own wording.
 * An online workspace keeps note edits as drafts in this browser until they are committed, so this reminds the
 * visitor before they walk away from note text that has not reached the repository (`useChangeDialog`'s `leaveLoses`).
 */
export function useLeaveWarning(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
}
