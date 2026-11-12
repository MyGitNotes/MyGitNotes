// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { readDeck } from './deck.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, type DeckNode, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS } from './testing/fixtures.js';

/** The deck the MyGitNotes chain builds: the note renderer's sanitized HTML, read by contour-deck's rehype plugin. */
const notesDeck = (body: string, title: string) => deckOutline(readDeck(renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck' }), title) as DeckNode);

/** What the blog chain builds from each fixture deck; the first three are contour-deck's own counts for its fixtures. */
const COUNTS: Record<string, ReturnType<typeof deckCounts>> = { 'kicker-deck.md': { blocks: 5, slides: 11, pages: 13, steps: 5, notes: 9 }, 'slide-templates-demo.md': { blocks: 1, slides: 25, pages: 25, steps: 3, notes: 23 }, 'you-dont-have-to-lead-climb-alone.md': { blocks: 6, slides: 32, pages: 61, steps: 0, notes: 9 }, 'kicker-builds.md': { blocks: 4, slides: 7, pages: 9, steps: 10, notes: 5 }, 'blocks.md': { blocks: 4, slides: 6, pages: 7, steps: 2, notes: 1 } };

describe('a slide note built by the MyGitNotes renderer and contour-deck', () => {
  it.each(FIXTURE_DECKS)('%s has the blocks, slides, pages, steps and notes the blog chain builds', (name, body, title) => {
    const counts = COUNTS[name];
    const blog = deckOutline(blogDeck(body, title)), notes = notesDeck(body, title);
    expect(deckCounts(blog)).toEqual(counts);
    expect(deckCounts(notes)).toEqual(counts);
    expect(notes.title).toBe(blog.title);
    expect(notes.blocks.map(({ title, short, minutes, kind }) => ({ title, short, minutes, kind }))).toEqual(blog.blocks.map(({ title, short, minutes, kind }) => ({ title, short, minutes, kind })));
    // A slide without a heading is titled by a snippet of its text, which differs where MyGitNotes draws a figure the bare blog chain leaves as a list.
    const titles = (deck: typeof blog) => deck.blocks.map((block, b) => block.slides.map((slide, s) => ({ id: slide.id, title: blog.blocks[b]?.slides[s]?.headed ? slide.title : undefined })));
    expect(titles(notes)).toEqual(titles(blog));
    expect(notes.blocks.map(block => block.slides.map(slide => slide.pages))).toEqual(blog.blocks.map(block => block.slides.map(slide => slide.pages)));
  });
});
