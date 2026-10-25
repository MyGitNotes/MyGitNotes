import { describe, expect, it, vi } from 'vitest';
import { navigateWithShell } from './sw-navigate.js';

const request = new Request('https://notes.example/notebooks/work');
const shell = () => Promise.resolve(new Response('cached shell'));
const text = async (response: Response) => response.text();

describe('navigateWithShell', () => {
  it('serves the network answer', async () => {
    const answer = new Response('fresh', { status: 200 });
    expect(await text(await navigateWithShell(request, () => Promise.resolve(answer), shell))).toBe('fresh');
  });

  it('waits for a slow network instead of serving the previous build’s shell', async () => {
    vi.useFakeTimers();
    try {
      const pending = navigateWithShell(request, () => new Promise<Response>(resolve => setTimeout(() => resolve(new Response('fresh')), 60_000)), shell);
      await vi.advanceTimersByTimeAsync(30_000);
      let settled = false;
      void pending.then(() => settled = true);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await text(await pending)).toBe('fresh');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves the cached shell when the network fails', async () => {
    expect(await text(await navigateWithShell(request, () => Promise.reject(new TypeError('Failed to fetch')), shell))).toBe('cached shell');
  });

  it('serves the cached shell when the server answers 5xx, and the answer itself when there is none', async () => {
    const failed = () => Promise.resolve(new Response('down', { status: 503 }));
    expect(await text(await navigateWithShell(request, failed, shell))).toBe('cached shell');
    expect((await navigateWithShell(request, failed, () => Promise.resolve(undefined))).status).toBe(503);
  });

  it('serves a 404 or other client error as the server said it', async () => {
    expect((await navigateWithShell(request, () => Promise.resolve(new Response('no', { status: 404 })), shell)).status).toBe(404);
  });

  it('fails like the network when it fails and no shell is cached', async () => {
    const error = new TypeError('Failed to fetch');
    await expect(navigateWithShell(request, () => Promise.reject(error), () => Promise.resolve(undefined))).rejects.toBe(error);
  });
});
