import { describe, expect, it, vi } from 'vitest';
import { PRELOAD_RELOAD_KEY, reloadOnPreloadError } from './preload-error.js';

const setup = (initial?: string) => {
  const values = new Map<string, string>(initial === undefined ? [] : [[PRELOAD_RELOAD_KEY, initial]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  let fire: (event: Event) => void = () => undefined;
  const target = { addEventListener: (_type: 'vite:preloadError', listener: (event: Event) => void) => void (fire = listener) };
  const reload = vi.fn();
  let time = 1_000_000;
  reloadOnPreloadError(target, storage, reload, () => time);
  const failure = () => {
    const event = new Event('vite:preloadError', { cancelable: true });
    fire(event);
    return event;
  };
  return { failure, reload, values, advance: (ms: number) => void (time += ms) };
};

describe('reloadOnPreloadError', () => {
  it('reloads once when a lazy file is missing, and swallows the error', () => {
    const { failure, reload, values } = setup();
    const event = failure();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(values.get(PRELOAD_RELOAD_KEY)).toBe('1000000');
  });

  it('does not reload again right after a reload, so a file that stays missing cannot loop', () => {
    const { failure, reload, advance } = setup();
    failure();
    advance(5000);
    const event = failure();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reloads again for a failure long after the earlier reload', () => {
    const { failure, reload, advance } = setup();
    failure();
    advance(31_000);
    failure();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload at all when the guard cannot be written', () => {
    const reload = vi.fn();
    let fire: (event: Event) => void = () => undefined;
    reloadOnPreloadError({ addEventListener: (_type, listener) => void (fire = listener) }, {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
    }, reload);
    const event = new Event('vite:preloadError', { cancelable: true });
    fire(event);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
