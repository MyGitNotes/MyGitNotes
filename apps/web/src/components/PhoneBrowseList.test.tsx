// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PULL_CLOSE_MS, PULL_SETTLE_MS, PULL_SYNC_PX, PULL_TRIGGER_PX } from '../lib/pull-refresh.js';
import { PhoneBrowseList } from './PhoneBrowseList.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
  document.body.innerHTML = '';
});

function list(onRefresh?: () => Promise<void>) {
  render(
    <I18nProvider>
      <PhoneBrowseList onRefresh={onRefresh}>
        <ul aria-label='Notes'>
          <li id='row'>A note</li>
        </ul>
      </PhoneBrowseList>
    </I18nProvider>,
  );
  return document.querySelector<HTMLElement>('.phone-browse-scroll')!;
}

function fire(type: string, x?: number, y?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: x === undefined ? [] : [{ clientX: x, clientY: y }] });
  act(() => void document.getElementById('row')!.dispatchEvent(event));
  return event;
}

/** A finger pulled from y = 100 down by dy (and dx across), not yet lifted. */
function pullBy(dy: number, dx = 0) {
  fire('touchstart', 200, 100);
  fire('touchmove', 200 + dx / 2, 100 + dy / 2);
  return fire('touchmove', 200 + dx, 100 + dy);
}

async function settle(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("pulling a phone's list down from its top", () => {
  it('says to pull further, then to let go, the list following the finger', () => {
    const scroll = list(vi.fn(async () => {}));
    const move = pullBy(40);
    expect(move.defaultPrevented).toBe(true);
    expect(scroll).toHaveAttribute('data-pull', 'pulling');
    expect(scroll.style.getPropertyValue('--pull-distance')).toBe('40px');
    expect(screen.getByRole('status')).toHaveTextContent('Pull to sync');
    fire('touchmove', 200, 100 + PULL_TRIGGER_PX);
    expect(screen.getByRole('status')).toHaveTextContent('Release to sync');
  });

  it('syncs once when let go past 64 px, shows it syncing, and closes when the sync answers', async () => {
    let answer!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>(resolve => answer = resolve));
    const scroll = list(onRefresh);
    pullBy(PULL_TRIGGER_PX + 10);
    fire('touchend');
    await settle(0);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveAttribute('data-pull', 'syncing');
    expect(scroll.style.getPropertyValue('--pull-distance')).toBe(`${PULL_SYNC_PX}px`);
    expect(screen.getByRole('status')).toHaveTextContent('Syncing…');

    // A second pull while it syncs is a plain scroll: nothing is sent again.
    const again = pullBy(PULL_TRIGGER_PX + 40);
    fire('touchend');
    expect(again.defaultPrevented).toBe(false);
    await settle(0);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    answer();
    await settle(0);
    expect(scroll).toHaveAttribute('data-pull', 'closing');
    await settle(PULL_CLOSE_MS);
    expect(scroll).not.toHaveAttribute('data-pull');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('returns without syncing when let go short of 64 px', async () => {
    const onRefresh = vi.fn(async () => {});
    const scroll = list(onRefresh);
    pullBy(PULL_TRIGGER_PX - 10);
    fire('touchend');
    expect(scroll).toHaveAttribute('data-pull', 'returning');
    await settle(PULL_SETTLE_MS);
    expect(scroll).not.toHaveAttribute('data-pull');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('leaves a scrolled list, an upward or sideways move, and an open sheet alone', async () => {
    const onRefresh = vi.fn(async () => {});
    const scroll = list(onRefresh);
    scroll.scrollTop = 120;
    expect(pullBy(100).defaultPrevented).toBe(false);
    fire('touchend');
    scroll.scrollTop = 0;
    expect(pullBy(-100).defaultPrevented).toBe(false);
    fire('touchend');
    expect(pullBy(20, 120).defaultPrevented).toBe(false);
    fire('touchend');
    document.body.insertAdjacentHTML('beforeend', "<div class='phone-sheet-layer'></div>");
    expect(pullBy(100).defaultPrevented).toBe(false);
    fire('touchend');
    await settle(PULL_CLOSE_MS);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(scroll).not.toHaveAttribute('data-pull');
  });

  it('has no indicator without a refresh', () => {
    list();
    expect(screen.queryByRole('status')).toBeNull();
    expect(pullBy(100).defaultPrevented).toBe(false);
  });
});
