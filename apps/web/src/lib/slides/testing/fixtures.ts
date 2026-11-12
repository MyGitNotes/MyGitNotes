/** The fixture decks (see `../fixtures/README.md`) and how the tests read them. Test-only. */
import blocks from '../fixtures/blocks.md?raw';
import headings from '../fixtures/headings.md?raw';
import kickerBuilds from '../fixtures/kicker-builds.md?raw';
import kickerDeck from '../fixtures/kicker-deck.md?raw';
import templatesDemo from '../fixtures/slide-templates-demo.md?raw';
import leadClimb from '../fixtures/you-dont-have-to-lead-climb-alone.md?raw';

/** A fixture deck's body, without its frontmatter, and the title its frontmatter gives. */
function fixture(name: string, text: string): [name: string, body: string, title: string] {
  return [name, text.replace(/^---\n[\s\S]*?\n---\n/, ''), /^title: "?(.*?)"?$/m.exec(text)![1]];
}

/** The first three are contour-deck's own fixture decks; the last two cover what they leave out. */
export const FIXTURE_DECKS = [fixture('kicker-deck.md', kickerDeck), fixture('slide-templates-demo.md', templatesDemo), fixture('you-dont-have-to-lead-climb-alone.md', leadClimb), fixture('kicker-builds.md', kickerBuilds), fixture('blocks.md', blocks)];

/** The decks whose frontmatter says `slideOptions.structure: headings`: `---` is a block, `##` a slide, `###` a page. */
export const HEADINGS_DECKS = [fixture('headings.md', headings)];

/** The number of pages of each slide, read off what ends at each separator of a note and at its end. */
export function pagesPerSlide(ends: { slide: number; page: number; }[]): number[] {
  const pages: number[] = [];
  for (const { slide, page } of ends) pages[slide - 1] = Math.max(pages[slide - 1] ?? 0, page);
  return pages;
}
