// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { BookChapter } from './book-chapters.js';
import { chapterOfAnchor, pagingKey, resolvePage, swipeStartsHere, swipeStep } from './book-paging.js';

const chapter = (id: string): BookChapter => ({ id, anchor: `chapter:${id}`, kind: 'note', title: id, missing: false, item: { id, kind: 'note', notebookId: 'nb', path: `${id}.md` } });
const chapters = ['a', 'b', 'c'].map(chapter);

afterEach(() => void (document.body.innerHTML = ''));

it('resolves a page by chapter id, and keeps the position when its chapter has left the book', () => {
  expect(resolvePage(chapters, 'b')).toBe(1);
  expect(resolvePage(chapters, null)).toBe(0);
  expect(resolvePage(chapters, 'gone', 2)).toBe(2);
  expect(resolvePage(chapters, 'gone', 9)).toBe(2);
  expect(resolvePage([], 'a', 3)).toBe(0);
});

it('finds the chapter of a contents anchor, including a folder note section', () => {
  expect(chapterOfAnchor(chapters, 'chapter:b')?.id).toBe('b');
  expect(chapterOfAnchor(chapters, 'chapter:c/notes/x.md')?.id).toBe('c');
  expect(chapterOfAnchor(chapters, 'chapter:zz')).toBeUndefined();
});

it('takes a swipe for a page turn only when it is long, quick and mostly horizontal', () => {
  expect(swipeStep(-80, 10, 200)).toBe('next');
  expect(swipeStep(80, -10, 200)).toBe('previous');
  expect(swipeStep(-40, 0, 200)).toBeNull();
  expect(swipeStep(-90, 80, 200)).toBeNull();
  expect(swipeStep(-90, 0, 1500)).toBeNull();
});

const press = (target: EventTarget, init: KeyboardEventInit) => {
  let seen: KeyboardEvent | undefined;
  target.addEventListener('keydown', event => void (seen = event as KeyboardEvent), { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  return pagingKey(seen!);
};

it('turns the page on ← and → alone, never in a text field, a widget that uses the arrows or a key scope', () => {
  expect(press(document.body, { key: 'ArrowRight' })).toBe('next');
  expect(press(document.body, { key: 'ArrowLeft' })).toBe('previous');
  expect(press(document.body, { key: 'ArrowUp' })).toBeNull();
  expect(press(document.body, { key: 'ArrowRight', altKey: true })).toBeNull();
  expect(press(document.body, { key: 'ArrowRight', shiftKey: true })).toBeNull();
  expect(press(document.body, { key: 'ArrowRight', isComposing: true })).toBeNull();
  document.body.innerHTML = '<input id="i"><div role="tablist"><button id="t" role="tab">x</button></div><div data-key-scope="markdown-editor"><button id="s">y</button></div><button id="b">ok</button>';
  expect(press(document.getElementById('i')!, { key: 'ArrowRight' })).toBeNull();
  expect(press(document.getElementById('t')!, { key: 'ArrowRight' })).toBeNull();
  expect(press(document.getElementById('s')!, { key: 'ArrowRight' })).toBeNull();
  expect(press(document.getElementById('b')!, { key: 'ArrowRight' })).toBe('next');
});

it('leaves ← and → to a wide table or code block that scrolls sideways, even inside the book', () => {
  document.body.innerHTML = '<section class="compilation-book-view"><div class="compilation-book"><div id="table" class="markdown-table-scroll" tabindex="0" style="overflow-x:auto"><span id="cell">cell</span></div><p id="plain">text</p></div></section>';
  const table = document.getElementById('table')!;
  Object.defineProperty(table, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(table, 'clientWidth', { value: 300, configurable: true });
  expect(press(table, { key: 'ArrowRight' })).toBeNull();
  expect(press(document.getElementById('cell')!, { key: 'ArrowLeft' })).toBeNull();
  // The book's own body may be wider than it shows without taking the keys from the page.
  const body = document.querySelector('.compilation-book') as HTMLElement;
  body.style.overflowX = 'auto';
  Object.defineProperty(body, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(body, 'clientWidth', { value: 300, configurable: true });
  expect(press(document.getElementById('plain')!, { key: 'ArrowRight' })).toBe('next');
});

it('does not start a swipe in an editor, a section being edited or a block that scrolls sideways', () => {
  document.body.innerHTML = '<div id="body"><p id="p">text</p><section data-editing><p id="e">edit</p></section><div id="wide" style="overflow-x:auto"><span id="w">wide</span></div><textarea id="t"></textarea></div>';
  expect(swipeStartsHere(document.getElementById('p'))).toBe(true);
  expect(swipeStartsHere(document.getElementById('e'))).toBe(false);
  expect(swipeStartsHere(document.getElementById('t'))).toBe(false);
  const wide = document.getElementById('wide')!;
  Object.defineProperty(wide, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(wide, 'clientWidth', { value: 300, configurable: true });
  expect(swipeStartsHere(document.getElementById('w'))).toBe(false);
});
