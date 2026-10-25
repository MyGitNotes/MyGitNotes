// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { PhoneSheet } from './PhoneSheet.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  // The page the sheet covers; jsdom has no `inert`, so the attribute is what is checked.
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
});
afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  window.localStorage.clear();
});

function Harness({ onClose = () => {} }: { onClose?: () => void; }) {
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <button type='button' onClick={() => setOpen(true)}>Open sheet</button>
      {open && (
        <PhoneSheet
          title='Note menu'
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type='button'>First action</button>
          <input aria-label='Field' />
          <button type='button'>Last action</button>
        </PhoneSheet>
      )}
    </I18nProvider>
  );
}

const open = () => {
  const trigger = screen.getByRole('button', { name: 'Open sheet' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

it('opens as a modal dialog with focus inside it and the page behind inert', () => {
  render(<Harness />);
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  const dialog = screen.getByRole('dialog', { name: 'Note menu' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveFocus();
  expect(document.getElementById('root')).toHaveAttribute('inert');
});

it('closes on Escape and returns focus to what opened it, leaving the page live again', () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  const trigger = open();
  fireEvent.keyDown(screen.getByRole('button', { name: 'First action' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  expect(document.getElementById('root')).not.toHaveAttribute('inert');
});

it('closes on a tap of the backdrop and on its close button', () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  open();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  expect(screen.queryByRole('dialog')).toBeNull();
  open();
  fireEvent.click(screen.getByRole('dialog').querySelector('.phone-sheet-top button[aria-label="Close"]')!);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('keeps Tab and Shift+Tab inside the sheet', () => {
  render(<Harness />);
  open();
  const dialog = screen.getByRole('dialog');
  const first = screen.getAllByRole('button', { name: 'Close' }).find(button => dialog.contains(button) && button.closest('.phone-sheet-heading'))!;
  const last = screen.getByRole('button', { name: 'Last action' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
  // Shift+Tab from the sheet itself, where focus starts, also wraps to the last control.
  dialog.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
});

it('closes when the grip is dragged down past the threshold, and stays open for a short drag', () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  open();
  const grip = screen.getByTestId('phone-sheet-grip');
  fireEvent.pointerDown(grip, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientY: 440, pointerId: 1 });
  expect(screen.getByRole('dialog')).toHaveStyle({ transform: 'translateY(40px)' });
  fireEvent.pointerUp(grip, { clientY: 440, pointerId: 1 });
  expect(onClose).not.toHaveBeenCalled();
  expect((screen.getByRole('dialog') as HTMLElement).style.transform).toBe('');
  fireEvent.pointerDown(grip, { clientY: 400, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientY: 520, pointerId: 1 });
  fireEvent.pointerUp(grip, { clientY: 520, pointerId: 1 });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('leaves the Escape of a menu opened from the sheet to that menu', () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  open();
  const outside = document.createElement('button');
  document.body.append(outside);
  act(() => outside.focus());
  fireEvent.keyDown(outside, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  outside.remove();
});
