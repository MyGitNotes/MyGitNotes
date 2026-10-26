/**
 * The only module that imports pdf.js. Everything else talks to the small interface below (open, page count, page size,
 * draw a page into a canvas, a typed {@link PdfLoadError}), so pdf.js stays replaceable and tests can fake it. pdf.js and its
 * worker are loaded on the first open, never with the app bundle. The legacy build is used because the modern one calls
 * `Map.prototype.getOrInsertComputed`, `Math.sumPrecise` and `Uint8Array.fromBase64` without fallbacks, which older iOS
 * Safari lacks.
 */

import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfErrorCode = 'not-found' | 'not-pdf' | 'password' | 'load-failed';

export class PdfLoadError extends Error {
  constructor(readonly code: PdfErrorCode, message: string = code) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

export interface PdfPageSize {
  /** The page as pdf.js displays it at scale 1: the CropBox with the page's own /Rotate applied. */
  width: number;
  height: number;
}

export interface PdfRender {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfDocument {
  readonly pageCount: number;
  pageSize(page: number): Promise<PdfPageSize>;
  /** Draws `page` into `canvas`, sizing the canvas to `cssWidth` times `pixelRatio` (reduced to stay under {@link MAX_CANVAS_PIXELS}). */
  render(page: number, canvas: HTMLCanvasElement, options: { cssWidth: number; pixelRatio: number; }): PdfRender;
  destroy(): Promise<void>;
}

/** Past this many pixels a canvas is drawn at a lower resolution. */
export const MAX_CANVAS_PIXELS = 16_700_000;

type Library = typeof PdfJs;

let library: Promise<Library> | undefined;
let worker: PdfJs.PDFWorker | undefined;

/** One PDFWorker serves the page: every document is opened on it, so a second PDF does not start a second worker thread. */
function sharedWorker(lib: Library): PdfJs.PDFWorker {
  if (!worker || worker.destroyed) worker = new lib.PDFWorker();
  return worker;
}

function loadLibrary(): Promise<Library> {
  library ??= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.min.mjs') as unknown as Library;
    // Node (the tests) runs the worker's code in-process from its own folder; a browser loads the worker file as a module worker.
    if (typeof window !== 'undefined') lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    return lib;
  })();
  library.catch(() => {
    library = undefined;
  });
  return library;
}

function codeOf(error: unknown): PdfErrorCode {
  switch ((error as { name?: string; })?.name) {
    case 'InvalidPDFException':
      return 'not-pdf';
    case 'PasswordException':
      return 'password';
    case 'MissingPDFException':
      return 'not-found';
    default:
      return 'load-failed';
  }
}

