// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { HeadingStructureReader, previewHeadings } from './structure.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS } from './testing/fixtures.js';

describe('a slide note, read by its headings', () => {
  /** A deck written as words: `|` is a `---`, a digit a top-level heading of that level, `n` a `:::summary`, `.` any other content. */
  function read(deck: string) {
    const reader = new HeadingStructureReader();
    for (const sign of deck) {
      if (sign === '|') reader.rule();
      else if (sign === 'n') reader.notes();
      else if (sign === '.') reader.content();
      else reader.heading(Number(sign));
    }
    const { blocks, headings, pages } = reader.structure();
    return { blocks: blocks.map(block => block ?? '-').join(' '), headings: headings.map(({ slide, page }) => `${slide}.${page}`).join(' '), pages: pages.join(' ') };
  }

  it('starts a block at ---, a slide at ## and a page at ###', () => {
    expect(read('1.|2.2.3.3.|2.')).toEqual({ blocks: '1 2 3', headings: '2.1 3.1 3.2 3.3 4.1', pages: '1 1 3 1' });
  });

  it('heads the first page with a ### that stands right under the ##, notes aside', () => {
    expect(read('23.3.')).toEqual({ blocks: '1', headings: '1.1 1.1 1.2', pages: '2' });
    expect(read('2n3.3.')).toEqual({ blocks: '1', headings: '1.1 1.1 1.2', pages: '2' });
    expect(read('2.3.')).toEqual({ blocks: '1', headings: '1.1 1.2', pages: '2' });
  });

  it('makes what stands before the first ## a slide of its own, unless it is only a kicker and notes', () => {
    expect(read('1.2.')).toEqual({ blocks: '1', headings: '2.1', pages: '1 1' });
    expect(read('4n2.')).toEqual({ blocks: '1', headings: '1.1', pages: '1' });
    // A second #### is content, and so is a # or anything else.
    expect(read('442.').pages).toBe('1 1');
    expect(read('12.').pages).toBe('1 1');
    expect(read('n.2.').pages).toBe('1 1');
  });

  it('starts a page of the first slide at a ### before the first ##', () => {
    expect(read('.3.2.')).toEqual({ blocks: '1', headings: '1.2 2.1', pages: '2 1' });
    expect(read('3.3.')).toEqual({ blocks: '1', headings: '1.1 1.2', pages: '2' });
  });

  it('skips a --- group without content, and ends no block where none stands', () => {
    expect(read('|2.||2.|')).toEqual({ blocks: '- 1 - 2 -', headings: '1.1 2.1', pages: '1 1' });
  });

  /** The preview of a slide note, as `renderNote` draws it. */
  const preview = (body: string) => {
    const host = document.createElement('div');
    host.innerHTML = renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'preview' });
    return host;
  };

  it.each(FIXTURE_DECKS)('%s labels its preview with the blocks, slides and pages contour-deck builds, and marks the steps it reveals', (_name, body, title) => {
    const deck = deckOutline(blogDeck(body, title));
    const host = preview(body);
    const { rules, headings, end, pages } = previewHeadings(host);
    expect(pages).toEqual(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
    expect([...rules.map(rule => rule.block), end].filter(block => block !== undefined)).toEqual(deck.blocks.map((_block, index) => index + 1));
    expect(host.querySelectorAll('.slide-build-step')).toHaveLength(deckCounts(deck).steps);
    expect(host.querySelector('.slide-error')).toBeNull();
    // A heading inside a quote or a list is content, and carries no label.
    expect(host.querySelectorAll('.slide-heading')).toHaveLength(headings.length);
  });

  it('labels each --- with the block that ends there, each ## with its slide and each ### with its page', () => {
    const host = preview(FIXTURE_DECKS[0][1]);
    expect([...host.querySelectorAll('hr')].map(rule => [rule.className, rule.getAttribute('data-label')])).toEqual([['slide-break', 'Block 1'], ['slide-break', 'Block 2'], ['slide-break', 'Block 3'], ['slide-break', null]]);
    expect(previewHeadings(host).headings.map(({ element }) => [element.tagName, element.textContent, element.getAttribute('data-label')])).toEqual([['H2', '引言', 'Slide 2'], ['H2', '兩種步驟', 'Slide 3'], ['H3', '清單', 'Page 3.1'], ['H3', '表格', 'Page 3.2'], ['H3', '結尾', 'Page 3.3'], ['H2', '區塊', 'Slide 4'], ['H2', '沒有標題的區塊', 'Slide 5'], ['H3', '第一頁', 'Page 5.1'], ['H3', '第二頁', 'Page 5.2'], ['H2', '最後', 'Slide 6']]);
  });
});
