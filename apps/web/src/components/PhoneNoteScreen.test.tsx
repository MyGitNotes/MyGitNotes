// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EDGE_BACK_SETTLE_MS } from '../lib/edge-back.js';
import { PhoneNotesProvider } from '../lib/phone-notes.js';
import { PhoneNoteScreen } from './PhoneNoteScreen.js';

const WIDTH = 390;
let back = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  back = vi.fn();
  render(
    <PhoneNotesProvider value={{ back, changesCount: 0 }}>
      <PhoneNoteScreen
        list={() => (
          <ul aria-label='Notes'>
            <li>A note</li>
          </ul>
        )}
      >
        <article>
          <p id='text'>Note text</p>
          <input id='field' aria-label='Title' />
          <div className='compilation-book'>
            <p id='book'>Page</p>
          </div>
        </article>
      </PhoneNoteScreen>
    </PhoneNotesProvider>,
  );
  const root = document.querySelector<HTMLElement>('.phone-note-screen')!;
  root.getBoundingClientRect = () => ({ left: 0, width: WIDTH, top: 0, height: 800, right: WIDTH, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const root = () => document.querySelector<HTMLElement>('.phone-note-screen')!;

function fire(target: Element, type: string, x?: number, y = 300) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: x === undefined ? [] : [{ clientX: x, clientY: y }] });
  act(() => void target.dispatchEvent(event));
  return event;
}

/** A finger from x, moved to x + dx (through the middle) and held there, not yet lifted. */
function pull(id: string, x: number, dx: number, dy = 0) {
  const target = document.getElementById(id)!;
  fire(target, 'touchstart', x);
  fire(target, 'touchmove', x + dx / 2, 300 + dy / 2);
  return fire(target, 'touchmove', x + dx, 300 + dy);
}

describe("a phone note's left edge", () => {
  it('pulls the note right with the finger, showing the list under it a sixth as fast', () => {
    const move = pull('text', 10, 156);
    expect(move.defaultPrevented).toBe(true);
    expect(root()).toHaveAttribute('data-edge-back', 'dragging');
    expect(root().style.getPropertyValue('--edge-back-note')).toBe('156px');
    expect(root().style.getPropertyValue('--edge-back-list')).toBe('-39px');
    expect(screen.getByRole('list', { name: 'Notes', hidden: true })).toBeInTheDocument();
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back to the list when let go past a third of the screen, once the note has slid out', () => {
    pull('text', 10, WIDTH / 3 + 10);
    fire(document.getElementById('text')!, 'touchend');
    expect(root()).toHaveAttribute('data-edge-back', 'leaving');
    expect(root().style.getPropertyValue('--edge-back-note')).toBe(`${WIDTH}px`);
    expect(back).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(EDGE_BACK_SETTLE_MS));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('returns the note when let go short of a third, and the list under it goes', () => {
    pull('text', 10, WIDTH / 3 - 10);
    fire(document.getElementById('text')!, 'touchend');
    expect(root()).toHaveAttribute('data-edge-back', 'returning');
    expect(root().style.getPropertyValue('--edge-back-note')).toBe('0px');
    act(() => void vi.advanceTimersByTime(EDGE_BACK_SETTLE_MS));
    expect(root()).not.toHaveAttribute('data-edge-back');
    expect(screen.queryByRole('list', { name: 'Notes', hidden: true })).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it('leaves a touch past the 24 px edge, a scroll and a leftward move to the note', () => {
    pull('text', 40, 200);
    fire(document.getElementById('text')!, 'touchend');
    pull('text', 10, 20, 200);
    fire(document.getElementById('text')!, 'touchend');
    pull('text', 20, -100);
    fire(document.getElementById('text')!, 'touchend');
    expect(root()).not.toHaveAttribute('data-edge-back');
    act(() => void vi.advanceTimersByTime(EDGE_BACK_SETTLE_MS));
    expect(back).not.toHaveBeenCalled();
  });

  it('leaves fields and the Book their own moves, and starts nothing under an open sheet', () => {
    pull('field', 10, 200);
    pull('book', 10, 200);
    document.body.insertAdjacentHTML('beforeend', "<div class='phone-sheet-layer'></div>");
    pull('text', 10, 200);
    expect(root()).not.toHaveAttribute('data-edge-back');
  });
});
