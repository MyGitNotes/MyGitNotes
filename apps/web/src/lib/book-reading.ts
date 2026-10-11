import { useSyncExternalStore } from 'react';

/** How a Book reads: all chapters as one long scroll, or one chapter at a time. */
export type BookReadingMode = 'continuous' | 'paged';

export const BOOK_READING_STORAGE_KEY = 'github-notes:book-reading-mode';

/** This device's choice; a Book reads continuously until the device picks paging. It lives in the browser, never in the compilation file. */
export function readBookReadingMode(storage?: Pick<Storage, 'getItem'>): BookReadingMode {
  try {
    return (storage ?? globalThis.localStorage).getItem(BOOK_READING_STORAGE_KEY) === 'paged' ? 'paged' : 'continuous';
  } catch {
    return 'continuous';
  }
}

let mode: BookReadingMode | undefined;
const listeners = new Set<() => void>();

const getBookReadingMode = () => mode ??= readBookReadingMode();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function writeBookReadingMode(next: BookReadingMode, storage?: Pick<Storage, 'setItem'>) {
  mode = next;
  try {
    (storage ?? globalThis.localStorage).setItem(BOOK_READING_STORAGE_KEY, next);
  } catch { /* Keep the in-page choice. */ }
  for (const listener of listeners) listener();
}

/** Drops the in-page copy so the next read comes from storage; tests use it between cases. */
export function resetBookReadingMode() {
  mode = undefined;
  for (const listener of listeners) listener();
}

/** The reading mode of this device, shared by every open Book of the page. */
export const useBookReadingMode = (): BookReadingMode => useSyncExternalStore(subscribe, getBookReadingMode);
