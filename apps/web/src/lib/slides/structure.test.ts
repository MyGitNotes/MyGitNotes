// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { HeadingStructureReader, previewHeadings, previewSeparators, type SeparatorLabel, SlideStructureReader } from './structure.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS, HEADINGS_DECKS, pagesPerSlide } from './testing/fixtures.js';

describe('what ends at a separator', () => {
  /** A deck written as words: `|` is a `---`, `/` a `::vertical`, a letter a page with that second-level heading, `.` a page without one, `!` a `::block`, `_` nothing. */
  function labels(deck: string): string[] {
    const reader = new SlideStructureReader();
    for (const sign of deck) {
      if (sign === '|') reader.break('slide');
      else if (sign === '/') reader.break('page');
      else if (sign === '!') reader.starts();
      else if (sign === '.') reader.content();
      else if (sign !== '_') reader.content(sign);
    }
    return reader.labels().map(label => label ? `${label.slide}.${label.page}${label.endsSlide ? '' : '+'}` : '-');
  }

  it('is a slide at every --- and at the end of the note', () => {
    expect(labels('a|b|c')).toEqual(['1.1', '2.1', '3.1']);
  });

  it('is a page at a ::vertical whose next page has no heading or repeats the heading of the slide', () => {
    expect(labels('a/./a|b')).toEqual(['1.1+', '1.2+', '1.3', '2.1']);
  });

  it('is a slide at a ::vertical whose next page has another heading', () => {
    expect(labels('a/b/.')).toEqual(['1.1', '2.1+', '2.2']);
    // The first page has no second-level heading, so any heading after it differs.
    expect(labels('./a')).toEqual(['1.1', '2.1']);
  });

  it('is a slide before a page that carries ::block or ::slide, or follows a ::block that stood alone', () => {
    expect(labels('a/!a')).toEqual(['1.1', '2.1']);
    expect(labels('a|!|a/a')).toEqual(['1.1', '-', '2.1+', '2.2']);
  });

  it('is nothing where no content precedes the separator', () => {
    expect(labels('_|a|_|b/_')).toEqual(['-', '1.1', '-', '2.1', '-']);
  });
});

describe('the preview of a slide note', () => {
  it.each(FIXTURE_DECKS)('%s labels its separators with the slides and pages contour-deck builds, and marks the steps it reveals', (_name, body, title) => {
    const deck = deckOutline(blogDeck(body, title));
    const host = document.createElement('div');
    host.innerHTML = renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'preview' });
    const { separators, end } = previewSeparators(host);
    const ends = [...separators.map(separator => separator.label), end].filter((label): label is SeparatorLabel => Boolean(label));
    expect(pagesPerSlide(ends)).toEqual(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
    expect(host.querySelectorAll('.slide-build-step')).toHaveLength(deckCounts(deck).steps);
    expect(host.querySelector('.slide-error')).toBeNull();
  });
});

describe('a page whose first second-level heading is empty', () => {
  it('has no heading, as contour-deck reads it, so it is a further page of the slide before it', () => {
    const body = '## A\n\none\n\n::vertical\n\n## \n\n## B\n\ntwo\n';
    const deck = deckOutline(blogDeck(body, 'T'));
    expect(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length))).toEqual([2]);
    const host = document.createElement('div');
    host.innerHTML = renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'preview' });
    const { separators, end } = previewSeparators(host);
    expect(pagesPerSlide([...separators.map(separator => separator.label), end].filter((label): label is SeparatorLabel => Boolean(label)))).toEqual([2]);
  });
});

describe('a note read by its headings', () => {
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

  it.each(HEADINGS_DECKS)('%s labels its preview with the blocks, slides and pages contour-deck builds, and marks the steps it reveals', (_name, body, title) => {
    const deck = deckOutline(blogDeck(body, title, 'headings'));
    const host = document.createElement('div');
    host.innerHTML = renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'preview', structure: 'headings' });
    const { rules, headings, end, pages } = previewHeadings(host);
    expect(pages).toEqual(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
    expect([...rules.map(rule => rule.block), end].filter(block => block !== undefined)).toEqual(deck.blocks.map((_block, index) => index + 1));
    expect(host.querySelectorAll('.slide-build-step')).toHaveLength(deckCounts(deck).steps);
    expect(host.querySelector('.slide-error')).toBeNull();
    expect([...host.querySelectorAll('hr')].map(rule => [rule.className, rule.getAttribute('data-label')])).toEqual([['slide-break', 'Block 1'], ['slide-break', 'Block 2'], ['slide-break', 'Block 3'], ['slide-break', null]]);
    expect(headings.map(({ element }) => [element.tagName, element.textContent, element.getAttribute('data-label')])).toEqual([['H2', '引言', 'Slide 2'], ['H2', '兩種步驟', 'Slide 3'], ['H3', '清單', 'Page 3.1'], ['H3', '表格', 'Page 3.2'], ['H3', '結尾', 'Page 3.3'], ['H2', '區塊', 'Slide 4'], ['H2', '沒有標題的區塊', 'Slide 5'], ['H3', '第一頁', 'Page 5.1'], ['H3', '第二頁', 'Page 5.2'], ['H2', '最後', 'Slide 6']]);
    // A heading inside a quote or a list is content, and carries no label.
    expect(host.querySelectorAll('.slide-heading')).toHaveLength(headings.length);
  });

  it('keeps the default labels on the same text when the note names no structure', () => {
    const host = document.createElement('div');
    host.innerHTML = renderNote('## A\n\n### B\n\ntext\n\n---\n\n## C', 'slides/deck.md', undefined, undefined, undefined, { slides: 'preview' });
    expect([...host.querySelectorAll('hr')].map(rule => rule.getAttribute('data-label'))).toEqual(['Slide 1']);
    expect(host.querySelector('.slide-heading, h2[data-label], h3[data-label]')).toBeNull();
  });
});
