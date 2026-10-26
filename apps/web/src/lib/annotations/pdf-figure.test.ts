// @vitest-environment jsdom
import { Marked } from 'marked';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en.js';
import type { PdfDocument } from '../pdf/pdf-document.js';
import { installAnnotationLinking } from './linking.js';
import { hydratePdfFigures, resetRememberedPages } from './pdf-figure.js';
import { renderAnnotate } from './render.js';

const { loaded, acquire } = vi.hoisted(() => ({ loaded: vi.fn(), acquire: vi.fn() }));
// The factory runs only when something imports the module, which is what the lazy-load tests watch.
vi.mock('../pdf/pdf-document.js', () => {
  loaded();
  return { sharedPdf: { acquire } };
});

const marked = new Marked();
const renderMarkdown = (markdown: string) => marked.parse(markdown, { gfm: true, breaks: true }) as string;
const t = (key: keyof typeof en, params: Record<string, string | number> = {}) => en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
const figureHtml = (...rows: string[]) => renderAnnotate([':::annotate', '[合約.pdf](/raw-assets/a.pdf)', '', ...rows, ':::'].join('\n'), { renderMarkdown, strings: en });
const ROWS = ['- {#1 pin x=10% y=10% page=1 resolved} done', '- {#2 pin x=20% y=20% page=2} open on two', '- {#3 pin x=30% y=30% page=3} open on three'];

function fakePdf(pageCount = 3) {
  const renders: Array<{ page: number; cssWidth: number; pixelRatio: number; cancel: ReturnType<typeof vi.fn>; }> = [];
  const pdf: PdfDocument = {
    pageCount,
    pageSize: vi.fn(async (page: number) => page === 3 ? { width: 600, height: 400 } : { width: 612, height: 792 }),
    render: vi.fn((page: number, _canvas: HTMLCanvasElement, options: { cssWidth: number; pixelRatio: number; }) => {
      const cancel = vi.fn();
      renders.push({ page, ...options, cancel });
      return { promise: Promise.resolve(), cancel };
    }),
    destroy: vi.fn(async () => undefined),
  };
  return { pdf, renders };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
};

const mount = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};
const visible = (root: Element) => [...root.querySelectorAll<HTMLElement>('section.ann-page')].filter(section => !section.hidden).map(section => section.className.match(/ann-p-(\d+)/)![1]);

let release: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetRememberedPages();
  loaded.mockClear();
  acquire.mockReset();
  release = vi.fn(async () => undefined);
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('hydratePdfFigures: the lazy-load boundary', () => {
  it('never imports the PDF module for a note without a PDF figure', async () => {
    const root = mount(`<p>text</p>${renderAnnotate(':::annotate\n![a](a.png)\n\n- {#1 pin x=1% y=1%} c\n:::', { renderMarkdown, strings: en })}`);
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(loaded).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    stop();
  });

  it('imports it for a PDF figure, and only then', async () => {
    const { pdf } = fakePdf();
    acquire.mockResolvedValue({ pdf, release });
    const root = mount(figureHtml(...ROWS));
    expect(loaded).not.toHaveBeenCalled();
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith('/raw-assets/a.pdf', expect.any(Function));
    stop();
  });
});

