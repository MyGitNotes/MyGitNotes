import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { PdfDocument, PdfPageSize } from '../../lib/pdf/pdf-document.js';
import { type PageBox, placeScrollTop, type PreviewPlace, readPlace } from '../../lib/typst-preview/preview-place.js';

/** One compiled revision ready to show: its open document, each page's size, and the pages already drawn for the place it opens at. */
export interface PreviewView {
  revision: string;
  document: PdfDocument;
  sizes: PdfPageSize[];
  drawn: Map<number, HTMLCanvasElement>;
  /** The CSS width `drawn` was drawn for. */
  drawnWidth: number;
  /** Where the reader was in the revision this one replaces. */
  place: PreviewPlace | null;
}

export interface PreviewPagesHandle {
  place(): PreviewPlace | null;
}

/** How far outside the view a page starts drawing. */
const DRAW_MARGIN = '600px 0px';

/** Draws one page at the dock's width and the screen's pixel ratio. */
export function drawPage(document: PdfDocument, page: number, cssWidth: number): { canvas: HTMLCanvasElement; done: Promise<void>; cancel: () => void; } {
  const canvas = window.document.createElement('canvas');
  const render = document.render(page, canvas, { cssWidth, pixelRatio: window.devicePixelRatio || 1 });
  return { canvas, done: render.promise, cancel: render.cancel };
}

/**
 * The pages of one revision in a scrolling column. A page is drawn when it comes near the view; the pages around the
 * reader's place arrive drawn, and the scroll offset is set to that place before the browser paints, so a new revision
 * replaces the old one without a jump or a blank page.
 */
export const PreviewPages = forwardRef<PreviewPagesHandle, { view: PreviewView; width: number; stale: boolean; pageLabel: (page: number) => string; }>(({ view, width, stale, pageLabel }, ref) => {
  const scroller = useRef<HTMLDivElement>(null);
  const drawnAt = useRef(new Map<number, number>());
  const pageElements = () => [...scroller.current?.querySelectorAll<HTMLElement>('.typst-preview-page') ?? []];
  const boxes = (): PageBox[] => pageElements().map(element => ({ top: element.offsetTop, height: element.offsetHeight }));
  useImperativeHandle(ref, () => ({ place: () => scroller.current ? readPlace(scroller.current.scrollTop, boxes()) : null }));
  useLayoutEffect(() => {
    drawnAt.current = new Map();
    for (const element of pageElements()) {
      const page = Number(element.dataset.page), canvas = view.drawn.get(page);
      if (!canvas) continue;
      element.replaceChildren(canvas);
      drawnAt.current.set(page, view.drawnWidth);
    }
    if (view.place && scroller.current) scroller.current.scrollTop = placeScrollTop(view.place, boxes());
  }, [view]);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !scroller.current) return;
    const cancels = new Set<() => void>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement, page = Number(element.dataset.page);
        if (!entry.isIntersecting || drawnAt.current.get(page) === width) continue;
        drawnAt.current.set(page, width);
        const drawing = drawPage(view.document, page, width);
        cancels.add(drawing.cancel);
        // The new canvas replaces the old one only once it is drawn, so a redraw at another width never blanks the page.
        void drawing.done.then(() => {
          if (cancels.delete(drawing.cancel)) element.replaceChildren(drawing.canvas);
        }, () => {
          cancels.delete(drawing.cancel);
          drawnAt.current.delete(page);
        });
      }
    }, { root: scroller.current, rootMargin: DRAW_MARGIN });
    for (const element of pageElements()) observer.observe(element);
    return () => {
      observer.disconnect();
      for (const cancel of cancels) cancel();
      cancels.clear();
    };
  }, [view, width]);
  return <div ref={scroller} className='typst-preview-pages' data-stale={stale || undefined}>{view.sizes.map((size, index) => <div key={`${view.revision}:${index + 1}`} className='typst-preview-page' data-page={index + 1} role='img' aria-label={pageLabel(index + 1)} style={{ aspectRatio: `${size.width} / ${size.height}` }} />)}</div>;
});
PreviewPages.displayName = 'PreviewPages';
