import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceUpdate, applyUpdate, dismissUpdate, getUpdateReady, resetUpdateStore, subscribeUpdate, type UpdateWorker, type WorkerContainer } from './update-store.js';

afterEach(resetUpdateStore);

/** A page's `navigator.serviceWorker`: it names the controlling worker and lets a test fire `controllerchange`. */
const pageContainer = (controller: unknown = {}) => {
  const listeners: Array<() => void> = [];
  return { controller, addEventListener: vi.fn((_type: 'controllerchange', listener: () => void) => void listeners.push(listener)), changeController: () => listeners.forEach(listener => listener()) } satisfies WorkerContainer & { changeController(): void; };
};
const waitingWorker = (state = 'installed') => ({ postMessage: vi.fn(), state }) satisfies UpdateWorker;

describe('update store', () => {
  it('announces a worker that installed behind a running one', () => {
    const seen = vi.fn();
    subscribeUpdate(seen);
    announceUpdate(waitingWorker(), pageContainer());
    expect(getUpdateReady()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not announce the first install, which no page runs behind', () => {
    const container = pageContainer(null);
    announceUpdate(waitingWorker(), container);
    expect(getUpdateReady()).toBe(false);
    expect(container.addEventListener).not.toHaveBeenCalled();
  });

  it('swaps only when the person applies it, then reloads once the new worker controls the page', () => {
    const worker = waitingWorker();
    const reload = vi.fn();
    const container = pageContainer();
    announceUpdate(worker, container);
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    expect(applyUpdate(container, reload)).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.changeController();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no update waits, and forgets one the person put off', () => {
    const container = pageContainer();
    expect(applyUpdate(container, vi.fn())).toBe(false);
    announceUpdate(waitingWorker(), container);
    dismissUpdate();
    expect(getUpdateReady()).toBe(false);
  });

  it('reloads at once when the new worker already controls the page', () => {
    const worker = waitingWorker('activated');
    const reload = vi.fn();
    announceUpdate(worker, pageContainer());
    expect(applyUpdate(pageContainer(worker), reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('lets a second tab reload after the first applied the update', async () => {
    // Each tab is its own page with its own store; the one waiting worker is shared.
    const worker = waitingWorker();
    const tabs = await Promise.all([0, 1].map(async () => {
      vi.resetModules();
      const store = await import('./update-store.js');
      const container = pageContainer();
      store.announceUpdate(worker, container);
      return { store, container, reload: vi.fn() };
    }));
    const [first, second] = tabs;

    expect(first.store.applyUpdate(first.container, first.reload)).toBe(true);
    // The worker takes every open page, so both tabs see the controller change; only the one that asked reloads by itself.
    for (const tab of tabs) tab.container.changeController();
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(second.reload).not.toHaveBeenCalled();

    expect(second.store.getUpdateReady()).toBe(true);
    expect(second.store.applyUpdate(second.container, second.reload)).toBe(true);
    expect(second.reload).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('waits for a newer worker again after one swap', () => {
    const container = pageContainer();
    announceUpdate(waitingWorker(), container);
    container.changeController();
    const newer = waitingWorker();
    announceUpdate(newer, container);
    const reload = vi.fn();
    applyUpdate(container, reload);
    expect(reload).not.toHaveBeenCalled();
    expect(newer.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
