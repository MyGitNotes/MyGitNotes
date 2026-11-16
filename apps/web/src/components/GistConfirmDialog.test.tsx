// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useGistConfirm } from './GistConfirmDialog.js';
import { I18nProvider } from '../lib/i18n/index.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Harness({ onAnswer }: { onAnswer: (publish: boolean) => void; }) {
  const { confirmGists, gistConfirmDialog } = useGistConfirm();
  return (
    <>
      <button type='button' onClick={() => void confirmGists([{ path: 'notes/life/private.md', gist: 'victim' }]).then(onAnswer)}>commit</button>
      {gistConfirmDialog}
    </>
  );
}

const open = () => {
  const onAnswer = vi.fn();
  render(<I18nProvider><Harness onAnswer={onAnswer} /></I18nProvider>);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByText('commit'));
  return onAnswer;
};

it('names the note and the Gist it would go to, and answers publish', async () => {
  const onAnswer = open();
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('notes/life/private.md');
  expect(dialog.textContent).toContain('victim');
  expect(dialog.textContent).toMatch(/did not create|changed last/);
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it("answers don't publish, as closing the dialog does", async () => {
  const onAnswer = open();
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: "Don't publish" }));
  await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  fireEvent.click(screen.getByText('commit'));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(false));
  expect(onAnswer).toHaveBeenCalledTimes(2);
});

it('asks in Traditional Chinese', async () => {
  localStorage.setItem('github-notes:language', 'zh-TW');
  open();
  const dialog = await screen.findByRole('dialog');
  expect(dialog.textContent).toContain('victim');
  expect(screen.getByRole('button', { name: '發佈' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '不要發佈' })).toBeTruthy();
});
