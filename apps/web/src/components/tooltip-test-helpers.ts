import { act, fireEvent, screen } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { TOOLTIP_DELAY_MS } from './Tooltip.js';

/** Exercise the actual pointer-triggered tooltip, without waiting on wall time. */
export function tooltipText(trigger: Element | null) {
  expect(trigger).toBeTruthy();
  const alreadyFake = vi.isFakeTimers();
  if (!alreadyFake) vi.useFakeTimers();
  try {
    fireEvent.pointerEnter(trigger!, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
    const bubble = screen.getByRole('tooltip');
    const label = bubble.querySelector('.tooltip-label')?.textContent ?? '';
    const detail = bubble.querySelector('.tooltip-detail')?.textContent;
    return detail ? `${label} ${detail}` : label;
  } finally {
    fireEvent.pointerLeave(trigger!, { pointerType: 'mouse' });
    if (!alreadyFake) vi.useRealTimers();
  }
}
