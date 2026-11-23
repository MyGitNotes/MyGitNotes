import { describe, expect, it } from 'vitest';
import { rememberSignInReturn, resumeSignInReturn, SIGN_IN_RETURN_MS, takeSignInReturn } from './sign-in-return.js';

/** A storage of its own per test, as a tab's sessionStorage is. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}
const place = (url: string) => {
  const { pathname, search, hash } = new URL(url, 'https://notes.test');
  return { pathname, search, hash };
};
const history = () => {
  const calls: unknown[][] = [];
  return { calls, state: { idx: 0 }, replaceState: (...args: unknown[]) => void calls.push(args) };
};

describe('the page a sign-in returns to', () => {
  it('opens the note the person was on when they chose to sign in once the sign-in lands on the start page, and only once', () => {
    const storage = memoryStorage();
    rememberSignInReturn(place('/notebooks/meetings/%E9%80%B1%E6%9C%83.md?mode=source#agenda'), storage, 1_000);
    const tab = history();
    resumeSignInReturn(place('/'), tab, storage, 2_000);
    expect(tab.calls).toEqual([[{ idx: 0 }, '', '/notebooks/meetings/%E9%80%B1%E6%9C%83.md?mode=source#agenda']]);
    const again = history();
    resumeSignInReturn(place('/'), again, storage, 3_000);
    expect(again.calls).toEqual([]);
  });

  it('leaves a tab that is not on the bare start page where it is, and keeps the page for the sign-in', () => {
    const storage = memoryStorage();
    rememberSignInReturn(place('/notebooks/a/n.md'), storage, 0);
    for (const url of ['/notebooks/b', '/?q=x', '/#top']) {
      const tab = history();
      resumeSignInReturn(place(url), tab, storage, 1);
      expect(tab.calls).toEqual([]);
    }
    expect(takeSignInReturn(storage, 1)).toBe('/notebooks/a/n.md');
  });

  it('forgets a page kept longer ago than a sign-in takes, and keeps nothing for a sign-in started on the start page', () => {
    const storage = memoryStorage();
    rememberSignInReturn(place('/notebooks/a/n.md'), storage, 0);
    expect(takeSignInReturn(storage, SIGN_IN_RETURN_MS + 1)).toBeNull();
    rememberSignInReturn(place('/notebooks/a/n.md'), storage, 0);
    rememberSignInReturn(place('/'), storage, 1);
    expect(takeSignInReturn(storage, 2)).toBeNull();
  });

  it('returns only to a page of this site the app routes', () => {
    const storage = memoryStorage();
    for (const path of ['//evil.test/x', '/\\evil.test', 'https://evil.test/', '/api/auth/entra', '/api']) {
      storage.setItem('mygitnotes.signInReturn', JSON.stringify({ path, at: 0 }));
      expect(takeSignInReturn(storage, 1), path).toBeNull();
    }
    storage.setItem('mygitnotes.signInReturn', 'not json');
    expect(takeSignInReturn(storage, 1)).toBeNull();
    expect(storage.getItem('mygitnotes.signInReturn')).toBeNull();
  });
});
