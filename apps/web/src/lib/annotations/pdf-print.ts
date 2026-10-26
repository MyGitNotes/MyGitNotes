/**
 * The print path of PDF annotation figures. The print frame runs no script, so each annotated page is drawn once here, at twice
 * the printed width, and put in its stage as a PNG `<img>` under the page's markers. A figure prints at most {@link MAX_PRINT_PAGES}
 * pages; past that it prints its list and a line saying the other pages were left out. Like the viewer, it imports pdf.js only
 * when the note holds a PDF figure.
 */

import type { TranslationKey } from '../i18n/en.js';
import type { Translate } from './pdf-figure.js';

export const MAX_PRINT_PAGES = 30;

/** The printed width of a page in CSS pixels: an A4 sheet less the margins. */
const PRINT_WIDTH = 680;
const PRINT_RATIO = 2;

const pageOf = (section: Element): number => Number(/(?:^|\s)ann-p-(\d+)(?=\s|$)/.exec(section.getAttribute('class') ?? '')?.[1]);

function note(root: Document, text: string): HTMLElement {
  const line = root.createElement('p');
  line.className = 'ann-print-omitted';
  line.textContent = text;
  return line;
}

async function printFigure(figure: Element, t: Translate): Promise<void> {
  const doc = figure.ownerDocument;
  const pages = figure.querySelector('.ann-pages');
  const url = figure.querySelector('a.ann-open')?.getAttribute('href');
  if (!pages) return;
  const fail = (code: string) => pages.replaceWith(note(doc, t(`imageAnnotation.pdf.error.${code}` as TranslationKey)));
  if (!url) return fail('not-found');
  let handle: Awaited<ReturnType<typeof import('../pdf/pdf-document.js')['sharedPdf']['acquire']>> | undefined;
  try {
    const { sharedPdf } = await import('../pdf/pdf-document.js');
    handle = await sharedPdf.acquire(url);
    const { pdf } = handle;
    const sections = [...pages.querySelectorAll('section.ann-page')].filter(section => pageOf(section) <= pdf.pageCount);
    for (const section of pages.querySelectorAll('section.ann-page')) if (!sections.includes(section)) section.remove();
    const printed = sections.slice(0, MAX_PRINT_PAGES);
    for (const section of sections.slice(MAX_PRINT_PAGES)) section.remove();
    for (const section of printed) {
      const page = pageOf(section);
      const canvas = document.createElement('canvas');
      await pdf.render(page, canvas, { cssWidth: PRINT_WIDTH, pixelRatio: PRINT_RATIO }).promise;
      const image = doc.createElement('img');
      image.setAttribute('src', canvas.toDataURL('image/png'));
      image.setAttribute('alt', t('imageAnnotation.pdf.pageCanvas', { page, count: pdf.pageCount, name: figure.getAttribute('aria-label') ?? '' }));
      section.querySelector('.ann-stage')?.prepend(image);
    }
    if (sections.length > MAX_PRINT_PAGES) pages.after(note(doc, t('imageAnnotation.pdf.printOmitted', { count: MAX_PRINT_PAGES })));
  } catch (error) {
    fail((error as { code?: string; }).code ?? 'load-failed');
  } finally {
    await handle?.release();
  }
}

/** Draws the annotated pages of every PDF figure under `root` as images. A note without a PDF figure does nothing. */
export async function renderPdfPageImages(root: ParentNode, t: Translate): Promise<void> {
  const figures = root.querySelectorAll('figure.ann-pdf');
  for (const figure of figures) await printFigure(figure, t);
}
