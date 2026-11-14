// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { readDeck } from './deck.js';
import { SlideDeckError } from './errors.js';
import { blogDeck } from './testing/blog-chain.js';
import type { DeckNode } from './testing/deck-outline.js';

/** The note's sanitized HTML for a deck (`deck`) or its preview (`preview`), or for a note that is no deck. */
function html(markdown: string, slides?: 'preview' | 'deck', path = 'slides/deck.md'): string {
  return renderNote(markdown, path, undefined, undefined, undefined, slides ? { slides } : undefined);
}

function host(markdown: string, slides?: 'preview' | 'deck'): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html(markdown, slides);
  return element;
}

/** The `data-ct-background` elements of a hast deck, with their properties and children but not the line the note's renderer adds. */
function hastBackgrounds(node: DeckNode): { properties: Record<string, unknown>; children: unknown[]; }[] {
  const found: { properties: Record<string, unknown>; children: unknown[]; }[] = [];
  const walk = (current: DeckNode) => {
    if (current.properties && 'dataCtBackground' in current.properties) {
      // The note's HTML says `data-ct-background` with no value where hast says `true`.
      const properties = Object.fromEntries(Object.entries(current.properties).filter(([name]) => name !== 'dataLine').map(([name, value]) => [name, value === true ? '' : value]));
      found.push({ properties, children: (current.children ?? []).map(child => child.type === 'text' ? child.value : { tag: child.tagName, properties: Object.fromEntries(Object.entries(child.properties ?? {}).map(([name, value]) => [name, value === true ? '' : value])), text: child.children?.map(grand => grand.value).join('') }) });
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return found;
}

describe('::background in the deck of a type: slide note', () => {
  const NOTES = ['::background{image="https://example.com/board.jpg" dim=0.6 credit="Photo: A. B., CC BY-SA 4.0"}\n\n## One\n\ntext\n', '## One\n\n::background{video="https://example.com/clip.mp4" start=12 end=40 poster="https://example.com/clip.jpg" position="50% 20%"}\n\ntext\n', '## One\n\ntext\n\n::background{youtube="https://youtu.be/dQw4w9WgXcQ" start=30}\n'];

  it.each(NOTES)('writes what the blog chain writes: the element, its attributes, its still and its credit (%#)', note => {
    const notes = hastBackgrounds(readDeck(html(note, 'deck'), 'T') as DeckNode), blog = hastBackgrounds(blogDeck(note, 'T'));
    expect(blog).toHaveLength(1);
    expect(notes).toEqual(blog);
  });

  it('keeps the element, its media attributes, the scrim and position style, the still and the credit through the sanitizer', () => {
    const page = host('## One\n\n::background{video="https://example.com/clip.mp4" start=12 end=40 poster="https://example.com/clip.jpg" dim=0.6 position="50% 20%" credit="Photo: A. B."}\n\ntext\n', 'deck');
    const background = page.querySelector<HTMLElement>('[data-ct-background]')!;
    expect(background.getAttribute('data-video')).toBe('https://example.com/clip.mp4');
    expect([background.dataset.start, background.dataset.end]).toEqual(['12', '40']);
    expect(background.getAttribute('style')).toBe('--ct-dim: 0.6; --ct-position: 50% 20%');
    expect(background.querySelector('img')?.getAttribute('src')).toBe('https://example.com/clip.jpg');
    expect(background.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(background.querySelector('small[data-ct-credit]')?.textContent).toBe('Photo: A. B.');
    expect(page.querySelector('[data-ct-background][data-youtube]')).toBeNull();
    expect(host('## One\n\n::background{youtube="dQw4w9WgXcQ"}\n', 'deck').querySelector<HTMLElement>('[data-ct-background]')?.dataset.youtube).toBe('dQw4w9WgXcQ');
  });

  it('moves the background to the first element of the page it is written on, wherever it stands in the page', () => {
    const deck = readDeck(html('## One\n\ntext\n\n::background{image="https://example.com/a.jpg"}\n\n### Two\n\nmore\n', 'deck'), 'T');
    const pages = JSON.stringify(deck).split('"dataCtPage"').slice(1);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('dataCtBackground');
    expect(pages[1]).not.toContain('dataCtBackground');
    const first = deck.children[0] as unknown as DeckNode;
    expect(hastBackgrounds(first)).toHaveLength(1);
  });

  it('resolves the still, the poster and a video file of the notebook like any image, and is no link', () => {
    const page = host('## One\n\n::background{video="assets/clip.mp4" poster="images/frame one.png"}\n\ntext\n', 'deck');
    const background = page.querySelector<HTMLElement>('[data-ct-background]')!;
    expect(background.dataset.video).toBe('/raw-assets/slides/assets/clip.mp4');
    const still = background.querySelector('img')!;
    expect(still.getAttribute('src')).toBe('/raw-assets/slides/images/frame%20one.png');
    expect(still.hasAttribute('data-workspace-link')).toBe(false);
    expect(still.hasAttribute('role')).toBe(false);
    expect(still.hasAttribute('tabindex')).toBe(false);
  });

  it('leaves out a still or a video the note cannot name', () => {
    const page = host('## One\n\n::background{video="javascript:alert(1)" poster="javascript:alert(2)"}\n\ntext\n', 'deck');
    const background = page.querySelector<HTMLElement>('[data-ct-background]')!;
    expect(background.hasAttribute('data-video')).toBe(false);
    expect(background.querySelector('img')).toBeNull();
    expect(page.innerHTML).not.toContain('javascript:');
  });

  it.each([['two sources', '::background{image="a.jpg" video="b.mp4"}', '::background takes one source, got image and video', 3], ['no source', '::background{dim=0.5}', '::background needs a source: image="…", video="…", or youtube="…"', 3], ['a dim out of range', '::background{image="a.jpg" dim=2}', '::background dim must be a number from 0 to 1, got "2"', 3], ['a poster on an image', '::background{image="a.jpg" poster="b.jpg"}', '::background poster is for video and youtube, not image', 3], ['an unknown attribute', '::background{image="a.jpg" fit=cover}', 'background has no attribute "fit" (known: image, video, youtube, poster, start, end, dim, position, credit)', 3], ['the wrong form', ':::background', 'background is a leaf directive: write ::background', 3], ['a text directive', ':background{image="a.jpg"}', 'background is a leaf directive: write ::background', 3]])("is refused for %s, with contour-deck's message: an error box in the preview, an error with the line in the deck", (_name, source, message, line) => {
    const note = `## One\n\n${source}\n\nafter`;
    const box = host(note, 'preview').querySelector('.slide-error')!;
    expect(box.querySelector('.ig-error-message')?.textContent).toBe(message);
    expect(box.querySelector('.ig-error-source')?.textContent).toBe(source);
    expect(() => html(note, 'deck')).toThrow(SlideDeckError);
    try {
      html(note, 'deck');
    } catch (error) {
      expect(error).toMatchObject({ message, line });
    }
  });

  it('is refused by the deck for two backgrounds on one page and for one in the notes', () => {
    const failure = (note: string): SlideDeckError => {
      try {
        readDeck(html(note, 'deck'), 'T');
      } catch (error) {
        if (error instanceof SlideDeckError) return error;
        throw error;
      }
      throw new Error('the deck was built');
    };
    expect(failure('## One\n\n::background{image="a.jpg"}\n\n::background{image="b.jpg"}\n')).toMatchObject({ message: 'a page holds two ::background directives', line: 5 });
    expect(failure('## One\n\n:::summary\n::background{image="a.jpg"}\n:::\n')).toMatchObject({ message: '::background inside :::summary: write it outside the notes, on the page', line: 3 });
  });
});

describe('::background in the preview of a type: slide note', () => {
  it('shows the still as a picture with its credit under it, labelled, and plays nothing', () => {
    const figure = host('## One\n\n::background{image="https://example.com/board.jpg" credit="Photo: A. B."}\n', 'preview').querySelector('figure.slide-background')!;
    expect(figure.querySelector('img')?.getAttribute('src')).toBe('https://example.com/board.jpg');
    expect(figure.querySelector('.slide-background-label')?.textContent).toBe('Page background');
    expect(figure.querySelector('.slide-background-credit')?.textContent).toBe('Photo: A. B.');
    expect(figure.querySelector('.slide-background-kind')).toBeNull();
    expect(figure.querySelector('video, iframe')).toBeNull();
  });

  it('shows a video by its poster, and by its kind alone without one', () => {
    const video = host('## One\n\n::background{video="https://example.com/clip.mp4" poster="https://example.com/clip.jpg"}\n', 'preview').querySelector('figure.slide-background')!;
    expect(video.querySelector('img')?.getAttribute('src')).toBe('https://example.com/clip.jpg');
    expect(video.querySelector('.slide-background-kind')?.textContent).toBe('Video');
    const youtube = host('## One\n\n::background{youtube="dQw4w9WgXcQ"}\n', 'preview').querySelector('figure.slide-background')!;
    expect(youtube.querySelector('img')).toBeNull();
    expect(youtube.querySelector('.slide-background-kind')?.textContent).toBe('YouTube');
    expect(youtube.innerHTML).not.toContain('dQw4w9WgXcQ');
  });

  it('writes its label in the language of the page, and takes no step of a build', () => {
    document.documentElement.lang = 'zh-TW';
    try {
      expect(host('## 一\n\n::background{video="https://example.com/c.mp4"}\n', 'preview').querySelector('.slide-background-label')?.textContent).toBe('頁面背景');
    } finally {
      document.documentElement.lang = '';
    }
    const preview = host(':::build\n- a\n\n::background{image="https://example.com/a.jpg"}\n\n- b\n:::\n', 'preview');
    expect([...preview.querySelectorAll('.slide-build-step')].map(step => step.textContent?.trim())).toEqual(['a', 'b']);
  });
});

describe('::background in a note that is no deck', () => {
  it('shows nothing, like ::block and ::slide', () => {
    const note = host('before\n\n::background{image="https://example.com/a.jpg" credit="x"}\n\nafter');
    expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe('before after');
    expect(note.querySelector('img, figure')).toBeNull();
  });

  it('is no deck directive in a code block', () => {
    const preview = host('```md\n::background{image="a.jpg"}\n```\n', 'preview');
    expect(preview.querySelector('figure, .slide-error')).toBeNull();
  });
});
