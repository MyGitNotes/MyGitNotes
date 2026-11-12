// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { readDeck } from './deck.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckCounts, type DeckNode, type DeckOutline, deckOutline } from './testing/deck-outline.js';
import { FIXTURE_DECKS } from './testing/fixtures.js';

/** The deck the MyGitNotes chain builds: the note renderer's sanitized HTML, read by contour-deck's rehype plugin. */
const notesDeck = (body: string, title: string) => deckOutline(readDeck(renderNote(body, 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck' }), title) as DeckNode);

/** What the blog chain builds from each fixture deck, given `structure: "headings"`. */
const COUNTS: Record<string, ReturnType<typeof deckCounts>> = { 'headings.md': { blocks: 4, slides: 6, pages: 9, steps: 4, notes: 2 }, 'kicker-builds.md': { blocks: 5, slides: 7, pages: 9, steps: 10, notes: 5 } };

/** The block titles and slide titles of each fixture deck. */
const TITLES: Record<string, [unknown, unknown[]][]> = { 'headings.md': [['標題即輪廓', ['標題即輪廓']], ['一、規則', ['引言', '兩種步驟']], ['附錄 A｜名詞', ['區塊']], ['標題即輪廓', ['沒有標題的區塊', '最後']]], 'kicker-builds.md': [['開場｜兩分鐘', ['步驟與堆疊']], ['一、逐步顯示', ['清單一項一步', '表格不在 build 裡', '格線與資訊框']], ['二、程式與圖', ['圍籬裡的指令不算']], ['附錄 A｜名詞', ['區塊']], ['附錄 B｜分隔線', ['另一種分隔線']]] };

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
  it.each(FIXTURE_DECKS)('%s has the blocks, slides, pages, steps and notes the blog chain builds from its headings', (name, body, title) => {
    const blog = deckOutline(blogDeck(body, title)), notes = notesDeck(body, title);
    expect(deckCounts(blog)).toEqual(COUNTS[name]);
    expect(deckCounts(notes)).toEqual(COUNTS[name]);
    expectSameDeck(notes, blog);
    expect(notes.blocks.map(block => [block.title, block.slides.map(slide => slide.title)])).toEqual(TITLES[name]);
  });
});

describe('a slide note with a code fence opened on a list item', () => {
  it('splits its pages and finds its notes after the fence as the blog chain does', () => {
    const body = '## A\n\n- ```js\n  const a = 1;\n  ```\n\n### B\n\n:::summary\nnotes\n:::\n';
    const blog = deckOutline(blogDeck(body, 'T')), notes = notesDeck(body, 'T');
    expect(deckCounts(blog)).toEqual({ blocks: 1, slides: 1, pages: 2, steps: 0, notes: 1 });
    expect(deckCounts(notes)).toEqual(deckCounts(blog));
    expectSameDeck(notes, blog);
  });
});
