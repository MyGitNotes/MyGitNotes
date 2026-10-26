/**
 * The page viewer of a PDF annotation figure (`figure.ann-pdf`, see render.ts). The static HTML already lists every
 * annotated page; once the figure nears the viewport this turns it into a pager: one page at a time, drawn to a canvas
 * under the page's marker overlay by the document module. pdf.js is imported only here, on the first PDF figure, through
 * `../pdf/pdf-document.js`, so a note without a PDF figure never loads it. There is no text layer: a drag frames a
 * region, and "Open PDF" in the caption covers reading.
 */

import type { TranslationKey } from '../i18n/en.js';
import type { PdfDocument, PdfHandle, PdfRender } from '../pdf/pdf-document.js';
import { REVEAL_EVENT } from './linking.js';

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const NAMESPACE = 'imageAnnotation';
const PROGRESS_FROM_BYTES = 1_000_000;
const LOAD_MARGIN = '400px';
const ZOOM_REDRAW_MS = 250;
const REMEMBERED_FIGURES = 50;

/** The page each figure was last on, so a redraw of the note (new HTML, same figure) keeps it. */
const remembered = new Map<string, number>();

/** Forgets the pages figures were left on, so a test starts from a clean session. */
export function resetRememberedPages(): void {
  remembered.clear();
  shapes.clear();
}

/** The shape of each page last drawn, by address and page, so a figure that is hydrated again has its final height before the document is back. */
const shapes = new Map<string, string>();
const REMEMBERED_SHAPES = 200;

const noop = () => undefined;

type ErrorCode = 'not-found' | 'not-pdf' | 'password' | 'load-failed';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

const pageNumberOf = (node: Element): number | undefined => {
  const match = /(?:^|\s)ann-p-(\d+)(?=\s|$)/.exec(node.getAttribute('class') ?? '');
  return match ? Number(match[1]) : undefined;
};

