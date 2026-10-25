import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceUpdate, applyUpdate, dismissUpdate, getUpdateReady, resetUpdateStore, subscribeUpdate } from './update-store.js';

afterEach(resetUpdateStore);

describe('update store', () => {
  it('announces a worker that installed behind a running one', () => {
    const seen = vi.fn();
    subscribeUpdate(seen);
    announceUpdate({ postMessage: vi.fn() }, true);
    expect(getUpdateReady()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not announce the first install, which no page runs behind', () => {
    announceUpdate({ postMessage: vi.fn() }, false);
    expect(getUpdateReady()).toBe(false);
  });

  it('swaps only when the person applies it, then reloads once the new worker controls the page', () => {
    const worker = { postMessage: vi.fn() };
    const reload = vi.fn();
    let controllerChange: (() => void) | undefined;
    const container = { addEventListener: vi.fn((_type: 'controllerchange', listener: () => void) => void (controllerChange = listener)) };
    announceUpdate(worker, true);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    expect(applyUpdate(container, reload)).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    controllerChange?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no update waits, and forgets one the person put off', () => {
    const container = { addEventListener: vi.fn() };
    expect(applyUpdate(container, vi.fn())).toBe(false);
    expect(container.addEventListener).not.toHaveBeenCalled();
    announceUpdate({ postMessage: vi.fn() }, true);
    dismissUpdate();
    expect(getUpdateReady()).toBe(false);
  });
});
