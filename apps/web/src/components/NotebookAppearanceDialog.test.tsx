// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import type { NotebookAppearance } from '../lib/notebook-appearance.js';
import { NotebookAppearanceDialog } from './NotebookAppearanceDialog.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

async function open(notebook: { title: string; icon?: string; color?: NotebookAppearance['color']; } = { title: 'SOS-02' }) {
  const onSave = vi.fn(async (_appearance: NotebookAppearance) => {});
  const onClose = vi.fn();
  render(
    <I18nProvider>
      <NotebookAppearanceDialog notebook={notebook} onSave={onSave} onClose={onClose} />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  return { onSave, onClose, dialog: screen.getByRole('dialog', { name: 'Notebook appearance' }) };
}
const preview = () => document.querySelector('.notebook-appearance-preview')!;

it('picks an icon found by its English name and a colour, previews them, and saves both with Done', async () => {
  const { onSave, onClose } = await open();
  // Nothing is chosen yet, so no icon reads as selected.
  expect(screen.queryAllByRole('option', { selected: true })).toHaveLength(0);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), { target: { value: 'dice 5' } });
  fireEvent.click(screen.getByRole('option', { name: 'Dice5' }));
  expect(screen.getByRole('option', { name: 'Dice5' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Color/ })).getByRole('radio', { name: 'Red' }));
  expect(preview().querySelector('.notebook-mark')).toHaveAttribute('data-color', 'red');
  expect(preview().querySelector('.notebook-mark')).toHaveAttribute('data-state', 'icon');
  expect(screen.getByText('icon: dice-5 · color: red', { exact: false })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ icon: 'dice-5', color: 'red' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it('starts from the notebook’s current appearance', async () => {
  await open({ title: 'CoC', icon: 'book-open', color: 'blue' });
  expect(within(screen.getByRole('radiogroup', { name: /Color/ })).getByRole('radio', { name: 'Blue' })).toBeChecked();
  expect(screen.getByRole('option', { name: 'BookOpen' })).toHaveAttribute('aria-selected', 'true');
});

it('clears back to the initial, which Done saves as no icon and no colour', async () => {
  const { onSave } = await open({ title: 'CoC', icon: 'book-open', color: 'blue' });
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(preview().querySelector('.notebook-mark')).toBeNull();
  expect(preview()).toHaveTextContent('C');
  expect(within(screen.getByRole('radiogroup', { name: /Color/ })).getByRole('radio', { name: 'None' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({}));
});

it('picking the chosen icon again takes it off', async () => {
  const { onSave } = await open({ title: 'CoC', icon: 'book-open', color: 'blue' });
  fireEvent.click(screen.getByRole('option', { name: 'BookOpen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ color: 'blue' }));
});

it('closes without writing when nothing changed, and keeps the dialog open with the reason when the save fails', async () => {
  const first = await open({ title: 'CoC', color: 'blue' });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(first.onSave).not.toHaveBeenCalled();
  expect(first.onClose).toHaveBeenCalled();
  cleanup();
  const second = await open({ title: 'CoC' });
  second.onSave.mockRejectedValueOnce(new Error('The manifest changed'));
  fireEvent.click(within(screen.getByRole('radiogroup', { name: /Color/ })).getByRole('radio', { name: 'Green' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The manifest changed');
  expect(second.onClose).not.toHaveBeenCalled();
});
