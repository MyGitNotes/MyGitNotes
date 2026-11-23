// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { useBrowseColumns } from './useBrowseColumns.js';

/*
 * The three columns keep fixed widths; what the page measures is the room they share, which decides whether the notebooks column gives way
 * to its rail. jsdom lays nothing out, so this file reports that room by hand: `getBoundingClientRect` on mount, then what a browser's
 * ResizeObserver delivers after layout.
 */
const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element>; observer: ResizeObserver; }>();
const originalObserver = globalThis.ResizeObserver;
beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1440;
  globalThis.ResizeObserver = class {
    private readonly record: { callback: ResizeObserverCallback; targets: Set<Element>; observer: ResizeObserver; };
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, targets: new Set(), observer: this as unknown as ResizeObserver };
      observers.add(this.record);
    }
    observe(target: Element) {
      this.record.targets.add(target);
    }
    unobserve(target: Element) {
      this.record.targets.delete(target);
    }
    disconnect() {
      observers.delete(this.record);
    }
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  observers.clear();
  window.localStorage.clear();
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
});

/** The columns' element, `width` px wide when first measured. */
const element = (width: number) => Object.assign(document.createElement('div'), { getBoundingClientRect: () => ({ width }) as DOMRect });

/** What a browser reports after layout: every observed element at `width`. */
function observe(width: number) {
  act(() => {
    for (const { callback, targets, observer } of Array.from(observers)) {
      callback([...targets].map(target => ({ target, contentRect: { width } as DOMRectReadOnly, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] })), observer);
    }
  });
}

it('keeps the notebooks column open where the note has its room, whatever the window', () => {
  const { result } = renderHook(() => useBrowseColumns({ panes: 1 }));
  act(() => result.current.measure(element(1388)));
  expect(result.current.layout).toEqual({ notebooks: 'open', list: true });
  observe(1228);
  expect(result.current.layout.notebooks).toBe('open');
});

it('folds the notebooks column to its rail when the measured room leaves the note under 600px, and opens it once the room is back', () => {
  const { result } = renderHook(() => useBrowseColumns({ panes: 1 }));
  act(() => result.current.measure(element(1388)));
  // 1140 - 232 - 320 = 588, under the note's 600.
  observe(1140);
  expect(result.current.layout.notebooks).toBe('rail');
  observe(1160);
  expect(result.current.layout.notebooks).toBe('open');
});

it('counts the list column only while it shows', () => {
  const { result } = renderHook(() => useBrowseColumns({ panes: 1 }));
  act(() => result.current.measure(element(1140)));
  expect(result.current.layout.notebooks).toBe('rail');
  act(() => result.current.toggleList());
  // Without the list, 1140 - 232 leaves the note 908px.
  expect(result.current.layout).toEqual({ notebooks: 'open', list: false });
});

it('takes the first measure the element gives, before the browser reports a resize', () => {
  const { result } = renderHook(() => useBrowseColumns({ panes: 3 }));
  // Three panes side by side need 600 + 2 × 360 beside both columns.
  act(() => result.current.measure(element(1800)));
  expect(result.current.layout.notebooks).toBe('rail');
});

it('stops watching the room when the columns go', () => {
  const { result, unmount } = renderHook(() => useBrowseColumns({ panes: 1 }));
  act(() => result.current.measure(element(1388)));
  expect(observers.size).toBe(1);
  unmount();
  expect(observers.size).toBe(0);
});
