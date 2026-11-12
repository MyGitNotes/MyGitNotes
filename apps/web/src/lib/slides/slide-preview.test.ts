// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { renderNote } from '../markdown.js';
import { SlideDeckError } from './errors.js';
import { readDeck } from './deck.js';

/** The note's rendered HTML as a document: a slide note's preview, its deck markup, or (without `slides`) any other note. */
function render(markdown: string, slides?: 'preview' | 'deck'): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderNote(markdown, 'slides/deck.md', undefined, undefined, undefined, slides ? { slides } : undefined);
  return host;
}

afterEach(() => {
  document.documentElement.lang = '';
});

describe('the preview of a type: slide note', () => {
  it('shows a build as its content, with every step marked: list items, table body rows, and any other block', () => {
    const preview = render(':::build\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nA paragraph.\n:::', 'preview');
    const build = preview.querySelector('.slide-build')!;
    expect(build.querySelector('.directive-title')).toBeNull();
    expect(preview.textContent).not.toContain('BUILD');
    expect([...build.querySelectorAll('.slide-build-step')].map(step => `${step.tagName}:${step.textContent?.replace(/\s+/g, ' ').trim()}`)).toEqual(['LI:one', 'LI:two', 'TR:1 2', 'TR:3 4', 'P:A paragraph.']);
  });

  it('labels each --- with the block that ends there, each ## with the slide and each ### with the page it heads', () => {
    const preview = render('## One\n\ntext\n\n### Two\n\nsecond page\n\n---\n\n## Three\n', 'preview');
    expect([...preview.querySelectorAll('hr')].map(rule => [rule.className, rule.getAttribute('data-label')])).toEqual([['slide-break', 'Block 1']]);
    expect([...preview.querySelectorAll('h2, h3')].map(heading => [heading.className, heading.getAttribute('data-label')])).toEqual([['slide-heading', 'Slide 1'], ['slide-heading', 'Page 1.2'], ['slide-heading', 'Slide 2']]);
  });

  it('writes the labels in the language of the page', () => {
    document.documentElement.lang = 'zh-TW';
    const preview = render('## 一\n\n內文\n\n### 二\n\n---\n\n## 三\n\n:::summary\n講稿內容\n:::\n\n::block{title="三、主要問題" minutes=5}\n', 'preview');
    expect([...preview.querySelectorAll('hr, h2, h3')].map(element => element.getAttribute('data-label'))).toEqual(['投影片 1', '頁 1.2', '區塊 1', '投影片 2']);
    expect(preview.querySelector('.slide-notes-label')?.textContent).toBe('講稿');
    expect(preview.querySelector('.slide-block-minutes')?.textContent).toBe('約 5 分');
  });

  it('draws a summary as a box labelled Notes', () => {
    const notes = render(':::summary\nSay **this** aloud.\n:::', 'preview').querySelector('aside.slide-notes')!;
    expect(notes.getAttribute('data-type')).toBe('summary');
    expect(notes.querySelector('.slide-notes-label')?.textContent).toBe('Notes');
    expect(notes.querySelector('.slide-notes-body')?.innerHTML).toContain('<strong>this</strong>');
  });

  it('draws a ::block as a title bar with its title and minutes', () => {
    const bar = render('::block{title="三、主要問題" minutes=5 short=三 kind=appendix #main}\n\n## A slide\n', 'preview').querySelector('.slide-block-title')!;
    expect(bar.querySelector('.slide-block-name')?.textContent).toBe('三、主要問題');
    expect(bar.querySelector('.slide-block-minutes')?.textContent).toBe('5 min');
    expect(render('::block{title="No minutes"}\n', 'preview').querySelector('.slide-block-minutes')).toBeNull();
  });

  it('gives a ::slide no room and no text', () => {
    const preview = render('::slide{#dilemma}\n\n## A slide\n', 'preview');
    expect(preview.querySelector('.slide-anchor')?.childNodes).toHaveLength(0);
    expect(preview.textContent).not.toContain('dilemma');
    expect(preview.textContent).not.toContain('::slide');
  });

  it('keeps the new markup to classes, data-type and data-label', () => {
    const preview = render('::block{title="A" minutes=5}\n\n::slide{#x}\n\n## One\n\n:::build\n- a\n:::\n\n:::summary\nnotes\n:::\n\n### Two\n\nmore\n\n---\n\n::summary\n', 'preview');
    const slideElements = preview.querySelectorAll('[class^="slide-"], [class*=" slide-"], hr');
    expect(slideElements.length).toBeGreaterThan(8);
    // Every heading of a note carries its slug, slide note or not.
    for (const element of slideElements) expect(element.getAttributeNames().filter(name => !['class', 'data-type', 'data-label', 'aria-label', 'role', ...(/^H[23]$/.test(element.tagName) ? ['data-heading-slug'] : [])].includes(name))).toEqual([]);
  });

  it.each([['a container written as a leaf', '::summary', 'summary is a container directive: write :::summary … :::'], ['a build written as a leaf', '::build', 'build is a container directive: write :::build … :::'], ['a leaf written as a container', ':::vertical', 'vertical is a leaf directive: write ::vertical'], ['a block written as a container', ':::block{title="A"}', 'block is a leaf directive: write ::block'], ['a directive written in a line of text', ':slide', 'slide is a leaf directive: write ::slide'], ['an unknown attribute', '::vertical{align=top}', 'vertical has no attribute "align" (known: none)'], ['an unknown attribute of a block', '::block{title="A" colour=red}', 'block has no attribute "colour" (known: title, short, minutes, kind, id)'], ['minutes that are no number', '::block{title="A" minutes=soon}', '::block minutes must be a positive number, got "soon"'], ['a slide without an id', '::slide', '::slide needs an id: ::slide{#dilemma}']])('shows an error box for %s', (_what, source, message) => {
    const preview = render(`## A slide\n\n${source}\n\nafter`, 'preview');
    const box = preview.querySelector('.slide-error')!;
    expect(box.getAttribute('role')).toBe('alert');
    expect(box.querySelector('.ig-error-title')?.textContent).toBe('This slide directive cannot be read');
    expect(box.querySelector('.ig-error-message')?.textContent).toBe(message);
    expect(box.querySelector('.ig-error-source')?.textContent).toBe(source);
    expect(preview.textContent).toContain('after');
  });

  it('shows an error box in place of a container with an attribute contour-deck does not know, with its source', () => {
    const box = render(':::summary{slide=2}\nnotes\n:::', 'preview').querySelector('.slide-error')!;
    expect(box.querySelector('.ig-error-message')?.textContent).toBe('summary has no attribute "slide" (known: none)');
    expect(box.querySelector('.ig-error-source')?.textContent).toBe(':::summary{slide=2}\nnotes\n:::');
  });

  it('keeps a source with a blank line whole in its error box, its Markdown unread', () => {
    const preview = render(':::summary{foo=bar}\nline one\n\n[x](https://e.com) **bold**\n:::\n\nafter', 'preview');
    const box = preview.querySelector('.slide-error')!;
    expect(box.querySelector('.ig-error-source')?.textContent).toBe(':::summary{foo=bar}\nline one\n\n[x](https://e.com) **bold**\n:::');
    expect(box.querySelector('a, strong')).toBeNull();
    expect(preview.lastElementChild?.textContent).toBe('after');
  });

  it('reads no directive inside a code block', () => {
    const preview = render('```md\n::vertical\n\n:::build\n- a\n:::\n\n::summary\n```\n', 'preview');
    expect(preview.querySelector('hr, .slide-build, .slide-error')).toBeNull();
    expect(preview.querySelector('code')?.textContent).toBe('::vertical\n\n:::build\n- a\n:::\n\n::summary\n');
  });
});

