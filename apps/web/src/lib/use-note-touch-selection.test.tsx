// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { TouchEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LONG_PRESS_MS } from './use-long-press.js';
import { useNoteTouchSelection } from './use-note-touch-selection.js';
import { TOUCH_NOTE_DROP } from './touch-note-drag.js';

const note = { path: 'notes/one.md' } as NoteListItem;
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], target: document.createElement('div') }) as unknown as TouchEvent;

afterEach(() => vi.useRealTimers());

it('starts selection after a held touch and consumes the following synthetic click', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.onTouchEnd();
  });

  expect(select).toHaveBeenCalledWith(note);
  expect(result.current.consumeClick(note)).toBe(true);
  expect(result.current.consumeClick(note)).toBe(false);
});

it('keeps scrolling a plain scroll by cancelling the held touch', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    result.current.onTouchMove(touch(30, 30));
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });

  expect(select).not.toHaveBeenCalled();
});

it('swallows the synthetic click even if the new toolbar moves another button under the finger', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const wrongAction = vi.fn();
  const button = document.createElement('button');
  button.addEventListener('click', wrongAction);
  document.body.append(button);
  const { result } = renderHook(() => useNoteTouchSelection(select));

  act(() => {
    result.current.onTouchStart(note, touch(10, 10));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    result.current.onTouchEnd();
  });
  button.click();

  expect(select).toHaveBeenCalledOnce();
  expect(wrongAction).not.toHaveBeenCalled();
  button.remove();
});

const fingerEvent = (type: string, x?: number, y?: number, identifier = 1) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { identifier, clientX: x ?? 0, clientY: y ?? 0 };
  Object.defineProperty(event, 'touches', { value: type === 'touchmove' ? [point] : [] });
  Object.defineProperty(event, 'changedTouches', { value: [point] });
  return event;
};
const movable = { path: 'notes/one.md', notebookId: 'life', title: 'One' } as NoteListItem;
/** A touchstart on a row inside the document, with the finger `identifier` 1. */
const pressRow = () => {
  const row = document.createElement('div');
  document.body.append(row);
  const event = { touches: [{ identifier: 1, clientX: 10, clientY: 10 }], target: row, currentTarget: row } as unknown as TouchEvent;
  return { row, event };
};
let target: HTMLElement | undefined;
const dropped = vi.fn();
const putDropTarget = () => {
  target = document.createElement('div');
  target.setAttribute('data-note-drop', '');
  target.addEventListener(TOUCH_NOTE_DROP, event => dropped((event as CustomEvent).detail));
  document.body.append(target);
  document.elementFromPoint = vi.fn((x: number) => x > 50 ? target! : null);
};

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  document.body.replaceChildren();
  dropped.mockReset();
});

it('selects a movable note when the long press lets go without moving', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const { result } = renderHook(() => useNoteTouchSelection(select, true));
  const { row, event } = pressRow();

  act(() => {
    result.current.onTouchStart(movable, event);
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(select).not.toHaveBeenCalled();
  expect(row).toHaveClass('is-lifted');
  act(() => {
    row.dispatchEvent(fingerEvent('touchend'));
  });

  expect(select).toHaveBeenCalledWith(movable);
  expect(row).not.toHaveClass('is-lifted');
  expect(result.current.consumeClick(movable)).toBe(true);
});

it('drags a movable note after the long press onto the drop target under the finger, without scrolling or swiping', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  const swipe = vi.fn();
  document.body.addEventListener('touchmove', swipe);
  putDropTarget();
  const { result } = renderHook(() => useNoteTouchSelection(select, true));
  const { row, event } = pressRow();

  act(() => {
    result.current.onTouchStart(movable, event);
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  const move = fingerEvent('touchmove', 80, 20);
  act(() => {
    row.dispatchEvent(move);
  });
  expect(move.defaultPrevented).toBe(true);
  expect(swipe).not.toHaveBeenCalled();
  expect(document.querySelector('.note-touch-ghost')).not.toBeNull();
  act(() => {
    row.dispatchEvent(fingerEvent('touchend', 80, 20));
  });

  expect(dropped).toHaveBeenCalledWith({ notebookId: 'life', path: 'notes/one.md' });
  expect(select).not.toHaveBeenCalled();
  expect(document.querySelector('.note-touch-ghost')).toBeNull();
  expect(result.current.consumeClick(movable)).toBe(false);
});

it('ignores a second finger and drops nothing when the touch is cancelled', () => {
  vi.useFakeTimers();
  const select = vi.fn();
  putDropTarget();
  const { result } = renderHook(() => useNoteTouchSelection(select, true));
  const { row, event } = pressRow();

  act(() => {
    result.current.onTouchStart(movable, event);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.dispatchEvent(fingerEvent('touchmove', 80, 20));
    row.dispatchEvent(fingerEvent('touchend', 80, 20, 2));
  });
  expect(document.querySelector('.note-touch-ghost')).not.toBeNull();
  act(() => {
    row.dispatchEvent(fingerEvent('touchcancel', 80, 20));
  });

  expect(dropped).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(document.querySelector('.note-touch-ghost')).toBeNull();
});

it('removes the chip and stops following the finger when the row goes away mid-drag', () => {
  vi.useFakeTimers();
  putDropTarget();
  const { result, unmount } = renderHook(() => useNoteTouchSelection(vi.fn(), true));
  const { row, event } = pressRow();

  act(() => {
    result.current.onTouchStart(movable, event);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    row.dispatchEvent(fingerEvent('touchmove', 80, 20));
  });
  unmount();
  const move = fingerEvent('touchmove', 90, 20);
  row.dispatchEvent(move);
  row.dispatchEvent(fingerEvent('touchend', 90, 20));

  expect(document.querySelector('.note-touch-ghost')).toBeNull();
  expect(move.defaultPrevented).toBe(false);
  expect(dropped).not.toHaveBeenCalled();
});
