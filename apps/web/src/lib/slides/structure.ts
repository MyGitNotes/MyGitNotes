/**
 * The slide structure a note's separators give it: which slide and which page ends at each `---` and `::vertical`, and which parts of a
 * `:::build` are its steps. This is the one place the editor's and the preview's labels come from.
 *
 * contour-deck's `rehypeDeck` is what builds the deck; this module only reads the same structure off the source or the preview, by the
 * rules of contour-deck 0.3.0 (`docs/PLUGINS.md`, "Slides and pages", "Headings mode" and "Steps"), and `structure.test.ts` holds it to
 * `rehypeDeck` on the fixture decks. There are two readings: {@link SlideStructureReader} for a note read by its separators, the default,
 * and {@link HeadingStructureReader} for one read by its headings (`slideOptions.structure: headings`).
 */
import type { TranslationKey } from '../i18n/en.js';
import { readsByHeadings } from './note.js';

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
  /** The text of its first second-level heading, none where that heading is empty. */
  heading?: string;
  /** It holds a second-level heading, empty or not. */
  headed?: boolean;
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

  /** Anything a slide shows; `heading` is the text of a second-level heading it holds. Only the first counts, and an empty one is none. */
  content(heading?: string): void {
    this.chunk.content = true;
    if (heading === undefined || this.chunk.headed) return;
    this.chunk.headed = true;
    this.chunk.heading = heading.replace(/\s+/g, ' ').trim() || undefined;
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

/** The slide and the page a heading of a note read by its headings stands on: a `##` heads a slide, a `###` a page of one. */
export interface HeadingLabel {
  slide: number;
  page: number;
}

/** What {@link HeadingStructureReader} read. */
export interface HeadingStructure {
  /** One per `---`, then one for the end of the note: the number of the block that ends there; none where no slide stands before it. */
  blocks: (number | undefined)[];
  /** One per top-level `##` and `###`, in document order. */
  headings: HeadingLabel[];
  /** The number of pages of each slide, in order. */
  pages: number[];
}

/**
 * Reads a slide note written in contour-deck's headings mode from top to bottom: tell it each top-level heading, the notes, any other
 * content and each `---`, in document order. A `---` starts a block, a `##` a slide and a `###` a further page of the slide. What stands
 * before a block's first `##` is the block's first slide, unless it is nothing but a `####` kicker and notes, which open the first `##`
 * slide; a `###` right under the slide's `##`, with no content between them, heads the first page with it. `::block` and `::slide`
 * neither start nor end anything, so they are not told.
 */
export class HeadingStructureReader {
  private blocks: (number | undefined)[] = [];
  private headings: HeadingLabel[] = [];
  private pages: number[] = [];
  private block = 0;
  /** The block's opening holds nothing yet: no slide of the block has started. */
  private empty = true;
  /** Nothing but headings since the block opened (`opening`, a first `####` kicker aside) or since the slide's `##` (`title`). */
  private bare: 'opening' | 'title' | undefined = 'opening';
  private kicker = false;

  /** What stands before the block's first `##` is its first slide, from the first thing told. */
  private open(): void {
    if (this.empty) this.pages.push(1);
    this.empty = false;
  }

  /** A top-level heading of this level; the answer is the index of a `##` or a `###` among {@link HeadingStructure.headings}. */
  heading(level: number): number | undefined {
    if (level === 2) {
      // A `##` joins an opening that holds only a kicker and notes; any other starts a slide.
      if (this.bare === 'opening') this.open();
      else this.pages.push(1);
      this.bare = 'title';
    } else if (level === 3) {
      if (this.bare) this.open();
      else this.pages[this.pages.length - 1] += 1;
      this.bare = undefined;
    } else {
      this.open();
      if (level === 4 && this.bare === 'opening' && !this.kicker) this.kicker = true;
      else this.bare = undefined;
      return undefined;
    }
    return this.headings.push({ slide: this.pages.length, page: this.pages[this.pages.length - 1] }) - 1;
  }

  /** A `:::summary`: it belongs to the page it is written on, and is no content between a `##` and its `###`. */
  notes(): void {
    this.open();
  }

  /** Anything else a slide shows. */
  content(): void {
    this.open();
    this.bare = undefined;
  }

  /** A top-level `---`; the answer is its index among {@link HeadingStructure.blocks}. */
  rule(): number {
    this.blocks.push(this.empty ? undefined : ++this.block);
    this.empty = true;
    this.bare = 'opening';
    this.kicker = false;
    return this.blocks.length - 1;
  }

  structure(): HeadingStructure {
    return { blocks: [...this.blocks, this.empty ? undefined : this.block + 1], headings: [...this.headings], pages: [...this.pages] };
  }
}

/** Fills the placeholders of a label's wording, in the language of whoever reads it. */
export type SlideLabelWording = (key: 'slides.slideLabel' | 'slides.pageLabel' | 'slides.blockNumberLabel', params: Record<string, number>) => string;

/** The label of a heading of a note read by its headings: `Slide 3` on a `##`, `Page 3.2` on a `###`. */
export function headingLabelText(label: HeadingLabel, level: 2 | 3, wording: SlideLabelWording): string {
  return wording(level === 2 ? 'slides.slideLabel' : 'slides.pageLabel', { slide: label.slide, page: label.page });
}

/** The label of a `---` of a note read by its headings, and of the end of the note: `Block 2`, the block that ends there. */
export function blockLabelText(block: number, wording: SlideLabelWording): string {
  return wording('slides.blockNumberLabel', { block });
}

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
 * The top-level headings and thematic breaks of the rendered preview of a slide note read by its headings: each `---` with the block that
 * ends there, each `##` and `###` with the slide and page it heads, and the block that ends with the note.
 */
export function previewHeadings(body: HTMLElement): { rules: { element: Element; block: number | undefined; }[]; headings: { element: Element; level: 2 | 3; label: HeadingLabel; }[]; end: number | undefined; pages: number[]; } {
  const reader = new HeadingStructureReader();
  const rules: Element[] = [], headings: { element: Element; level: 2 | 3; index: number; }[] = [];
  for (const node of body.childNodes) {
    if (node.nodeType !== 1) {
      if (node.nodeType === 3 && node.textContent?.trim()) reader.content();
      continue;
    }
    const element = node as Element, level = /^H([1-6])$/.exec(element.tagName);
    // A `::vertical` is refused in this structure and drawn as an error box, so every `<hr>` here is the writer's `---`.
    if (element.tagName === 'HR') {
      reader.rule();
      rules.push(element);
    } else if (level) {
      const index = reader.heading(Number(level[1]));
      if (index !== undefined) headings.push({ element, level: Number(level[1]) as 2 | 3, index });
    } else if (element.matches('.slide-notes')) reader.notes();
    else if (!element.matches('.slide-block-title, .slide-anchor')) reader.content();
  }
  const structure = reader.structure();
  return { rules: rules.map((element, index) => ({ element, block: structure.blocks[index] })), headings: headings.map(({ element, level, index }) => ({ element, level, label: structure.headings[index] })), end: structure.blocks[rules.length], pages: structure.pages };
}

/**
 * Finishes the preview of a slide note (`body` holds the note's rendered HTML): every step of a build is marked, each `---` is labelled
 * with the slide that ends there and each `::vertical` with the page, or the slide, that does. In a note read by its headings
 * (`structure`, the note's `slideOptions.structure`) each `---` is labelled with the block that ends there, and each top-level `##` and
 * `###` with the slide and the page it heads.
 */
export function labelSlidePreview(body: HTMLElement, strings: Record<TranslationKey, string>, structure?: string): void {
  for (const build of body.querySelectorAll('.slide-build')) {
    // A nested build's steps were marked with its outer build.
    if (build.parentElement?.closest('.slide-build')) continue;
    for (const step of buildSteps(build)) step.classList.add('slide-build-step');
  }
  const wording: SlideLabelWording = (key, params) => strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
  if (readsByHeadings(structure)) {
    const { rules, headings } = previewHeadings(body);
    for (const { element, block } of rules) {
      element.classList.add('slide-break');
      if (block !== undefined) element.setAttribute('data-label', blockLabelText(block, wording));
    }
    for (const { element, level, label } of headings) {
      element.classList.add('slide-heading');
      element.setAttribute('data-label', headingLabelText(label, level, wording));
    }
    return;
  }
  for (const { element, kind, label } of previewSeparators(body).separators) {
    if (kind === 'slide') element.classList.add('slide-break');
    if (label) element.setAttribute('data-label', separatorLabelText(label, wording));
  }
}
