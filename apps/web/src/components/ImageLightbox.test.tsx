// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageLightbox } from './ImageLightbox.js';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const original = async (src: string) => {
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  const view = render(
    <>
      <ImageLightbox />
      <div data-markdown-view>
        <img data-testid='img' src={src} alt='pic' />
      </div>
    </>,
  );
  fireEvent.click(view.getByTestId('img'));
  return document.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
};

it('keeps the Referer on the original of an image of this site, so a demo page’s image is asked for as the demo', async () => {
  expect((await original('/raw-assets/by-hash/' + 'a'.repeat(40))).getAttribute('rel')).toBe('noopener');
});

it('sends no Referer to the original of an image of another site', async () => {
  expect((await original('https://cdn.example/pic.png')).getAttribute('rel')).toBe('noopener noreferrer');
});
