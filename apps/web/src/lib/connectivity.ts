import { useSyncExternalStore } from 'react';

/** Whether the browser reports a network connection; it can say yes without reaching the server, never no while connected. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** The message a browser's fetch fails with when no response arrived at all (Chrome, Firefox and Safari word it differently). */
export const isNetworkFailure = (message: string) => /failed to fetch|load failed|networkerror|network request failed/i.test(message);
