// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { installDomTooltips } from './dom-tooltips.js';
import { TOOLTIP_DELAY_MS } from './Tooltip.js';

it('shows and dismisses T1 on a dynamically created widget without giving it a native title', () => {
  vi.useFakeTimers();
  const stop = installDomTooltips(document);
  const button = document.createElement('button');
  button.dataset.t1Label = 'Insert table';
  button.setAttribute('aria-label', 'Insert table');
  document.body.append(button);
  try {
    fireEvent.pointerOver(button, { pointerType: 'touch' });
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(screen.getByRole('tooltip').textContent).toBe('Insert table');
    expect(button.getAttribute('title')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    button.focus();
    expect(screen.getByRole('tooltip').textContent).toBe('Insert table');
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  } finally {
    stop();
    button.remove();
    vi.useRealTimers();
  }
});