describe('hydratePdfFigures: the pager', () => {
  async function ready(rows = ROWS, pageCount = 3) {
    const fake = fakePdf(pageCount);
    acquire.mockResolvedValue({ pdf: fake.pdf, release });
    const root = mount(figureHtml(...rows));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    return { root, stop, ...fake };
  }

  it('opens on the first page with an open annotation and shows that page only', async () => {
    const { root, stop } = await ready();
    expect(visible(root)).toEqual(['2']);
    expect(root.querySelector('.ann-pager-status')!.textContent).toBe('Page 2 of 3');
    expect(root.querySelector('nav.ann-pager')!.getAttribute('aria-label')).toBe('Pages of 合約.pdf');
    stop();
  });

  it('opens on page 1 when every annotation is resolved', async () => {
    const { root, stop } = await ready(['- {#1 pin x=1% y=1% page=3 resolved} done']);
    expect(visible(root)).toEqual(['1']);
    expect(root.querySelector('.ann-pager-status')!.textContent).toBe('Page 1 of 3');
    stop();
  });

  it('draws the current page to a canvas sized to the stage, once the page size is known', async () => {
    const { root, renders, pdf, stop } = await ready();
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ page: 2, cssWidth: 600 });
    expect(pdf.pageSize).toHaveBeenCalledWith(2);
    const stage = root.querySelector<HTMLElement>('section.ann-p-2 .ann-stage')!;
    expect(stage.style.aspectRatio).toBe('612 / 792');
    const canvas = stage.querySelector('canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Page 2 of 3 of 合約.pdf');
    expect(stage.firstElementChild).toBe(canvas);
    stop();
  });

  it('steps with the buttons, announces the change, and disables the ends', async () => {
    const { root, renders, stop } = await ready();
    const [previous, next] = root.querySelectorAll<HTMLButtonElement>('.ann-pager-button');
    next.click();
    await settle();
    expect(visible(root)).toEqual(['3']);
    expect(next.disabled).toBe(true);
    expect(root.querySelector('[aria-live=polite]')!.textContent).toBe('Page 3 of 3');
    expect(root.querySelector('section.ann-p-2 canvas')).toBeNull();
    expect(renders.map(render => render.page)).toEqual([2, 3]);
    previous.click();
    previous.click();
    await settle();
    expect(visible(root)).toEqual(['1']);
    expect(previous.disabled).toBe(true);
    stop();
  });

  it('goes to a page from the page field, clamped to the document', async () => {
    const { root, stop } = await ready();
    const input = root.querySelector<HTMLInputElement>('.ann-pager-input')!;
    input.value = '99';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(visible(root)).toEqual(['3']);
    expect(input.value).toBe('3');
    stop();
  });

  it('shows a page without annotations when someone goes there, in page order', async () => {
    const { root, stop } = await ready();
    root.querySelector<HTMLButtonElement>('.ann-pager-button')!.click();
    await settle();
    expect(visible(root)).toEqual(['1']);
    expect([...root.querySelectorAll('section.ann-page')].map(section => section.className.match(/ann-p-(\d+)/)![1])).toEqual(['1', '2', '3']);
    stop();
  });

  it('tells pages apart by text: a chip per annotated page, resolved-only ones named', async () => {
    const { root, stop } = await ready();
    const chips = [...root.querySelectorAll('.ann-pager-chip')];
    expect(chips.map(chip => chip.textContent)).toEqual(['p. 1 · 1 resolved', 'p. 2 · 1', 'p. 3 · 1']);
    expect(chips[1].getAttribute('aria-current')).toBe('page');
    (chips[2] as HTMLButtonElement).click();
    await settle();
    expect(visible(root)).toEqual(['3']);
    expect(chips[2].getAttribute('aria-current')).toBe('page');
    expect(chips[1].hasAttribute('aria-current')).toBe(false);
    stop();
  });

  it('turns pages with PageUp, PageDown, Home and End on the focused stage', async () => {
    const { root, stop } = await ready();
    const press = (key: string) => root.querySelector('section:not([hidden]) .ann-stage')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press('End');
    expect(visible(root)).toEqual(['3']);
    press('PageUp');
    expect(visible(root)).toEqual(['2']);
    press('Home');
    expect(visible(root)).toEqual(['1']);
    press('PageDown');
    expect(visible(root)).toEqual(['2']);
    expect(press('a')).toBe(true);
    stop();
  });

  it('turns to the page of a marker or list number that is clicked, before the scroll', async () => {
    const { root, stop } = await ready();
    const uninstall = installAnnotationLinking(document);
    root.querySelector('.ann-figure')!.id = 'fig';
    const ref = [...root.querySelectorAll<HTMLAnchorElement>('.ann-item a.ann-ref')].find(link => link.textContent === '3')!;
    const seen: string[][] = [];
    Element.prototype.scrollIntoView = vi.fn(() => void seen.push(visible(root)));
    ref.click();
    expect(seen).toEqual([['3']]);
    const pageRef = [...root.querySelectorAll<HTMLAnchorElement>('.ann-item a.ann-page-ref')].find(link => link.textContent === 'p. 2')!;
    pageRef.click();
    expect(seen).toEqual([['3'], ['2']]);
    uninstall();
    stop();
  });

  it('tags a row past the end of the file and draws no marker for it', async () => {
    const { root, stop } = await ready([...ROWS, '- {#4 pin x=5% y=5% page=14} too far']);
    const item = [...root.querySelectorAll('.ann-item')].find(li => li.querySelector('.ann-ref')!.textContent === '4')!;
    expect(item.classList.contains('is-problem')).toBe(true);
    expect(item.querySelector('.ann-problem')!.textContent).toBe('Page 14 is past the end (3 pages)');
    expect(item.querySelector('a.ann-ref, a.ann-page-ref')).toBeNull();
    expect(root.querySelector('section.ann-p-14')).toBeNull();
    expect(root.querySelector('.ann-marker.ann-n-4')).toBeNull();
    expect(root.querySelectorAll('.ann-pager-chip')).toHaveLength(3);
    stop();
  });

  it('cancels the page being drawn when the page changes', async () => {
    const { root, renders, stop } = await ready();
    root.querySelector<HTMLButtonElement>('.ann-pager-chip:last-child')!.click();
    expect(renders[0].cancel).toHaveBeenCalled();
    stop();
  });

  it('gives the document back and restores the static figure when stopped', async () => {
    const { root, stop } = await ready();
    stop();
    expect(release).toHaveBeenCalledTimes(1);
    expect(root.querySelector('nav.ann-pager')).toBeNull();
    expect(root.querySelector('canvas')).toBeNull();
    expect(visible(root)).toEqual(['1', '2', '3']);
    expect(root.querySelector('.ann-figure')!.classList.contains('is-viewer')).toBe(false);
    const again = hydratePdfFigures(root, { t });
    await settle();
    expect(root.querySelectorAll('nav.ann-pager')).toHaveLength(1);
    again();
  });

  it('gives a document back that arrives after the figure was stopped', async () => {
    const { pdf } = fakePdf();
    let finish!: (handle: unknown) => void;
    acquire.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const root = mount(figureHtml(...ROWS));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    stop();
    finish({ pdf, release });
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(root.querySelector('nav.ann-pager')).toBeNull();
  });

  it('draws the page again, sharper, after a pinch-zoom, and not when the zoom did not change', async () => {
    const listeners = new Map<string, () => void>();
    const viewport = { scale: 1, addEventListener: (name: string, listener: () => void) => void listeners.set(name, listener), removeEventListener: vi.fn() };
    vi.stubGlobal('visualViewport', viewport);
    const { renders, stop } = await ready();
    expect(renders.map(render => render.pixelRatio)).toEqual([1]);
    listeners.get('resize')!();
    await new Promise(resolve => setTimeout(resolve, 320));
    expect(renders).toHaveLength(1);
    viewport.scale = 2.5;
    listeners.get('resize')!();
    await new Promise(resolve => setTimeout(resolve, 320));
    expect(renders.map(render => render.pixelRatio)).toEqual([1, 2.5]);
    stop();
    expect(viewport.removeEventListener).toHaveBeenCalledWith('resize', listeners.get('resize'));
    vi.unstubAllGlobals();
  });

  it('keeps the page across a redraw of the same figure', async () => {
    const first = await ready();
    first.root.querySelector<HTMLButtonElement>('.ann-pager-chip:last-child')!.click();
    first.stop();
    first.root.remove();
    const second = await ready();
    expect(visible(second.root)).toEqual(['3']);
    second.stop();
  });
});

