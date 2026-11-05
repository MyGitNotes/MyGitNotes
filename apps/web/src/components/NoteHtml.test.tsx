// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { stop, hydrate, hydratePdf } = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, hydrate: vi.fn(() => stop), hydratePdf: vi.fn(() => () => {}) };
});
vi.mock('../lib/mermaid.js', () => ({ hydrateMermaid: hydrate }));
vi.mock('../lib/annotations/pdf-figure.js', () => ({ hydratePdfFigures: hydratePdf }));
vi.mock('../lib/i18n/index.js', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { NoteHtml } from './NoteHtml.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('draws the diagrams in the mounted HTML and again when the HTML changes', () => {
  const html = '<div class="note-mermaid"><pre>graph LR</pre></div>';
  const { container, rerender, unmount } = render(<NoteHtml className='prose-custom' html={html} />);
  expect(hydrate).toHaveBeenCalledTimes(1);
  expect(hydrate).toHaveBeenLastCalledWith(container.querySelector('[data-markdown-view]'), { errorLabel: 'mermaid.error' });
  rerender(<NoteHtml className='prose-custom' html={html + '<p>more</p>'} />);
  expect(hydrate).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenCalledTimes(1);
  unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});

it('draws nothing in untrusted HTML, whatever classes it carries', () => {
  render(<NoteHtml className='prose-custom' html={'<section class="note-mermaid"><pre>graph LR</pre></section><figure class="ann-pdf"><div class="ann-pages"></div></figure>'} untrusted />);
  expect(hydrate).not.toHaveBeenCalled();
  expect(hydratePdf).not.toHaveBeenCalled();
});
