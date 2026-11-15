// @vitest-environment jsdom
import { createElement, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { BrowseDock } from './BrowseDock.js';

/*
 * jsdom lays nothing out, and react-resizable-panels measures its panels with offsetWidth and learns of a group's new size
 * from a ResizeObserver. This file lays a group out by hand: the group is `groupWidth` wide, a panel takes the pixel basis it
 * starts with or its share of the inline flex-grow the library writes, and `observe()` delivers what a browser would after layout.
 */
let groupWidth = 1388;
const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element>; observer: ResizeObserver; }>();
function widthOf(element: HTMLElement): number {
  if (element.hasAttribute('data-group')) return groupWidth;
  if (!element.hasAttribute('data-panel')) return 0;
  const panels = [...element.parentElement!.children].filter((child): child is HTMLElement => child.hasAttribute('data-panel'));
  const basis = panels.map(panel => panel.style.flexGrow === '' && panel.style.flexBasis.endsWith('px') ? parseFloat(panel.style.flexBasis) : null);
  const free = groupWidth - basis.reduce<number>((sum, px) => sum + (px ?? 0), 0);
  const grow = panels.map((panel, index) => basis[index] === null ? parseFloat(panel.style.flexGrow || '1') : 0);
  const total = grow.reduce((sum, value) => sum + value, 0);
  const index = panels.indexOf(element);
  return basis[index] ?? free * grow[index]! / total;
}
/** Panels and dividers sit side by side from the group's left edge; the library orders them by this. */
function leftOf(element: HTMLElement): number {
  const parent = element.parentElement;
  if (!parent?.hasAttribute('data-group')) return 0;
  const siblings = [...parent.children] as HTMLElement[];
  return siblings.slice(0, siblings.indexOf(element)).reduce((sum, sibling) => sum + widthOf(sibling), 0);
}
const originalObserver = globalThis.ResizeObserver;
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
beforeEach(() => {
  groupWidth = 1388;
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
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return widthOf(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return leftOf(this);
    },
  });
});
afterEach(() => {
  cleanup();
  observers.clear();
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalWidth);
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalHeight);
  if (originalLeft) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', originalLeft);
});

/** What a browser reports after layout: every observed element at its current size. */
function observe() {
  act(() => {
    for (const { callback, targets, observer } of Array.from(observers)) {
      callback([...targets].map(target => ({ target, borderBoxSize: [{ inlineSize: widthOf(target as HTMLElement), blockSize: 800 }], contentBoxSize: [], devicePixelContentBoxSize: [], contentRect: {} as DOMRectReadOnly })), observer);
    }
  });
}
const dockWidth = () => Math.round(widthOf(document.querySelector<HTMLElement>('.browse-dock-group > [data-panel]')!));
/* eslint-disable-next-line react/no-children-prop -- The test passes children as part of the props contract. */
const dock = (size: number, onSizeChange: (size: number) => void = () => {}) => createElement(BrowseDock, { placement: 'left', size, onSizeChange, collapsed: false, narrow: false, narrowView: 'focus', browse: createElement('p', null, 'browse'), children: createElement('p', null, 'focus') });

it('opens at the stored width, whatever the window', () => {
  for (const width of [1388, 1228]) {
    groupWidth = width;
    const { unmount } = render(dock(288));
    observe();
    expect(dockWidth()).toBe(288);
    unmount();
  }
});

it('keeps its width when the space beside it grows, as when the sidebar folds away after the dock opens', () => {
  groupWidth = 1132;
  render(dock(288));
  observe();
  groupWidth = 1388;
  observe();
  expect(dockWidth()).toBe(288);
});

/*
 * Seen at 1440 px: 288 px when a note opened from the list, 350 px after a reload, 288 again after switching views and back. The library
 * reads a panel's defaultSize once, when the panel first registers; a later size re-registers the panel and the group puts back the
 * proportions it last had, so the stored width that reached the dock after it opened was ignored and the dock kept its first width,
 * scaled to the space it had by then.
 */
it('takes a stored width that arrives after it opened', () => {
  const { rerender } = render(dock(350));
  observe();
  expect(dockWidth()).toBe(350);
  rerender(dock(288));
  observe();
  expect(dockWidth()).toBe(288);
});

it('takes a stored width that arrives as the space beside it grows, before the browser reports the new size', () => {
  groupWidth = 1132;
  const { rerender } = render(dock(350));
  observe();
  groupWidth = 1388;
  rerender(dock(288));
  observe();
  expect(dockWidth()).toBe(288);
  groupWidth = 1228;
  observe();
  expect(dockWidth()).toBe(288);
});

/*
 * Seen at 1440 px after a reload with a Focus open: 350 px for a stored 288, 486.9 for a stored 400. On the first render the workspace's
 * filter sidebar still takes its width; it folds in an effect of that same mount, and the library registers the dock's group a second
 * time in the commit that follows, after those effects. That second registration keeps the share the dock had of the narrower group and
 * takes the wider one as the size it last knew, so its own observer sees nothing to correct.
 */
for (const stored of [288, 400]) {
  it(`opens at the stored ${stored} px when the sidebar folds away while the dock mounts`, () => {
    function SidebarFoldsOnMount() {
      useEffect(() => {
        groupWidth = 1388;
      }, []);
      return null;
    }
    groupWidth = 1141;
    render(createElement('div', null, dock(stored), createElement(SidebarFoldsOnMount)));
    observe();
    expect(dockWidth()).toBe(stored);
    groupWidth = 1228;
    observe();
    expect(dockWidth()).toBe(stored);
  });
}

it('keeps a stored width that arrived after it opened when the window is resized', () => {
  const { rerender } = render(dock(288));
  observe();
  rerender(dock(400));
  observe();
  groupWidth = 1228;
  observe();
  expect(dockWidth()).toBe(400);
  groupWidth = 1388;
  observe();
  expect(dockWidth()).toBe(400);
});

it('moves with the keyboard and stores where it stopped', () => {
  const stored: number[] = [];
  function Stateful() {
    const [size, setSize] = useState(288);
    return dock(size, next => {
      stored.push(next);
      setSize(next);
    });
  }
  render(createElement(Stateful));
  observe();
  const separator = screen.getByRole('separator');
  act(() => {
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
  });
  observe();
  const moved = dockWidth();
  expect(moved).toBeGreaterThan(288);
  expect(stored.at(-1)).toBe(moved);
});
