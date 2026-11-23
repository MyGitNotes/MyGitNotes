// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { Tooltip, TOOLTIP_DELAY_MS } from './Tooltip.js';

beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts cold: no tooltip was shown in the last moment.
  vi.setSystemTime(Date.now() + 60_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const hover = (element: Element, pointerType = 'mouse') => fireEvent.pointerEnter(element, { pointerType });

function setup(onClick = vi.fn()) {
  const ref = createRef<HTMLButtonElement>();
  render(
    <Tooltip label='Search' detail='⌘K' side='right'>
      <button ref={ref} type='button' aria-label='Search notes' aria-describedby='own-hint' onClick={onClick}>S</button>
    </Tooltip>,
  );
  return { ref, button: screen.getByRole('button', { name: 'Search notes' }), onClick };
}

it('shows a one-line bubble with the label and the muted detail after the hover delay, and describes the trigger by it', () => {
  const { button } = setup();
  hover(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveTextContent('Search⌘K');
  expect(tip.querySelector('.tooltip-detail')).toHaveTextContent('⌘K');
  expect(button.getAttribute('aria-describedby')!.split(' ')).toEqual(['own-hint', tip.id]);
  expect(button).not.toHaveAttribute('title');
  expect(button).toHaveAccessibleName('Search notes');
});

it('hides when the pointer leaves or presses, and keeps the trigger working', () => {
  const { button, onClick, ref } = setup();
  expect(ref.current).toBe(button);
  hover(button);
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
  fireEvent.pointerLeave(button, { pointerType: 'mouse' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(button).toHaveAttribute('aria-describedby', 'own-hint');
  hover(button);
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
  fireEvent.pointerDown(button, { pointerType: 'mouse' });
  fireEvent.click(button);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('shows a second tooltip at once while the first has just closed', () => {
  render(
    <>
      <Tooltip label='One'>
        <button type='button'>1</button>
      </Tooltip>
      <Tooltip label='Two'>
        <button type='button'>2</button>
      </Tooltip>
    </>,
  );
  hover(screen.getByText('1'));
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
  fireEvent.pointerLeave(screen.getByText('1'), { pointerType: 'mouse' });
  hover(screen.getByText('2'));
  expect(screen.getByRole('tooltip')).toHaveTextContent('Two');
});

it('never shows for a touch', () => {
  const { button } = setup();
  hover(button, 'touch');
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('shows at once on keyboard focus, and hides on Escape or blur', () => {
  const { button } = setup();
  fireEvent.keyDown(document.body, { key: 'Tab' });
  act(() => button.focus());
  expect(screen.getByRole('tooltip')).toHaveTextContent('Search');
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => button.blur());
  fireEvent.keyDown(document.body, { key: 'Tab' });
  act(() => button.focus());
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  act(() => button.blur());
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('stays hidden when focus follows a pointer press', () => {
  const { button } = setup();
  fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
  act(() => button.focus());
  act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
