// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { findDirectiveBlocks } from '../directive-editing.js';
import { editorSlideStructure, slideNote } from '../../components/live-markdown/slide-structure.js';
import { renderNote } from '../markdown.js';
import { readDeck } from './deck.js';
import { SlideDeckError } from './errors.js';
import { HeadingStructureReader, previewHeadings } from './structure.js';
import { blogDeck } from './testing/blog-chain.js';
import { deckOutline } from './testing/deck-outline.js';

const html = (body: string, slides?: 'preview' | 'deck') => renderNote(body, 'slides/deck.md', undefined, undefined, undefined, slides ? { slides } : undefined);
const host = (body: string, slides?: 'preview' | 'deck') => {
  const element = document.createElement('div');
  element.innerHTML = html(body, slides);
  return element;
};

describe(':en[…] bilingual lines', () => {
  it('is contour-deck’s span in an ordinary note, with its inline Markdown and a bracket inside', () => {
    const element = host('- 古老的競技遊戲 :en[An *ancient* [sic] game]');
    const span = element.querySelector('li > span.en');
    expect(span?.getAttribute('lang')).toBe('en');
    expect(span?.innerHTML).toBe('An <em>ancient</em> [sic] game');
    expect(element.textContent).not.toContain(':en[');
  });

  it('is the same span in a slide preview and a deck, and a code fence keeps its source', () => {
    for (const mode of ['preview', 'deck'] as const) expect(host('## 標題\n\n:en[Title]\n', mode).querySelectorAll('span.en[lang="en"]')).toHaveLength(1);
    expect(host('```\n:en[x]\n```\n').querySelector('span.en')).toBeNull();
  });

  it('refuses the leaf and container forms and any attribute in a slide note, and keeps them as text elsewhere', () => {
    for (const source of ['::en[x]', ':::en\nx\n:::', ':en[x]{lang=fr}', 'a :en[x]{.big} b']) {
      const preview = host(`## T\n\n${source}\n`, 'preview');
      expect(preview.querySelector('.slide-error'), source).not.toBeNull();
      expect(preview.querySelector('.ig-error-message')?.textContent, source).toMatch(/^en /);
      expect(() => html(`## T\n\n${source}\n`, 'deck'), source).toThrow(SlideDeckError);
    }
    expect(host('a :en[x]{.big} b').querySelector('.slide-error')).toBeNull();
  });

  it('keeps the page structure contour-deck reads: an English paragraph is no content of a page', () => {
    const reader = new HeadingStructureReader();
    reader.heading(4);
    reader.english();
    reader.heading(2);
    expect(reader.structure().pages).toEqual([1]);
    const note = '#### 前言\n\n:en[Preface]\n\n## 開場\n\n:en[Opening]\n\n### 第一頁\n\n:en[Page one]\n\n內容\n\n---\n\n## 二\n\n:en[Two]\n';
    const deck = deckOutline(blogDeck(note, 'T')), preview = previewHeadings(host(note, 'preview'));
    expect(preview.pages).toEqual(deck.blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
  });

  it('agrees in the live editor’s own reading', () => {
    const note = '#### 前言\n\n:en[Preface]\n\n## 開場\n\n:en[Opening]\n\n### 第一頁\n\n:en[Page one]\n\n內容\n\n---\n\n## 二\n\n:en[Two]\n';
    const state = EditorState.create({ doc: note, extensions: [markdown({ base: markdownLanguage }), slideNote.of(true)] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    expect(editorSlideStructure(state, findDirectiveBlocks(note, true)).pages).toEqual(deckOutline(blogDeck(note, 'T')).blocks.flatMap(block => block.slides.map(slide => slide.pages.length)));
    // Text after the line makes it a paragraph of more than the English line.
    const mixed = EditorState.create({ doc: '## 一\n\n:en[One]\n文字\n\n### 二\n', extensions: [markdown({ base: markdownLanguage }), slideNote.of(true)] });
    ensureSyntaxTree(mixed, mixed.doc.length, 5000);
    expect(editorSlideStructure(mixed, []).pages).toEqual([2]);
  });

  it('is read by readDeck', () => {
    expect(readDeck(html('## 標題\n\n:en[Title]\n', 'deck'), 'T')).toBeTruthy();
  });
});
