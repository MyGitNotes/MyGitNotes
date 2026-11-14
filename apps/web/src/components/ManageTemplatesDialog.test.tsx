// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import type { NoteTemplateInfo } from '../lib/note-templates.js';
import { ManageTemplatesDialog } from './ManageTemplatesDialog.js';

beforeEach(() => {
  // jsdom has no modal dialogs; the dialog only needs to be open.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const templates: NoteTemplateInfo[] = [{ notebookId: 'qa~ex', id: 'registered', name: 'Registered', source: 'manifest', file: 'notes/ex/kept/registered.md', placeholders: [] }, { notebookId: 'qa~ex', id: 'reading', name: '讀書筆記', description: '讀完一本書的摘要與心得', source: 'file', file: 'notes/ex/.templates/reading.md', placeholders: [] }];
function open(overrides: Partial<Parameters<typeof ManageTemplatesDialog>[0]> = {}) {
  const handlers = { onCreate: vi.fn(async () => {}), onEdit: vi.fn(async () => {}), onRename: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onClose: vi.fn() };
  render(
    <I18nProvider>
      <ManageTemplatesDialog notebookTitle='Example' templates={templates} builtin={[{ id: 'builtin:slides', title: 'Slides' }]} loading={false} error='' readOnly={false} {...handlers} {...overrides} />
    </I18nProvider>,
  );
  const rows = () => within(screen.getByRole('list', { name: 'Templates' })).getAllByRole('listitem');
  return { ...handlers, ...overrides, rows };
}

it('lists each template with its name, description and file, the manifest’s edit-only and the built-in read-only', () => {
  const { rows } = open();
  const [registered, reading, builtin] = rows();
  expect(registered).toHaveTextContent('Registered');
  expect(registered).toHaveTextContent('notes/ex/kept/registered.md');
  expect(registered).toHaveTextContent('.mygitnotes.yaml');
  expect(within(registered).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Edit Registered']);
  expect(reading).toHaveTextContent('讀書筆記');
  expect(reading).toHaveTextContent('讀完一本書的摘要與心得');
  expect(reading).toHaveTextContent('notes/ex/.templates/reading.md');
  expect(within(reading).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Edit 讀書筆記', 'Rename 讀書筆記', 'Delete 讀書筆記']);
  expect(builtin).toHaveTextContent('Slides');
  expect(builtin).toHaveTextContent('Built in');
  expect(within(builtin).queryAllByRole('button')).toEqual([]);
});

it('shows a read-only notebook its templates without any action', () => {
  const { rows } = open({ readOnly: true });
  expect(rows()).toHaveLength(3);
  expect(within(screen.getByRole('list', { name: 'Templates' })).queryAllByRole('button')).toEqual([]);
  expect(screen.queryByRole('button', { name: 'New template' })).toBeNull();
});

it('creates a template from a name, showing the file it makes, and closes once it opened', async () => {
  const { onCreate, onClose } = open();
  fireEvent.click(screen.getByRole('button', { name: 'New template' }));
  const input = screen.getByRole('textbox', { name: 'Template name' });
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'Book/review' } });
  expect(screen.getByText('File: .templates/Book-review.md')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onCreate).toHaveBeenCalledExactlyOnceWith('Book/review');
});

it('edits in zoom (the dialog closes), renames a file template and deletes one after confirmation', async () => {
  const { onEdit, onRename, onDelete, onClose } = open();
  fireEvent.click(screen.getByRole('button', { name: 'Rename 讀書筆記' }));
  const input = screen.getByRole('textbox', { name: 'New name' });
  expect(input).toHaveValue('reading');
  fireEvent.change(input, { target: { value: 'books' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(onRename).toHaveBeenCalledExactlyOnceWith(templates[1], 'books'));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Delete 讀書筆記' }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledExactlyOnceWith(templates[1]));
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Edit Registered' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(templates[0]);
});

it('shows why an action was refused and stays open, and offers no rename or delete where files cannot change', async () => {
  const { onClose } = open({
    onCreate: vi.fn(async () => {
      throw new Error('A template named reading already exists.');
    }),
    fileActions: false,
  });
  expect(screen.queryByRole('button', { name: 'Rename 讀書筆記' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete 讀書筆記' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New template' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Template name' }), { target: { value: 'reading' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A template named reading already exists.');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Template name' })).toHaveValue('reading');
});
