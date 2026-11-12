// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { en, type TranslationKey } from './i18n/en.js';
import { zhTW } from './i18n/zh-TW.js';
import { renderNote } from './markdown.js';
import { BUILTIN_NOTE_TEMPLATES, builtinNoteTemplates, isBuiltinTemplate, renderBuiltinNoteTemplate } from './builtin-templates.js';
import { readDeck } from './slides/deck.js';
import { isSlideNote } from './slides/note.js';
import { blogDeck } from './slides/testing/blog-chain.js';
import { deckCounts, type DeckNode, deckOutline } from './slides/testing/deck-outline.js';

/** The app's wording in one language, with its placeholders filled. */
const wording = (strings: Record<TranslationKey, string>) => (key: TranslationKey, values?: Record<string, string | number>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), strings[key]);

describe('the built-in note templates', () => {
  it('offer Slides in the language of the app, under an id no notebook template can take', () => {
    expect(builtinNoteTemplates(wording(en))).toEqual([{ id: 'builtin:slides', title: 'Slides' }]);
    expect(builtinNoteTemplates(wording(zhTW))).toEqual([{ id: 'builtin:slides', title: '投影片' }]);
    expect(BUILTIN_NOTE_TEMPLATES.every(template => isBuiltinTemplate(template.id) && !/^[a-zA-Z0-9_-]+$/.test(template.id))).toBe(true);
    expect(isBuiltinTemplate('slides')).toBe(false);
  });

  it.each([['en', en], ['zh-TW', zhTW]] as const)('write, in %s, a slide note a blog and the deck read as one block for its title and one of two slides, the second of two pages', (_language, strings) => {
    const { content, metadata } = renderBuiltinNoteTemplate('builtin:slides', 'Talk', wording(strings));
    expect(isSlideNote(metadata)).toBe(true);
    expect(metadata.slideOptions).toEqual({ engine: 'contour', structure: 'headings' });
    expect(content.startsWith('# Talk\n')).toBe(true);
    const blog = deckOutline(blogDeck(content, 'Talk'));
    const notes = deckOutline(readDeck(renderNote(content, 'slides/talk.md', undefined, undefined, undefined, { slides: 'deck' }), 'Talk') as DeckNode);
    for (const deck of [blog, notes]) {
      expect(deckCounts(deck)).toEqual({ blocks: 2, slides: 3, pages: 4, steps: 2, notes: 1 });
      expect(deck.blocks.map(block => block.slides.map(slide => slide.pages.length))).toEqual([[1], [1, 2]]);
      expect(deck.blocks[0].title).toBe('Talk');
    }
    expect(notes.blocks.map(block => [block.title, block.slides.map(slide => slide.title)])).toEqual(blog.blocks.map(block => [block.title, block.slides.map(slide => slide.title)]));
  });

  it('refuses an id it does not have', () => {
    expect(() => renderBuiltinNoteTemplate('builtin:poster', 'Talk', wording(en))).toThrow('builtin:poster');
  });
});