describe('hydratePdfFigures: loading and errors', () => {
  it('says it is loading, with progress for a large file, until the document arrives', async () => {
    let finish!: (handle: unknown) => void;
    let progress!: (fraction: number, total: number) => void;
    acquire.mockImplementation((_url: string, onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    const root = mount(figureHtml(...ROWS));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(root.querySelector('.ann-pdf-status')!.textContent).toBe('Loading PDF…');
    progress(0.5, 10_000);
    expect(root.querySelector('.ann-pdf-status')!.textContent).toBe('Loading PDF…');
    progress(0.42, 4_000_000);
    expect(root.querySelector('.ann-pdf-status')!.textContent).toBe('Loading PDF… 42%');
    finish({ pdf: fakePdf().pdf, release });
    await settle();
    expect(root.querySelector('.ann-pdf-status')).toBeNull();
    stop();
  });

  it.each([['not-found', 'The PDF was not found.'], ['not-pdf', 'This file is not a PDF.'], ['password', 'This PDF is password-protected; annotate an unprotected copy.'], ['load-failed', 'The PDF could not be loaded.']])('replaces the stage with a %s box and keeps the list', async (code, text) => {
    acquire.mockRejectedValue(Object.assign(new Error(code), { code }));
    const root = mount(figureHtml(...ROWS));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(root.querySelector('.ann-error[role=alert]')!.textContent).toBe(text);
    expect(root.querySelector('.ann-pages')).toBeNull();
    expect(root.querySelectorAll('.ann-side .ann-item')).toHaveLength(3);
    stop();
  });

  it('adds the bucket CORS hint to a failed r2 file', async () => {
    acquire.mockRejectedValue(Object.assign(new Error('x'), { code: 'load-failed' }));
    const root = mount(figureHtml(...ROWS).replace('/raw-assets/a.pdf', '/r2-assets/a.pdf'));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(root.querySelector('.ann-error')!.textContent).toContain('CORS');
    stop();
  });

  it('reports a figure without an address as not found, without loading anything', async () => {
    const root = mount(figureHtml(...ROWS).replace(/ href="\/raw-assets\/a\.pdf"/, ''));
    const stop = hydratePdfFigures(root, { t });
    await settle();
    expect(acquire).not.toHaveBeenCalled();
    expect(root.querySelector('.ann-error')!.textContent).toBe('The PDF was not found.');
    stop();
  });
});
