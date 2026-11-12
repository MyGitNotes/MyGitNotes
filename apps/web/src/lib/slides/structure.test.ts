// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { previewSeparators, type SeparatorLabel, SlideStructureReader } from './structure.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS, pagesPerSlide } from './testing/fixtures.js';

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
