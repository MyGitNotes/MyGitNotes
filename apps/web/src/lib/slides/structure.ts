/**
 * The slide structure a note's separators give it: which slide and which page ends at each `---` and `::vertical`, and which parts of a
 * `:::build` are its steps. This is the one place the editor's and the preview's labels come from.
 *
 * contour-deck's `rehypeDeck` is what builds the deck; this module only reads the same structure off the source or the preview, by the
 * rules of contour-deck 0.2.2 (`docs/PLUGINS.md`, "Slides and pages" and "Steps"), and `structure.test.ts` holds it to `rehypeDeck` on the
 * fixture decks. Another way to structure a deck (headings as separators) is another reading here, beside {@link SlideStructureReader}.
 */
import type { TranslationKey } from '../i18n/en.js';

/** `---` (any thematic break at the top level) or `::vertical`. */
export type SlideBreak = 'slide' | 'page';

/** What ends at a separator, or at the end of the note: page `page` of slide `slide`, and with it the slide when `endsSlide`. */
export interface SeparatorLabel {
  slide: number;
  page: number;
  endsSlide: boolean;
}

interface Chunk {
  content: boolean;
  heading?: string;
  starts: boolean;
}

/**
 * Reads a slide note from top to bottom: tell it what stands between the separators, and each separator, in document order;
 * {@link SlideStructureReader.labels} then says what ends at each separator and at the end of the note.
 */
export class SlideStructureReader {
  private chunks: Chunk[] = [{ content: false, starts: false }];
  private breaks: SlideBreak[] = [];

  private get chunk(): Chunk {
    return this.chunks[this.chunks.length - 1];
  }

  /** Anything a slide shows; `heading` is the text of a second-level heading it holds. */
  content(heading?: string): void {
    this.chunk.content = true;
    if (heading !== undefined) this.chunk.heading ??= heading.replace(/\s+/g, ' ').trim();
  }

  /** A `::block` or a `::slide`: what follows starts a slide. */
  starts(): void {
    this.chunk.starts = true;
  }

  /** A separator; returns its index among the separators. */
  break(kind: SlideBreak): number {
    this.breaks.push(kind);
    this.chunks.push({ content: false, starts: false });
    return this.breaks.length - 1;
  }

  /**
   * One label per separator, then one for the end of the note; none where nothing ends (no content since the separator before).
   * A `---` always starts a slide. Between two `---`, what follows a `::vertical` is a further page of the slide, unless it starts a
   * slide of its own: it carries `::block` or `::slide`, follows a `::block` that stood alone, or has a second-level heading that differs
   * from the slide's own.
   */
  labels(): (SeparatorLabel | undefined)[] {
    const positions: ({ slide: number; page: number; } | undefined)[] = [];
    let slide = 0, page = 0;
    // The second-level heading of the current slide, while a slide is open between two `---`.
    let current: { heading?: string; } | undefined;
    // A `::block` that stood alone applies to the next slide.
    let pending = false;
    this.chunks.forEach((chunk, index) => {
      if (index > 0 && this.breaks[index - 1] === 'slide') current = undefined;
      if (!chunk.content) {
        pending ||= chunk.starts;
        positions.push(undefined);
        return;
      }
      if (!current || chunk.starts || pending || (chunk.heading !== undefined && chunk.heading !== current.heading)) {
        slide += 1;
        page = 1;
        current = { heading: chunk.heading };
      } else page += 1;
      pending = false;
      positions.push({ slide, page });
    });
    return positions.map((position, index) => {
      if (!position) return undefined;
      const next = positions.slice(index + 1).find(Boolean);
      return { ...position, endsSlide: !next || next.slide !== position.slide };
    });
  }
}

/** Fills the placeholders of a label's wording, in the language of whoever reads it. */
export type SlideLabelWording = (key: 'slides.slideLabel' | 'slides.pageLabel', params: Record<string, number>) => string;

/** A separator's label as the reader sees it: `Slide 3` where a slide ends, `Page 3.1` where only a page of it does. */
export function separatorLabelText(label: SeparatorLabel, wording: SlideLabelWording): string {
  return wording(label.endsSlide ? 'slides.slideLabel' : 'slides.pageLabel', { slide: label.slide, page: label.page });
}

/**
 * The parts of a `:::build` a deck reveals one at a time: the items of a list, the body rows of a table, and any other block as a whole.
 * `build` is the element the preview draws for the directive.
 */
export function buildSteps(build: Element): Element[] {
  const steps: Element[] = [];
  for (const child of build.children) {
    if (child.tagName === 'UL' || child.tagName === 'OL') steps.push(...[...child.children].filter(item => item.tagName === 'LI'));
    else if (child.tagName === 'TABLE' || child.classList.contains('markdown-table-scroll')) steps.push(...[...child.querySelectorAll('tr')].filter(row => !row.closest('thead')));
    // A build inside a build adds its own steps to the outer one's.
    else if (child.classList.contains('slide-build')) steps.push(...buildSteps(child));
    // Notes are read to the speaker, never revealed.
    else if (!child.classList.contains('slide-notes')) steps.push(child);
  }
  return steps;
}

/** The top-level thematic breaks of a slide note's rendered preview, each with what ends there, and what ends with the note. */
export function previewSeparators(body: HTMLElement): { separators: { element: Element; kind: SlideBreak; label: SeparatorLabel | undefined; }[]; end: SeparatorLabel | undefined; } {
  const reader = new SlideStructureReader();
  const found: { element: Element; kind: SlideBreak; }[] = [];
  for (const node of body.childNodes) {
    if (node.nodeType !== 1) {
      if (node.nodeType === 3 && node.textContent?.trim()) reader.content();
      continue;
    }
    const element = node as Element;
    if (element.tagName === 'HR') {
      const kind: SlideBreak = element.classList.contains('slide-page-break') ? 'page' : 'slide';
      reader.break(kind);
      found.push({ element, kind });
    } else if (element.matches('.slide-block-title, .slide-anchor')) reader.starts();
    else reader.content((element.tagName === 'H2' ? element : element.querySelector('h2'))?.textContent ?? undefined);
  }
  const labels = reader.labels();
  return { separators: found.map((separator, index) => ({ ...separator, label: labels[index] })), end: labels[found.length] };
}

/**
 * Finishes the preview of a slide note (`body` holds the note's rendered HTML): every step of a build is marked, each `---` is labelled
 * with the slide that ends there and each `::vertical` with the page, or the slide, that does.
 */
export function labelSlidePreview(body: HTMLElement, strings: Record<TranslationKey, string>): void {
  for (const build of body.querySelectorAll('.slide-build')) {
    // A nested build's steps were marked with its outer build.
    if (build.parentElement?.closest('.slide-build')) continue;
    for (const step of buildSteps(build)) step.classList.add('slide-build-step');
  }
  const wording: SlideLabelWording = (key, params) => strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
  for (const { element, kind, label } of previewSeparators(body).separators) {
    if (kind === 'slide') element.classList.add('slide-break');
    if (label) element.setAttribute('data-label', separatorLabelText(label, wording));
  }
}
