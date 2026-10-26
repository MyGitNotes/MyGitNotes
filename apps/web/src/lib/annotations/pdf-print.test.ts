// @vitest-environment jsdom
import { Marked } from 'marked';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en.js';
import { MAX_PRINT_PAGES, renderPdfPageImages } from './pdf-print.js';
import { renderAnnotate } from './render.js';

const { loaded, acquire } = vi.hoisted(() => ({ loaded: vi.fn(), acquire: vi.fn() }));
vi.mock('../pdf/pdf-document.js', () => {
  loaded();
  return { sharedPdf: { acquire } };
});

const marked = new Marked();
const renderMarkdown = (markdown: string) => marked.parse(markdown, { gfm: true, breaks: true }) as string;
const t = (key: keyof typeof en, params: Record<string, string | number> = {}) => en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
const printable = (rows: string[]) => {
  const doc = new DOMParser().parseFromString(renderAnnotate([':::annotate', '[a.pdf](/raw-assets/a.pdf)', '', ...rows, ':::'].join('\n'), { renderMarkdown, strings: en }), 'text/html');
  return doc.body;
};
const rowsOn = (pages: number[]) => pages.map((page, index) => `- {#${index + 1} pin x=1% y=1% page=${page}} c${page}`);

let release: ReturnType<typeof vi.fn>;
let render: ReturnType<typeof vi.fn>;

beforeEach(() => {
  loaded.mockClear();
  acquire.mockReset();
  release = vi.fn(async () => undefined);
  render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');
});

describe('renderPdfPageImages', () => {
  it('does nothing, and loads nothing, for a note without a PDF figure', async () => {
    const body = new DOMParser().parseFromString('<p>x</p><figure class="ann-figure"></figure>', 'text/html').body;
    await renderPdfPageImages(body, t);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('draws each annotated page once at twice the printed width and puts it in the stage as a PNG', async () => {
    acquire.mockResolvedValue({ pdf: { pageCount: 5, render }, release });
    const body = printable(rowsOn([1, 3]));
    await renderPdfPageImages(body, t);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls.map(call => call[0])).toEqual([1, 3]);
    expect(render.mock.calls[0][2]).toEqual({ cssWidth: 680, pixelRatio: 2 });
    const images = [...body.querySelectorAll('.ann-p-3 .ann-stage > img')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(images[0].getAttribute('alt')).toBe('Page 3 of 5 of a.pdf');
    expect(body.querySelector('.ann-p-3 .ann-stage')!.firstElementChild).toBe(images[0]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('prints 30 pages and says the rest were left out, keeping every comment', async () => {
    acquire.mockResolvedValue({ pdf: { pageCount: 60, render }, release });
    const pages = Array.from({ length: 33 }, (_, index) => index + 1);
    const body = printable(rowsOn(pages));
    await renderPdfPageImages(body, t);
    expect(MAX_PRINT_PAGES).toBe(30);
    expect(render).toHaveBeenCalledTimes(30);
    expect(body.querySelectorAll('section.ann-page')).toHaveLength(30);
    expect(body.querySelector('.ann-print-omitted')!.textContent).toBe('Only the first 30 annotated pages are printed; the comments are all listed.');
    expect(body.querySelectorAll('.ann-item')).toHaveLength(33);
  });

  it('leaves out pages past the end of the file', async () => {
    acquire.mockResolvedValue({ pdf: { pageCount: 2, render }, release });
    const body = printable(rowsOn([1, 9]));
    await renderPdfPageImages(body, t);
    expect(body.querySelector('section.ann-p-9')).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('prints the list and the reason when the file cannot be loaded', async () => {
    acquire.mockRejectedValue(Object.assign(new Error('x'), { code: 'password' }));
    const body = printable(rowsOn([1]));
    await renderPdfPageImages(body, t);
    expect(body.querySelector('.ann-pages')).toBeNull();
    expect(body.querySelector('.ann-print-omitted')!.textContent).toBe('This PDF is password-protected; annotate an unprotected copy.');
    expect(body.querySelectorAll('.ann-item')).toHaveLength(1);
  });
});
