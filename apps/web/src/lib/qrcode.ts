/**
 * The QR codes of a note: `:qrcode{url="…" size="200"}` in a line of text and `::qrcode{url="…"}` on a line of its own, as the blog writes
 * them. The renderer writes a link to the address inside a `data-qrcode` element, so the HTML stays plain and sanitize-safe; each surface
 * draws the code on a canvas once the HTML is mounted (see {@link hydrateQrCodes}), and the library loads with the first code drawn.
 */

export const QRCODE_SELECTOR = '[data-qrcode]';

/** The side of a code when a directive names none, in CSS pixels, as the blog draws it. */
export const DEFAULT_QRCODE_SIZE = 128;
const MIN_QRCODE_SIZE = 32;
const MAX_QRCODE_SIZE = 1024;

/** The side a directive's `size` asks for, whole CSS pixels; a value that is no number is the default, and a code is never smaller or larger than the limits. */
export function qrCodeSize(value: string | undefined): number {
  const size = /^\s*\d+(?:\.\d+)?\s*(?:px)?\s*$/i.test(value ?? '') ? Math.round(Number.parseFloat(value as string)) : DEFAULT_QRCODE_SIZE;
  return Math.min(MAX_QRCODE_SIZE, Math.max(MIN_QRCODE_SIZE, size));
}

/** The library loads once, with the first code drawn; every later draw waits on the same import, and a failed load is tried again. */
const importLibrary = () => import('qrcode');
let library: ReturnType<typeof importLibrary> | undefined;
const loadLibrary = () =>
  library ??= importLibrary().catch((error: unknown) => {
    library = undefined;
    throw error;
  });

async function drawQrCode(container: HTMLElement, cancelled: () => boolean, onSettled?: () => void): Promise<void> {
  const url = container.dataset.qrcode ?? '';
  if (!url || container.dataset.qrcodeRendered) return;
  let QRCode: Awaited<ReturnType<typeof importLibrary>>['default'];
  try {
    QRCode = (await loadLibrary()).default;
  } catch (error) {
    console.error('Failed to load the QR code library:', error);
    return;
  }
  if (cancelled() || container.dataset.qrcodeRendered) return;
  const size = qrCodeSize(container.dataset.size);
  const canvas = document.createElement('canvas');
  try {
    // The library's own black on white, with a margin of one module, as the blog draws it: a code on a dark page still scans.
    await QRCode.toCanvas(canvas, url, { width: size, margin: 1 });
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    return;
  }
  if (cancelled() || container.dataset.qrcodeRendered) return;
  // The code sits inside the link, so it opens the address, and the text stays for a reader who cannot see the code.
  canvas.className = 'qrcode-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  (container.querySelector('a') ?? container).prepend(canvas);
  container.dataset.qrcodeRendered = 'true';
  onSettled?.();
}

/** Draws every QR code under `root`; `onSettled` runs after each, so a host can re-measure its layout. The returned function stops a draw that has not finished. */
export function hydrateQrCodes(root: ParentNode, options: { onSettled?: () => void; } = {}): () => void {
  if (!root.querySelector(QRCODE_SELECTOR)) return () => undefined;
  const containers = [...root.querySelectorAll<HTMLElement>(`${QRCODE_SELECTOR}:not([data-qrcode-rendered])`)].filter(container => container.dataset.qrcode);
  if (!containers.length) return () => undefined;
  let stopped = false;
  for (const container of containers) void drawQrCode(container, () => stopped, options.onSettled);
  return () => {
    stopped = true;
  };
}
