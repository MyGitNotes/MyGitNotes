// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { readDeck } from './deck.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, type DeckNode, type DeckOutline, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS, HEADINGS_DECKS } from './testing/fixtures.js';

/** The deck the MyGitNotes chain builds: the note renderer's sanitized HTML, read by contour-deck's rehype plugin. */
const notesDeck = (body: string, title: string, structure?: string) => deckOutline(readDeck(renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck', structure }), title, structure) as DeckNode);

/** What the blog chain builds from each fixture deck; the first three are contour-deck's own counts for its fixtures. */
const COUNTS: Record<string, ReturnType<typeof deckCounts>> = { 'kicker-deck.md': { blocks: 5, slides: 11, pages: 13, steps: 5, notes: 9 }, 'slide-templates-demo.md': { blocks: 1, slides: 25, pages: 25, steps: 3, notes: 23 }, 'you-dont-have-to-lead-climb-alone.md': { blocks: 6, slides: 32, pages: 61, steps: 0, notes: 9 }, 'kicker-builds.md': { blocks: 4, slides: 7, pages: 9, steps: 10, notes: 5 }, 'blocks.md': { blocks: 4, slides: 6, pages: 7, steps: 2, notes: 1 }, 'headings.md': { blocks: 4, slides: 6, pages: 9, steps: 4, notes: 2 } };

/** A deck's blocks, their slides by id and heading, and the steps and notes of every page: what two producers of one deck must agree on. */
function expectSameDeck(notes: DeckOutline, blog: DeckOutline) {
  expect(notes.title).toBe(blog.title);
  expect(notes.blocks.map(({ title, short, minutes, kind }) => ({ title, short, minutes, kind }))).toEqual(blog.blocks.map(({ title, short, minutes, kind }) => ({ title, short, minutes, kind })));
  // A slide without a heading is titled by a snippet of its text, which differs where MyGitNotes draws a figure the bare blog chain leaves as a list.
  const titles = (deck: DeckOutline) => deck.blocks.map((block, b) => block.slides.map((slide, s) => ({ id: slide.id, title: blog.blocks[b]?.slides[s]?.headed ? slide.title : undefined })));
  expect(titles(notes)).toEqual(titles(blog));
  expect(notes.blocks.map(block => block.slides.map(slide => slide.pages))).toEqual(blog.blocks.map(block => block.slides.map(slide => slide.pages)));
}

describe('a slide note built by the MyGitNotes renderer and contour-deck', () => {
  it.each(FIXTURE_DECKS)('%s has the blocks, slides, pages, steps and notes the blog chain builds', (name, body, title) => {
    const counts = COUNTS[name];
    const blog = deckOutline(blogDeck(body, title)), notes = notesDeck(body, title);
    expect(deckCounts(blog)).toEqual(counts);
    expect(deckCounts(notes)).toEqual(counts);
    expectSameDeck(notes, blog);
  });
});

describe('a slide note with slideOptions.structure: headings', () => {
  it.each(HEADINGS_DECKS)('%s has the blocks, slides and pages the blog chain builds from its headings', (name, body, title) => {
    const blog = deckOutline(blogDeck(body, title, 'headings')), notes = notesDeck(body, title, 'headings');
    expect(deckCounts(blog)).toEqual(COUNTS[name]);
    expect(deckCounts(notes)).toEqual(COUNTS[name]);
    expectSameDeck(notes, blog);
    expect(notes.blocks.map(block => [block.title, block.slides.map(slide => slide.title)])).toEqual([['標題即輪廓', ['標題即輪廓']], ['一、規則', ['引言', '兩種步驟']], ['附錄 A｜名詞', ['區塊']], ['標題即輪廓', ['沒有標題的區塊', '最後']]]);
  });

  it('is another deck than the one its separators alone would give', () => {
    const [, body, title] = HEADINGS_DECKS[0];
    // Its ::block names no title, which only the headings structure allows.
    expect(() => notesDeck(body, title)).toThrow('::block needs a title');
  });

  it('is refused for a structure contour-deck does not know, as the blog build is', () => {
    expect(() => blogDeck('## A', 'T', 'heading')).toThrow('structure must be "slides" or "headings", got "heading"');
    expect(() => notesDeck('## A', 'T', 'heading')).toThrow('structure must be "slides" or "headings", got "heading"');
  });
});