describe('a note that is no deck', () => {
  it('keeps the rendering of ---, ::vertical and :::summary', () => {
    const note = render('one\n\n---\n\ntwo\n\n::vertical\n\n:::summary\nnotes\n:::\n');
    expect([...note.querySelectorAll('hr')].map(rule => [rule.className, rule.getAttribute('data-label')])).toEqual([['', null], ['vertical-slide-break', null]]);
    expect(note.querySelector('.slide-summary')?.textContent?.trim()).toBe('notes');
    expect(note.querySelector('.slide-notes')).toBeNull();
  });

  it('shows a build as its content, without a box, a title or step numbers', () => {
    const note = render(':::build\n- one\n- two\n:::');
    expect(note.querySelector('.generic-directive, .directive-title, .slide-build-step')).toBeNull();
    expect(note.textContent).not.toContain('BUILD');
    expect([...note.querySelectorAll('.slide-build li')].map(item => item.textContent)).toEqual(['one', 'two']);
  });

  it('shows nothing for ::block and ::slide', () => {
    const note = render('before\n\n::block{title="A" minutes=5}\n\n::slide{#x}\n\nafter');
    expect(note.textContent?.replace(/\s+/g, ' ').trim()).toBe('before after');
  });

  it('has no error box for a slide directive in the wrong form', () => {
    const note = render('::summary\n\n::block{minutes=5}\n\n:slide\n');
    expect(note.querySelector('.slide-error')).toBeNull();
  });

  it('reads no directive inside a code block', () => {
    const note = render('```md\n:::info\nhi\n:::\n\n::vertical\n```\n');
    expect(note.querySelector('.custom-directive, hr')).toBeNull();
    expect(note.querySelector('code')?.textContent).toBe(':::info\nhi\n:::\n\n::vertical\n');
  });
});

