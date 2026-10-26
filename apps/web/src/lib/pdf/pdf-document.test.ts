// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_DESTROY_MS, IDLE_DOCUMENTS, openPdfBytes, PdfLoadError, sharedPdf } from './pdf-document.js';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../annotations/fixtures/pdf/${name}.pdf`, import.meta.url)));
const codeOf = async (promise: Promise<unknown>) => (await promise.catch((error: unknown) => error) as PdfLoadError).code;

describe('openPdfBytes: real files', () => {
  it("reports the page count and every page's size as pdf.js displays it", async () => {
    const pdf = await openPdfBytes(fixture('multi-page'));
    expect(pdf.pageCount).toBe(4);
    expect(await pdf.pageSize(1)).toEqual({ width: 612, height: 792 });
    expect(await pdf.pageSize(2)).toEqual({ width: 842, height: 595 });
    await pdf.destroy();
  });

  it("applies the page's own /Rotate, so a rotated portrait page reads as landscape", async () => {
    const pdf = await openPdfBytes(fixture('multi-page'));
    expect(await pdf.pageSize(3)).toEqual({ width: 600, height: 400 });
    await pdf.destroy();
  });

  it('opens a page of Chinese text set in a font that is not embedded', async () => {
    const pdf = await openPdfBytes(fixture('multi-page'));
    expect(await pdf.pageSize(4)).toEqual({ width: 612, height: 792 });
    await pdf.destroy();
  });

  it('rejects a page outside the document', async () => {
    const pdf = await openPdfBytes(fixture('multi-page'));
    await expect(pdf.pageSize(5)).rejects.toThrow(RangeError);
    await expect(pdf.pageSize(0)).rejects.toThrow(RangeError);
    await pdf.destroy();
  });

  it('names a password-protected file', async () => {
    expect(await codeOf(openPdfBytes(fixture('encrypted')))).toBe('password');
  });

  it('names a file that is not a PDF', async () => {
    expect(await codeOf(openPdfBytes(fixture('not-a-pdf')))).toBe('not-pdf');
  });

  it('names a truncated file as a load failure or a broken PDF, never as success', async () => {
    expect(['not-pdf', 'load-failed']).toContain(await codeOf(openPdfBytes(fixture('truncated'))));
  });
});

describe('sharedPdf: one document per address', () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await sharedPdf.flush();
  });

  it('loads an address once for two holders and destroys it after the last one let go and the idle time passed', async () => {
    vi.useFakeTimers();
    const bytes = fixture('multi-page');
    const fetched = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    const a = await sharedPdf.acquire('/raw-assets/shared.pdf');
    const b = await sharedPdf.acquire('/raw-assets/shared.pdf');
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(a.pdf).toBe(b.pdf);
    const destroy = vi.spyOn(a.pdf, 'destroy');
    await a.release();
    await vi.advanceTimersByTimeAsync(IDLE_DESTROY_MS * 2);
    expect(destroy).not.toHaveBeenCalled();
    await b.release();
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDLE_DESTROY_MS - 1);
    expect(destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    await b.release();
    await vi.advanceTimersByTimeAsync(IDLE_DESTROY_MS);
    expect(destroy).toHaveBeenCalledTimes(1);
    const again = await sharedPdf.acquire('/raw-assets/shared.pdf');
    expect(fetched).toHaveBeenCalledTimes(2);
    await again.release();
    await vi.advanceTimersByTimeAsync(IDLE_DESTROY_MS);
    vi.unstubAllGlobals();
  });

  it('hands the same document to the next holder of an address released in the same turn, without fetching again', async () => {
    const bytes = fixture('multi-page');
    const fetched = vi.fn(async () => new Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    const a = await sharedPdf.acquire('/raw-assets/redraw.pdf');
    const destroy = vi.spyOn(a.pdf, 'destroy');
    void a.release(); // what a figure does when the note's HTML changes or its widget redraws
    const b = await sharedPdf.acquire('/raw-assets/redraw.pdf');
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(b.pdf).toBe(a.pdf);
    expect(destroy).not.toHaveBeenCalled();
    await b.release();
    await sharedPdf.flush();
    expect(destroy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('keeps only a few released documents and destroys the one released longest ago first', async () => {
    const bytes = fixture('multi-page');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, { status: 200 })));
    const handles = [];
    for (let i = 0; i <= IDLE_DOCUMENTS; i++) handles.push(await sharedPdf.acquire(`/raw-assets/lru-${i}.pdf`));
    const destroys = handles.map(handle => vi.spyOn(handle.pdf, 'destroy'));
    for (const handle of handles) await handle.release();
    expect(destroys[0]).toHaveBeenCalledTimes(1);
    for (const destroy of destroys.slice(1)) expect(destroy).not.toHaveBeenCalled();
    await sharedPdf.flush();
    for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('maps a 404 to not-found and any other failure to load-failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await codeOf(sharedPdf.acquire('/raw-assets/missing.pdf'))).toBe('not-found');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    expect(await codeOf(sharedPdf.acquire('/raw-assets/broken.pdf'))).toBe('load-failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    expect(await codeOf(sharedPdf.acquire('/raw-assets/offline.pdf'))).toBe('load-failed');
    vi.unstubAllGlobals();
  });

  it('forgets a failed address, so the next holder tries again', async () => {
    const fetched = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetched);
    await codeOf(sharedPdf.acquire('/raw-assets/flaky.pdf'));
    await codeOf(sharedPdf.acquire('/raw-assets/flaky.pdf'));
    expect(fetched).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
