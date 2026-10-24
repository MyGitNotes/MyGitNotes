// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FOLD_MS, useFoldAnimation } from './use-fold-animation.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('stays still on the first render, folded or not', () => {
  expect(renderHook(() => useFoldAnimation(true)).result.current).toBe(false);
  expect(renderHook(() => useFoldAnimation(false)).result.current).toBe(false);
});

it('animates from the render that changes the fold until the animation has had time to finish', () => {
  const { result, rerender } = renderHook(({ folded }) => useFoldAnimation(folded), { initialProps: { folded: false } });
  rerender({ folded: true });
  expect(result.current).toBe(true);
  act(() => {
    vi.advanceTimersByTime(FOLD_MS - 1);
  });
  expect(result.current).toBe(true);
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(result.current).toBe(false);
});

it('restarts when the fold flips again mid-animation', () => {
  const { result, rerender } = renderHook(({ folded }) => useFoldAnimation(folded), { initialProps: { folded: false } });
  rerender({ folded: true });
  act(() => {
    vi.advanceTimersByTime(FOLD_MS - 50);
  });
  rerender({ folded: false });
  act(() => {
    vi.advanceTimersByTime(FOLD_MS - 50);
  });
  expect(result.current).toBe(true);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(result.current).toBe(false);
});
