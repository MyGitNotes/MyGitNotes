// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { textareaOffsetAt } from './textarea-caret.js';

/** Gives the test document the hit test jsdom lacks, or takes it away again. */
const hitTest = (test?: () => Range | null) => test ? Object.defineProperty(document, 'caretRangeFromPoint', { value: test, configurable: true }) : Reflect.deleteProperty(document, 'caretRangeFromPoint');

afterEach(() => {
  hitTest();
  document.body.replaceChildren();
});

const area = (value: string) => {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('wrap', 'off');
  document.body.append(textarea);
  return textarea;
};

it('hit-tests a copy of the text laid over the textarea, and takes the copy away', () => {
  const textarea = area('one\ntwo');
  let mirror: HTMLElement | null = null;
  hitTest(() => {
    mirror = document.body.lastElementChild as HTMLElement;
    const range = document.createRange();
    range.setStart(mirror.firstChild!, 5);
    return range;
  });
  expect(textareaOffsetAt(textarea, 10, 20)).toBe(5);
  expect(mirror!.textContent).toBe('one\ntwo\n');
  expect(mirror!.style.whiteSpace).toBe('pre');
  expect(mirror!.isConnected).toBe(false);
});

it('keeps the offset within the text, and answers null for a point off it or without a hit test', () => {
  const textarea = area('one');
  hitTest(() => {
    const range = document.createRange();
    range.setStart(document.body.lastElementChild!.firstChild!, 4);
    return range;
  });
  expect(textareaOffsetAt(textarea, 10, 20)).toBe(3);
  hitTest(() => {
    const range = document.createRange();
    range.setStart(document.body, 0);
    return range;
  });
  expect(textareaOffsetAt(textarea, 10, 20)).toBeNull();
  hitTest();
  expect(textareaOffsetAt(textarea, 10, 20)).toBeNull();
});
