// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { followPage } from './page-events.js';

const pageshow = (persisted: boolean) => window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }));

function streams() {
  const opened: { close: ReturnType<typeof vi.fn>; }[] = [];
  const open = vi.fn(() => {
    const stream = { close: vi.fn() };
    opened.push(stream);
    return stream;
  });
  return { opened, open };
}

it('closes the stream when the page is hidden, so a navigated-away document cannot hold a connection', () => {
  const { opened, open } = streams();
  const stop = followPage(open);
  expect(opened).toHaveLength(1);
  window.dispatchEvent(new Event('pagehide'));
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  stop();
  expect(opened[0].close).toHaveBeenCalledTimes(1);
});

it('opens the stream again only when the back/forward cache restores the page', () => {
  const { opened, open } = streams();
  const stop = followPage(open);
  window.dispatchEvent(new Event('pagehide'));
  pageshow(false);
  expect(opened).toHaveLength(1);
  pageshow(true);
  expect(opened).toHaveLength(2);
  pageshow(true);
  expect(opened).toHaveLength(2);
  stop();
  expect(opened[1].close).toHaveBeenCalledTimes(1);
});

it('stops following the page once it is stopped', () => {
  const { opened, open } = streams();
  followPage(open)();
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('pagehide'));
  pageshow(true);
  expect(opened).toHaveLength(1);
  expect(opened[0].close).toHaveBeenCalledTimes(1);
});
