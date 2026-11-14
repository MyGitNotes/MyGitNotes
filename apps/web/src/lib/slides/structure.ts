/**
 * The structure a slide note's headings give it: which block ends at each `---`, which slide and page each `##` and `###` heads, and which
 * parts of a `:::build` are its steps. This is the one place the editor's and the preview's labels come from.
 *
 * contour-deck's `rehypeDeck` is what builds the deck; this module only reads the same structure off the source or the preview, by the
 * rules of contour-deck 0.3.1's headings mode (`docs/PLUGINS.md`, "Headings mode" and "Steps"), and `structure.test.ts` holds it to
 * `rehypeDeck` on the fixture decks.
 */
import type { TranslationKey } from '../i18n/en.js';

/** The slide and the page a heading of a slide note stands on: a `##` heads a slide, a `###` a page of one. */
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
 * Reads a slide note by contour-deck's headings mode from top to bottom: tell it each top-level heading, the notes, any other
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

  /** A paragraph of nothing but `:en[…]`: the heading's English line, which is part of the page and none of its content. */
  english(): void {
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

/** The label of a heading of a slide note: `Slide 3` on a `##`, `Page 3.2` on a `###`. */
export function headingLabelText(label: HeadingLabel, level: 2 | 3, wording: SlideLabelWording): string {
  return wording(level === 2 ? 'slides.slideLabel' : 'slides.pageLabel', { slide: label.slide, page: label.page });
}

/** The label of a `---` of a slide note, and of the end of the note: `Block 2`, the block that ends there. */
export function blockLabelText(block: number, wording: SlideLabelWording): string {
  return wording('slides.blockNumberLabel', { block });
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
    // Notes are read to the speaker, never revealed, and a background is no step of the build.
    else if (!child.classList.contains('slide-notes') && !child.classList.contains('slide-background')) steps.push(child);
  }
  return steps;
}

/** A `<p>` that holds nothing but one `<span class="en" lang="en">`, as contour-deck's `isEnglishParagraph` reads it. */
function isEnglishParagraph(element: Element): boolean {
  if (element.tagName !== 'P') return false;
  const children = [...element.childNodes].filter(node => !(node.nodeType === 3 && !node.textContent?.trim()));
  return children.length === 1 && children[0].nodeType === 1 && (children[0] as Element).matches('span.en[lang="en"]');
}

/**
 * The top-level headings and thematic breaks of the rendered preview of a slide note: each `---` with the block that
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
    // contour-deck refuses a `::vertical`, which is drawn as an error box, so every `<hr>` here is the writer's `---`.
    if (element.tagName === 'HR') {
      reader.rule();
      rules.push(element);
    } else if (level) {
      const index = reader.heading(Number(level[1]));
      if (index !== undefined) headings.push({ element, level: Number(level[1]) as 2 | 3, index });
    } else if (element.matches('.slide-notes, .slide-background')) reader.notes();
    else if (isEnglishParagraph(element)) reader.english(); // a background, like notes, is no content of its page
    else if (!element.matches('.slide-block-title, .slide-anchor')) reader.content();
  }
  const structure = reader.structure();
  return { rules: rules.map((element, index) => ({ element, block: structure.blocks[index] })), headings: headings.map(({ element, level, index }) => ({ element, level, label: structure.headings[index] })), end: structure.blocks[rules.length], pages: structure.pages };
}

/**
 * Finishes the preview of a slide note (`body` holds the note's rendered HTML): every step of a build is marked, each `---` is labelled
 * with the block that ends there, and each top-level `##` and `###` with the slide and the page it heads.
 */
export function labelSlidePreview(body: HTMLElement, strings: Record<TranslationKey, string>): void {
  for (const build of body.querySelectorAll('.slide-build')) {
    // A nested build's steps were marked with its outer build.
    if (build.parentElement?.closest('.slide-build')) continue;
    for (const step of buildSteps(build)) step.classList.add('slide-build-step');
  }
  const wording: SlideLabelWording = (key, params) => strings[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
  const { rules, headings } = previewHeadings(body);
  for (const { element, block } of rules) {
    element.classList.add('slide-break');
    if (block !== undefined) element.setAttribute('data-label', blockLabelText(block, wording));
  }
  for (const { element, level, label } of headings) {
    element.classList.add('slide-heading');
    element.setAttribute('data-label', headingLabelText(label, level, wording));
  }
}