describe('the deck of a type: slide note', () => {
  const deckOf = (markdown: string) => readDeck(renderNote(markdown, 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck' }), 'Deck');
  /** The failure building the deck throws. */
  function failure(markdown: string): SlideDeckError {
    try {
      deckOf(markdown);
    } catch (error) {
      if (error instanceof SlideDeckError) return error;
      throw error;
    }
    throw new Error('the deck was built');
  }

  it('is refused with the message and the line of a directive in the wrong form', () => {
    expect(failure('## A slide\n\n::summary\n')).toMatchObject({ message: 'summary is a container directive: write :::summary … :::', line: 3 });
    expect(failure('## A\n\ntext\n\n---\n\n:::vertical\n:::\n')).toMatchObject({ message: 'vertical is a leaf directive: write ::vertical', line: 7 });
    expect(failure('## A\n\n:::summary{slide=1}\nnotes\n:::\n')).toMatchObject({ message: 'summary has no attribute "slide" (known: none)', line: 3 });
    expect(failure('## A\n\n::::grid\n:::cell\n::build\n:::\n::::\n')).toMatchObject({ message: 'build is a container directive: write :::build … :::', line: 4 });
  });

  it('is refused with the message and the line of a structure contour-deck cannot build', () => {
    expect(failure('::block{title="A"}\n\n::block{title="B"}\n\n## A slide\n')).toMatchObject({ message: 'a block holds two ::block directives', line: 3 });
    expect(failure('## A slide\n\n:::info\n::slide{#x}\n:::\n')).toMatchObject({ message: '::slide must stand at the top level of a slide, not inside another element', line: 3 });
    expect(failure('## A slide\n\n---\n\n::block{title="Last"}\n')).toMatchObject({ message: '::block stands in a block with no slide', line: 5 });
    expect(failure('## A\n\ntext\n\n::slide{#x}\n\n## B\n')).toMatchObject({ message: "::slide{#x} stands between a slide's content and the next ##: write it under the heading of its own slide", line: 5 });
  });

  it('is refused when the sanitizer takes a slide id that would shadow a property of the page', () => {
    expect(failure('::slide{#title}\n\n## A slide\n')).toMatchObject({ line: 1 });
    expect(failure('::slide{#title}\n\n## A slide\n').message).toMatch(/id/);
  });

  it('holds no directive of an indented code block', () => {
    const html = renderNote('## A\n\ntext\n\n    :::vertical\n    :::summary\n    notes\n    :::\n', 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck' });
    expect(html).not.toContain('data-ct-');
    expect(() => readDeck(html, 'Deck')).not.toThrow();
  });

  it('holds no directive of a code block', () => {
    const html = renderNote('## A\n\n```md\n::vertical\n::summary\n```\n', 'slides/deck.md', undefined, undefined, undefined, { slides: 'deck' });
    expect(html).not.toContain('data-ct-mark');
    expect(() => readDeck(html, 'Deck')).not.toThrow();
  });
});

describe('a slide note, read by its headings whatever its slideOptions.structure says', () => {
  const NO_VERTICAL = '::vertical has no meaning with structure: "headings": start the next page with a ### heading';
  const failure = (run: () => unknown): SlideDeckError => {
    try {
      run();
    } catch (error) {
      if (error instanceof SlideDeckError) return error;
      throw error;
    }
    throw new Error('the deck was built');
  };

  it('shows an error box for ::vertical, with what contour-deck says to write, and keeps the rest of the note', () => {
    const preview = render('## One\n\ntext\n\n::vertical\n\n### Two\n\nmore', 'preview');
    expect(preview.querySelector('.slide-error .ig-error-message')?.textContent).toBe(NO_VERTICAL);
    expect(preview.querySelector('.slide-error .ig-error-source')?.textContent).toBe('::vertical');
    expect(preview.querySelector('hr')).toBeNull();
    expect([...preview.querySelectorAll('h2, h3')].map(heading => heading.getAttribute('data-label'))).toEqual(['Slide 1', 'Page 1.2']);
  });

  it('does not build a deck from a note with ::vertical, and names its line', () => {
    const error = failure(() => render('## One\n\ntext\n\n::vertical\n\n### Two', 'deck'));
    expect(error.message).toBe(NO_VERTICAL);
    expect(error.line).toBe(5);
  });

  it('takes a ::block without a title, which only sets what it names, and still refuses an empty one', () => {
    const preview = render('::block{minutes=5}\n\n#### Kicker\n\n## One', 'preview');
    expect(preview.querySelector('.slide-error')).toBeNull();
    expect(preview.querySelector('.slide-block-title')?.textContent).toBe('Block5 min');
    expect(preview.querySelector('.slide-block-name')).toBeNull();
    expect(render('::block{title="Named"}\n\n## One', 'preview').querySelector('.slide-block-name')?.textContent).toBe('Named');
    expect(render('::block{title=""}\n\n## One', 'preview').querySelector('.slide-error .ig-error-message')?.textContent).toBe('::block title is empty: leave it out to title the block by its heading');
  });
});