/** The fixed font, cmap, icc profile and wasm folders the build copies next to the app (see `pwa/pdf-assets-plugin.ts`). */
function dataUrls(lib: Library): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const base = `${import.meta.env.BASE_URL}pdfjs/${lib.version}/`;
  return { cMapUrl: `${base}cmaps/`, cMapPacked: true as unknown as string, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/` };
}

class Document implements PdfDocument {
  private readonly sizes = new Map<number, Promise<PdfPageSize>>();

  constructor(private readonly proxy: PdfJs.PDFDocumentProxy, private readonly loading: PdfJs.PDFDocumentLoadingTask) {}

  get pageCount(): number {
    return this.proxy.numPages;
  }

  pageSize(page: number): Promise<PdfPageSize> {
    if (!Number.isInteger(page) || page < 1 || page > this.pageCount) return Promise.reject(new RangeError(`no page ${page} in a document of ${this.pageCount} pages`));
    let size = this.sizes.get(page);
    if (!size) {
      size = this.proxy.getPage(page).then(item => {
        const { width, height } = item.getViewport({ scale: 1 });
        return { width, height };
      });
      this.sizes.set(page, size);
    }
    return size;
  }

  render(page: number, canvas: HTMLCanvasElement, { cssWidth, pixelRatio }: { cssWidth: number; pixelRatio: number; }): PdfRender {
    let task: PdfJs.RenderTask | undefined;
    let cancelled = false;
    const promise = (async () => {
      const item = await this.proxy.getPage(page);
      if (cancelled) return;
      const base = item.getViewport({ scale: 1 });
      let scale = cssWidth / base.width * pixelRatio;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = item.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = item.render({ canvas, viewport });
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string; })?.name === 'RenderingCancelledException') return;
        throw error;
      }
    })();
    return {
      promise,
      cancel: () => {
        cancelled = true;
        task?.cancel();
      },
    };
  }

  async destroy(): Promise<void> {
    await this.loading.destroy();
  }
}

/** Opens a PDF from its bytes. Throws {@link PdfLoadError}. */
export async function openPdfBytes(bytes: Uint8Array): Promise<PdfDocument> {
  const lib = await loadLibrary().catch(() => {
    throw new PdfLoadError('load-failed', 'pdf.js could not be loaded');
  });
  try {
    const loading = lib.getDocument({ data: bytes, enableXfa: false, worker: sharedWorker(lib), ...dataUrls(lib) });
    return new Document(await loading.promise, loading);
  } catch (error) {
    throw new PdfLoadError(codeOf(error), (error as Error)?.message);
  }
}

async function fetchBytes(url: string, onProgress?: PdfProgress): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new PdfLoadError('load-failed');
  }
  if (response.status === 404) throw new PdfLoadError('not-found');
  if (!response.ok) throw new PdfLoadError('load-failed', `HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      if (total) onProgress?.(Math.min(1, received / total), total);
    }
  } catch {
    throw new PdfLoadError('load-failed');
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** Called as bytes arrive, with the fraction received and the file's total size in bytes. */
export type PdfProgress = (fraction: number, total: number) => void;

interface Entry {
  document: Promise<PdfDocument>;
  holders: number;
  listeners: Set<PdfProgress>;
  /** Set while nobody holds the document and it waits to be destroyed. */
  idleTimer?: ReturnType<typeof setTimeout>;
}

export interface PdfHandle {
  readonly pdf: PdfDocument;
  /** Gives the document back; it is destroyed once nobody has held it for {@link IDLE_DESTROY_MS}. Releasing twice counts once. */
  release(): Promise<void>;
}

/**
 * A document nobody holds is kept this long, so a redraw of the note (new HTML, the editor rebuilding a widget, Show resolved)
 * that releases a figure and acquires it again in the same turn reuses it instead of fetching and parsing the file again.
 */
export const IDLE_DESTROY_MS = 30_000;
/** At most this many released documents are kept; past it the one released longest ago is destroyed. */
export const IDLE_DOCUMENTS = 2;

const entries = new Map<string, Entry>();
/** Released documents, the one released longest ago first. */
const idle = new Map<string, Entry>();

async function destroyEntry(url: string, entry: Entry): Promise<void> {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = undefined;
  if (entries.get(url) === entry) entries.delete(url);
  if (idle.get(url) === entry) idle.delete(url);
  await entry.document.then(document => document.destroy(), () => undefined);
}

/** One {@link PdfDocument} per address, shared by every figure of the same PDF and counted by holders. */
export const sharedPdf = {
  async acquire(url: string, onProgress?: PdfProgress): Promise<PdfHandle> {
    let entry = entries.get(url);
    if (!entry) {
      const created: Entry = { holders: 0, listeners: new Set(), document: undefined as unknown as Promise<PdfDocument> };
      created.document = fetchBytes(url, (fraction, total) => created.listeners.forEach(listener => listener(fraction, total))).then(openPdfBytes);
      entries.set(url, created);
      entry = created;
    }
    const held = entry;
    clearTimeout(held.idleTimer);
    held.idleTimer = undefined;
    idle.delete(url);
    held.holders++;
    if (onProgress) held.listeners.add(onProgress);
    let released = false;
    const release = async (failed = false) => {
      if (released) return;
      released = true;
      if (onProgress) held.listeners.delete(onProgress);
      if (--held.holders > 0) return;
      if (failed) return destroyEntry(url, held);
      idle.set(url, held);
      held.idleTimer = setTimeout(() => void destroyEntry(url, held), IDLE_DESTROY_MS);
      (held.idleTimer as { unref?: () => void; }).unref?.();
      while (idle.size > IDLE_DOCUMENTS) {
        const [oldestUrl, oldest] = idle.entries().next().value!;
        void destroyEntry(oldestUrl, oldest);
      }
    };
    try {
      return { pdf: await held.document, release: () => release() };
    } catch (error) {
      await release(true);
      throw error;
    }
  },

  /** Destroys every document nobody holds right now, without waiting for the idle time. */
  async flush(): Promise<void> {
    await Promise.all([...idle].map(([url, entry]) => destroyEntry(url, entry)));
  },
};
