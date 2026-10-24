// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DRAFT_SAVE_MS, draftKey, useAgentDraft } from './draft.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

const home = draftKey({ repository: 'local:home', folder: '' });
const blog = draftKey({ repository: 'local:home', folder: 'blog' });

it('keeps a key per agent workspace', () => {
  expect(home).not.toBe(blog);
  expect(draftKey({ repository: 'github:octo/notes@main', folder: '' })).not.toBe(home);
});

it('writes the draft once typing pauses, not on every keystroke', () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const { result } = renderHook(() => useAgentDraft(home));
  act(() => result.current[1]('h'));
  act(() => result.current[1]('he'));
  act(() => result.current[1]('hel'));
  expect(localStorage.getItem(home)).toBeNull();
  act(() => void vi.advanceTimersByTime(DRAFT_SAVE_MS));
  expect(localStorage.getItem(home)).toBe('hel');
  expect(setItem).toHaveBeenCalledTimes(1);
});

it('restores the draft on a remount, and a reload before the pause has passed still keeps it', () => {
  const first = renderHook(() => useAgentDraft(home));
  act(() => first.result.current[1]('half a thought'));
  // The panel closes (unmounts) before the debounce fires.
  first.unmount();
  expect(localStorage.getItem(home)).toBe('half a thought');
  const second = renderHook(() => useAgentDraft(home));
  expect(second.result.current[0]).toBe('half a thought');
});

it('writes what typing had not yet when the page is hidden for a reload', () => {
  const { result } = renderHook(() => useAgentDraft(home));
  act(() => result.current[1]('before reload'));
  expect(localStorage.getItem(home)).toBeNull();
  window.dispatchEvent(new Event('pagehide'));
  expect(localStorage.getItem(home)).toBe('before reload');
});

it('keeps another workspace its own draft, and writes the one left behind under its own key', () => {
  localStorage.setItem(blog, 'blog draft');
  const { result, rerender } = renderHook(({ key }) => useAgentDraft(key), { initialProps: { key: home } });
  act(() => result.current[1]('home draft'));
  rerender({ key: blog });
  expect(result.current[0]).toBe('blog draft');
  expect(localStorage.getItem(home)).toBe('home draft');
  expect(localStorage.getItem(blog)).toBe('blog draft');
  act(() => void vi.advanceTimersByTime(DRAFT_SAVE_MS));
  expect(localStorage.getItem(blog)).toBe('blog draft');
  rerender({ key: home });
  expect(result.current[0]).toBe('home draft');
});

it('removes the stored draft at once when the text is emptied, as a send does, but not when the panel merely closes', () => {
  const { result, unmount } = renderHook(() => useAgentDraft(home));
  act(() => result.current[1]('to send'));
  act(() => void vi.advanceTimersByTime(DRAFT_SAVE_MS));
  expect(localStorage.getItem(home)).toBe('to send');
  act(() => result.current[1](''));
  expect(localStorage.getItem(home)).toBeNull();
  act(() => result.current[1]('kept'));
  act(() => void vi.advanceTimersByTime(DRAFT_SAVE_MS));
  unmount();
  expect(localStorage.getItem(home)).toBe('kept');
});

it('takes an updater like a state setter', () => {
  localStorage.setItem(home, 'one');
  const { result } = renderHook(() => useAgentDraft(home));
  act(() => result.current[1](current => `${current} two`));
  expect(result.current[0]).toBe('one two');
});

it('works without storage: the text stays in the box and nothing throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  const { result, unmount } = renderHook(() => useAgentDraft(home));
  expect(result.current[0]).toBe('');
  act(() => result.current[1]('still here'));
  act(() => void vi.advanceTimersByTime(DRAFT_SAVE_MS));
  expect(result.current[0]).toBe('still here');
  act(() => result.current[1](''));
  expect(() => unmount()).not.toThrow();
});
