// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fitTagCount, NoteTags } from './NoteTags.js';

afterEach(cleanup);

it('fits every chip when they all fit, and otherwise as many as leave room for the +N chip', () => {
  expect(fitTagCount([50, 50, 50], 158, 4, 24)).toBe(3);
  expect(fitTagCount([50, 50, 50], 150, 4, 24)).toBe(2);
  expect(fitTagCount([50, 50, 50], 100, 4, 24)).toBe(1);
  expect(fitTagCount([50, 50, 50], 60, 4, 24)).toBe(0);
  expect(fitTagCount([], 0, 4, 24)).toBe(0);
});

let rowWidth = 0;
let notify: () => void = () => {};

beforeEach(() => {
  rowWidth = 150;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this.matches('[data-tag-more]') ? 24 : this.matches('[data-tag-chip]') ? 50 : this.matches('.note-tags') ? rowWidth : 0;
    return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const shown = (container: HTMLElement) => [...container.querySelectorAll('[data-tag-chip]:not([data-overflow])')].map(chip => chip.textContent);

it('collapses the tags that do not fit into a +N chip whose tooltip lists them', () => {
  const { container } = render(createElement(NoteTags, { tags: ['alpha', 'beta', 'gamma'], oneLine: true }));
  expect(shown(container)).toEqual(['alpha', 'beta']);
  const more = container.querySelector<HTMLElement>('[data-tag-more]:not([data-overflow])')!;
  expect(more).toHaveTextContent('+1');
  expect(more).toHaveAttribute('title', 'gamma');
  expect(more).toHaveAttribute('aria-label', '1 more tags: gamma');
  // The collapsed chip stays rendered, but out of sight and out of reach.
  const hidden = container.querySelector('[data-tag-chip][data-overflow]')!;
  expect(hidden).toHaveTextContent('gamma');
  expect(hidden).toHaveAttribute('aria-hidden', 'true');
  expect(hidden).toHaveAttribute('inert');
});

it('shows every tag with no +N chip when the row is wide enough, and re-fits when the row resizes', () => {
  rowWidth = 400;
  const { container } = render(createElement(NoteTags, { tags: ['alpha', 'beta', 'gamma', 'delta'], oneLine: true }));
  expect(shown(container)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  expect(container.querySelector('[data-tag-more]:not([data-overflow])')).toBeNull();

  rowWidth = 110;
  act(() => notify());
  expect(shown(container)).toEqual(['alpha']);
  const more = container.querySelector<HTMLElement>('[data-tag-more]:not([data-overflow])')!;
  expect(more).toHaveTextContent('+3');
  expect(more).toHaveAttribute('title', 'beta, gamma, delta');
});

it('keeps the single-line row free of an icon on each chip', () => {
  const { container } = render(createElement(NoteTags, { tags: ['alpha'], oneLine: true }));
  expect(container.querySelector('.note-tag-chip svg')).toBeNull();
});
