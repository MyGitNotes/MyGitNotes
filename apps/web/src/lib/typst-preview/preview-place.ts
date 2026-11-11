/** Where a reader is in the pages: the page at the top of the view and how far down it, as a fraction of its height. */
export interface PreviewPlace {
  page: number;
  fraction: number;
}

export interface PageBox {
  top: number;
  height: number;
}

/** The place a scroll offset is at, given each page's box in order (page 1 first). */
export function readPlace(scrollTop: number, pages: PageBox[]): PreviewPlace | null {
  if (!pages.length) return null;
  let index = pages.findIndex(box => box.top + box.height > scrollTop);
  if (index === -1) index = pages.length - 1;
  const box = pages[index]!;
  return { page: index + 1, fraction: box.height > 0 ? Math.min(1, Math.max(0, (scrollTop - box.top) / box.height)) : 0 };
}

/** The scroll offset that puts a reader back at `place` in pages that may have other heights; a page that no longer exists gives the last one. */
export function placeScrollTop(place: PreviewPlace, pages: PageBox[]): number {
  const box = pages[Math.min(place.page, pages.length) - 1];
  return box ? Math.round(box.top + place.fraction * box.height) : 0;
}