class PdfFigure {
  private readonly name: string;
  private readonly url: string | null;
  private readonly key: string;
  private readonly pages: HTMLElement;
  private readonly main: HTMLElement;
  private readonly annotated: number[];
  private current: number;
  private count = 0;
  private handle: PdfHandle | undefined;
  private pdf: PdfDocument | undefined;
  private render: PdfRender | undefined;
  /** Counts the draws; one that finds a newer number after an await gives up. */
  private drawId = 0;
  private drawn = new WeakMap<Element, string>();
  private stopped = false;
  private pager: { status: HTMLElement; previous: HTMLButtonElement; next: HTMLButtonElement; input: HTMLInputElement; live: HTMLElement; chips: Map<number, HTMLButtonElement>; } | undefined;
  private status: HTMLElement | undefined;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly figure: HTMLElement, private readonly t: Translate, private readonly onSettled?: () => void) {
    this.name = figure.getAttribute('aria-label') ?? '';
    const open = figure.querySelector<HTMLAnchorElement>('a.ann-open');
    this.url = open?.getAttribute('href') ?? null;
    this.key = `${this.url}|${this.name}`;
    this.pages = figure.querySelector<HTMLElement>('.ann-pages')!;
    this.main = element('div', 'ann-main');
    this.annotated = [...this.pages.querySelectorAll('section.ann-page')].map(section => pageNumberOf(section)).filter((page): page is number => page !== undefined);
    const firstOpen = [...this.pages.querySelectorAll('section.ann-page:not(.is-resolved-only)')].map(section => pageNumberOf(section)).find(page => page !== undefined);
    this.current = remembered.get(this.key) ?? firstOpen ?? 1;
  }

  private label(key: string, params: Record<string, string | number> = {}): string {
    return this.t(`${NAMESPACE}.pdf.${key}` as TranslationKey, params);
  }

  /** Turns the static figure into a viewer and starts loading when it nears the viewport. Returns the function that undoes it. */
  start(): () => void {
    this.figure.classList.add('is-viewer');
    this.pages.replaceWith(this.main);
    this.status = element('p', 'ann-pdf-status', { role: 'status' });
    this.status.textContent = this.label('loading');
    this.main.append(this.status, this.pages);
    this.showOnly(this.current);
    for (const section of this.pages.querySelectorAll<HTMLElement>('section.ann-page')) {
      const shape = shapes.get(`${this.url}|${pageNumberOf(section)}`);
      if (shape) section.querySelector<HTMLElement>('.ann-stage')?.style.setProperty('aspect-ratio', shape);
    }
    this.figure.addEventListener(REVEAL_EVENT, this.onReveal);
    this.cleanups.push(() => this.figure.removeEventListener(REVEAL_EVENT, this.onReveal));
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        void this.load();
      }, { rootMargin: LOAD_MARGIN });
      observer.observe(this.figure);
      this.cleanups.push(() => observer.disconnect());
    } else {
      void this.load();
    }
    return () => this.stop();
  }

  /** Gives the document back and returns the figure to its static shape, so a figure that is hydrated again starts clean. */
  private stop(): void {
    this.stopped = true;
    this.cancelRender();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    void this.handle?.release();
    this.handle = undefined;
    this.pager?.status.closest('nav')?.remove();
    this.status?.remove();
    for (const canvas of this.pages.querySelectorAll('canvas')) canvas.remove();
    for (const extra of this.pages.querySelectorAll('section.is-extra')) extra.remove();
    for (const section of this.pages.querySelectorAll<HTMLElement>('section.ann-page')) {
      section.hidden = false;
      section.querySelector<HTMLElement>('.ann-stage')?.style.removeProperty('aspect-ratio');
    }
    this.main.replaceWith(this.pages);
    this.figure.classList.remove('is-viewer');
  }

  private async load(): Promise<void> {
    if (this.stopped) return;
    if (!this.url) return this.fail('not-found');
    try {
      const { sharedPdf } = await import('../pdf/pdf-document.js');
      const handle = await sharedPdf.acquire(this.url, (fraction, total) => {
        if (this.status && total >= PROGRESS_FROM_BYTES) this.status.textContent = this.label('progress', { percent: Math.round(fraction * 100) });
      });
      if (this.stopped) {
        void handle.release();
        return;
      }
      this.handle = handle;
      this.ready(handle.pdf);
    } catch (error) {
      if (!this.stopped) this.fail((error as { code?: ErrorCode; }).code ?? 'load-failed');
    }
  }

  private fail(code: ErrorCode): void {
    this.status = undefined;
    const r2 = this.url?.startsWith('/r2-assets/') ?? false;
    const key = code === 'load-failed' && r2 ? 'error.load-failed-r2' : `error.${code}`;
    const box = element('div', 'ann-error ann-pdf-error', { role: 'alert' });
    const message = element('p', 'ann-error-message');
    message.textContent = this.label(key);
    box.append(message);
    this.main.replaceChildren(box);
    this.onSettled?.();
  }

  private ready(pdf: PdfDocument): void {
    this.pdf = pdf;
    this.count = pdf.pageCount;
    this.status?.remove();
    this.status = undefined;
    this.markPagesBeyondEnd();
    this.current = Math.min(Math.max(1, this.current), this.count);
    this.buildPager();
    this.main.prepend(this.pager!.status.closest('nav')!);
    this.main.addEventListener('keydown', this.onKey);
    this.cleanups.push(() => this.main.removeEventListener('keydown', this.onKey));
    this.observeSize();
    this.show(this.current, false);
  }

  /** A row naming a page past the file's end keeps its list item with a problem tag, and loses its marker. */
  private markPagesBeyondEnd(): void {
    for (const reference of this.figure.querySelectorAll<HTMLAnchorElement>('.ann-side a.ann-page-ref')) {
      const page = Number(/-p(\d+)$/.exec(reference.getAttribute('href') ?? '')?.[1]);
      if (!page || page <= this.count) continue;
      const item = reference.closest('li.ann-item');
      if (!item) continue;
      if (item.classList.contains('is-beyond-end')) continue;
      item.classList.add('is-problem', 'is-beyond-end');
      const problem = element('span', 'ann-problem');
      problem.textContent = this.t(`${NAMESPACE}.render.problem.page-beyond-end` as TranslationKey, { detail: page, count: this.count });
      const kind = item.querySelector('.ann-kind');
      if (kind) kind.before(problem);
      else item.append(problem);
      for (const link of [reference, item.querySelector<HTMLAnchorElement>('a.ann-ref')]) {
        if (!link) continue;
        const plain = element('span', link.className);
        plain.textContent = link.textContent;
        link.replaceWith(plain);
      }
    }
    const beyond = Array.from(this.pages.querySelectorAll('section.ann-page')).filter(section => (pageNumberOf(section) ?? 0) > this.count);
    for (const section of beyond) {
      section.remove();
      this.annotated.splice(this.annotated.indexOf(pageNumberOf(section)!), 1);
    }
  }

  private buildPager(): void {
    const nav = element('nav', 'ann-pager', { 'aria-label': this.label('pager', { name: this.name }) });
    const previous = element('button', 'ann-pager-button', { type: 'button', 'aria-label': this.label('previousPage'), title: this.label('previousPage') });
    previous.textContent = '‹';
    const next = element('button', 'ann-pager-button', { type: 'button', 'aria-label': this.label('nextPage'), title: this.label('nextPage') });
    next.textContent = '›';
    const status = element('span', 'ann-pager-status');
    const go = element('label', 'ann-pager-go');
    const input = element('input', 'ann-pager-input', { type: 'number', min: '1', max: String(this.count), inputmode: 'numeric', 'aria-label': this.label('goToPage') });
    go.append(input);
    const chips = new Map<number, HTMLButtonElement>();
    const chipList = element('div', 'ann-pager-chips');
    for (const page of this.annotated) {
      const section = this.pages.querySelector(`section.ann-p-${page}`)!;
      const markers = section.querySelectorAll('.ann-marker').length;
      const chip = element('button', 'ann-pager-chip', { type: 'button' });
      chip.textContent = this.label(section.classList.contains('is-resolved-only') ? 'annotatedPageResolved' : 'annotatedPage', { page, count: markers });
      chip.addEventListener('click', () => this.show(page));
      chips.set(page, chip);
      chipList.append(chip);
    }
    const live = element('span', 'ann-visually-hidden', { 'aria-live': 'polite' });
    previous.addEventListener('click', () => this.show(this.current - 1));
    next.addEventListener('click', () => this.show(this.current + 1));
    const goTo = () => {
      const page = Math.trunc(Number(input.value));
      if (Number.isFinite(page) && page >= 1) this.show(page);
      else input.value = String(this.current);
    };
    input.addEventListener('change', goTo);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        goTo();
      }
    });
    nav.append(previous, status, next, go, chipList, live);
    this.pager = { status, previous, next, input, live, chips };
  }

  private onReveal = (event: Event): void => {
    const page = this.pageOf(event.target as Element);
    if (page !== undefined && this.pdf) this.show(page);
    else if (page !== undefined) this.showOnly(page);
  };

  /** The page a jump target belongs to: its own section, or the page its list item names. */
  private pageOf(target: Element): number | undefined {
    const section = target.closest('section.ann-page');
    if (section) return pageNumberOf(section);
    const reference = target.closest('li.ann-item')?.querySelector('a.ann-page-ref');
    const match = /-p(\d+)$/.exec(reference?.getAttribute('href') ?? '');
    return match ? Number(match[1]) : undefined;
  }

  private onKey = (event: KeyboardEvent): void => {
    const target = event.target as Element;
    if (!target.closest('.ann-stage') || event.altKey || event.ctrlKey || event.metaKey) return;
    const page = event.key === 'PageUp' ? this.current - 1 : event.key === 'PageDown' ? this.current + 1 : event.key === 'Home' ? 1 : event.key === 'End' ? this.count : undefined;
    if (page === undefined) return;
    event.preventDefault();
    this.show(page);
    this.pages.querySelector<HTMLElement>(`section.ann-p-${this.current} .ann-stage`)?.focus({ preventScroll: true });
  };

  /** The section of `page`, made on first visit for a page that carries no annotation. */
  private sectionOf(page: number): HTMLElement {
    const existing = this.pages.querySelector<HTMLElement>(`section.ann-p-${page}`);
    if (existing) return existing;
    const section = element('section', `ann-page ann-p-${page} is-extra`, { 'aria-label': this.t(`${NAMESPACE}.render.page` as TranslationKey, { page }) });
    const stage = element('div', 'ann-stage');
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.setAttribute('class', 'ann-overlay');
    stage.append(overlay);
    section.append(stage);
    const after = [...this.pages.querySelectorAll('section.ann-page')].find(other => (pageNumberOf(other) ?? 0) > page);
    if (after) after.before(section);
    else this.pages.append(section);
    return section;
  }

  private showOnly(page: number): void {
    for (const section of this.pages.querySelectorAll<HTMLElement>('section.ann-page')) section.hidden = pageNumberOf(section) !== page;
  }

  private show(requested: number, announce = true): void {
    const page = this.pdf ? Math.min(Math.max(1, requested), this.count) : requested;
    this.sectionOf(page);
    const changed = page !== this.current;
    this.current = page;
    this.cancelRender();
    this.showOnly(page);
    for (const section of this.pages.querySelectorAll<HTMLElement>('section.ann-page')) {
      if (section.hidden) section.querySelector('canvas')?.remove();
      const stage = section.querySelector<HTMLElement>('.ann-stage');
      if (stage) stage.tabIndex = section.hidden ? -1 : 0;
    }
    remembered.delete(this.key);
    remembered.set(this.key, page);
    if (remembered.size > REMEMBERED_FIGURES) remembered.delete(remembered.keys().next().value!);
    this.updatePager(announce && changed);
    void this.draw(true);
  }

  private updatePager(announce: boolean): void {
    if (!this.pager) return;
    const { status, previous, next, input, live, chips } = this.pager;
    const text = this.label('pageOf', { page: this.current, count: this.count });
    status.textContent = text;
    previous.disabled = this.current <= 1;
    next.disabled = this.current >= this.count;
    input.value = String(this.current);
    for (const [page, chip] of chips) {
      if (page === this.current) chip.setAttribute('aria-current', 'page');
      else chip.removeAttribute('aria-current');
    }
    if (announce) live.textContent = this.label('pageChanged', { page: this.current, count: this.count });
  }

  /** Cancels the render in progress and forgets it, so its canvas is never swapped in. */
  private cancelRender(): void {
    this.drawId++;
    this.render?.cancel();
    this.render = undefined;
  }

  private pixelRatio(): number {
    const zoom = typeof visualViewport === 'undefined' || !visualViewport ? 1 : Math.max(1, visualViewport.scale);
    return (window.devicePixelRatio || 1) * zoom;
  }

  /** Draws the current page into a new canvas and swaps it in when done, so the page never flashes blank. */
  private async draw(force: boolean): Promise<void> {
    const pdf = this.pdf;
    if (!pdf || this.stopped) return;
    const page = this.current;
    const stage = this.pages.querySelector<HTMLElement>(`section.ann-p-${page} .ann-stage`);
    if (!stage) return;
    const cssWidth = stage.clientWidth;
    if (!cssWidth) return;
    const pixelRatio = this.pixelRatio();
    const signature = `${page}:${cssWidth}:${pixelRatio}`;
    if (!force && this.drawn.get(stage) === signature) return;
    this.cancelRender();
    const drawId = this.drawId;
    const canvas = element('canvas', 'ann-canvas', { role: 'img', 'aria-label': this.label('pageCanvas', { page, count: this.count, name: this.name }) });
    let render: PdfRender;
    try {
      const size = await pdf.pageSize(page);
      if (this.stopped || drawId !== this.drawId) return;
      const shape = `${size.width} / ${size.height}`;
      stage.style.aspectRatio = shape;
      shapes.delete(`${this.url}|${page}`);
      shapes.set(`${this.url}|${page}`, shape);
      if (shapes.size > REMEMBERED_SHAPES) shapes.delete(shapes.keys().next().value!);
      this.onSettled?.();
      render = pdf.render(page, canvas, { cssWidth, pixelRatio });
      this.render = render;
      await render.promise;
    } catch {
      if (!this.stopped && drawId === this.drawId) this.fail('load-failed');
      return;
    }
    if (this.stopped || drawId !== this.drawId || this.render !== render) return;
    stage.querySelector('canvas')?.remove();
    stage.prepend(canvas);
    this.drawn.set(stage, signature);
    this.onSettled?.();
  }

  /** Redraws on a width change and, after a pinch-zoom on a phone, sharper. */
  private observeSize(): void {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void this.draw(false));
    };
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(redraw);
      observer.observe(this.pages);
      this.cleanups.push(() => observer.disconnect());
    }
    const zoomed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.draw(false), ZOOM_REDRAW_MS);
    };
    if (typeof visualViewport !== 'undefined' && visualViewport) {
      visualViewport.addEventListener('resize', zoomed);
      this.cleanups.push(() => visualViewport!.removeEventListener('resize', zoomed));
    }
    this.cleanups.push(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    });
  }
}

/**
 * Turns the PDF figures under `root` into page viewers and loads each PDF when its figure nears the viewport. A note
 * without a PDF figure does nothing here, and does not load pdf.js. Returns the function that stops the viewers and gives
 * their documents back.
 */
export function hydratePdfFigures(root: ParentNode, options: { t: Translate; /** Called when a figure's size may have changed (the editor re-measures its widget). */ onSettled?: () => void; }): () => void {
  const figures = [...root.querySelectorAll<HTMLElement>('figure.ann-pdf')].filter(figure => !figure.classList.contains('is-viewer') && figure.querySelector('.ann-pages'));
  if (!figures.length) return noop;
  const stops = figures.map(figure => new PdfFigure(figure, options.t, options.onSettled).start());
  return () => stops.forEach(stop => stop());
}
