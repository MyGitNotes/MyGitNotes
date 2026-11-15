// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { RenameNoteDialog } from './RenameNoteDialog.js';
import { GraphSaveDialog } from './graph/GraphSaveDialog.js';
import type { useGraphController } from './graph/useGraphController.js';
import { FileOperation } from './files/FileOperation.js';
import type { useFileManager } from './files/useFileManager.js';
import { CompilationEditRow } from './CompilationDialogs.js';
import { FocusControls } from './FocusControls.js';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { CURRENT_FOCUS } from '../lib/focus-view.js';

vi.mock('../lib/use-note-queries.js', () => ({
  useNoteFacets: () => ({ facets: {}, loading: false, error: '' }),
  useNoteList: () => ({ notes: [], loading: false, error: '' }),
}));

// A browser's `showModal` focuses the dialog's first focusable element, its ✕, before anything else can, and makes
// the rest of the page inert, so a menu that closes behind the dialog cannot take focus back to its trigger.
beforeEach(() => {
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function(this: HTMLElement, options?: FocusOptions) {
    const modal = document.querySelector('dialog[open]');
    if (!modal || modal.contains(this)) focus.call(this, options);
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
  HTMLDialogElement.prototype.close = vi.fn(function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.restoreAllMocks();
});

const inApp = (element: ReactElement) => render(<I18nProvider>{element}</I18nProvider>);

describe('a WorkspaceDialog gives its first focus to the field its content marks', () => {
  it.each([
    ['an autoFocus input', <input key='field' aria-label='Field' autoFocus />],
    ['an autoFocus select', <select key='field' aria-label='Field' autoFocus><option>a</option></select>],
    ['an autoFocus button', <button key='field' type='button' aria-label='Field' autoFocus>pick</button>],
  ])('%s', (_name, field) => {
    render(
      <WorkspaceDialog title='Dialog' onClose={() => undefined}>
        <button type='button'>Before</button>
        {field}
      </WorkspaceDialog>,
    );
    expect(screen.getByLabelText('Field')).toHaveFocus();
  });

  it('leaves ✕ focused when nothing is marked', () => {
    render(
      <WorkspaceDialog title='Dialog' onClose={() => undefined}>
        <input aria-label='Field' />
      </WorkspaceDialog>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});

describe('each dialog opens on its first field', () => {
  it('Rename note focuses the name and selects the current title', () => {
    inApp(<RenameNoteDialog path='notes/a/plan.md' title='Plan' busy={false} onClose={() => undefined} onConfirm={() => undefined} />);
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' });
    expect(field).toHaveFocus();
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
  });

  it('Save graph lane focuses the name', () => {
    const model = { t: (key: string) => key, saveOpen: true, setSaveOpen: () => undefined, name: '', setName: () => undefined, saveLane: () => undefined };
    render(<GraphSaveDialog model={model as unknown as ReturnType<typeof useGraphController>} />);
    expect(screen.getByRole('textbox', { name: 'screen.rowName' })).toHaveFocus();
  });

  const fileModel = (operation: string) => ({ t: (key: string) => key, listing: { entries: [] }, selected: 'notes/a/plan.md', busy: false, operation, setOperation: () => undefined, name: 'plan.md', setName: () => undefined, destination: 'notes/a', setDestination: () => undefined, mutable: true, operationLabel: operation, destinationDirs: [{ path: 'notes/a' }, { path: 'notes/b' }], relative: (path: string) => path, deleteMode: 'preserve', setDeleteMode: () => undefined, deleteConfirmed: false, setDeleteConfirmed: () => undefined, metadataReady: true, error: '', submit: async () => undefined });
  it.each(['create', 'mkdir', 'rename'])('File %s focuses the name', operation => {
    render(<FileOperation model={fileModel(operation) as unknown as ReturnType<typeof useFileManager>} />);
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
  it('File move focuses the destination', () => {
    render(<FileOperation model={fileModel('move') as unknown as ReturnType<typeof useFileManager>} />);
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('Edit compilation row focuses the row name', () => {
    inApp(<CompilationEditRow row={{ id: 'r', name: 'Reading', view: 'small', notebookId: 'a', path: '', kind: 'custom', items: [] }} notebooks={[]} assets={[]} folders={[]} selectedNotebookId='a' onApply={() => undefined} onRemove={() => undefined} onClose={() => undefined} />);
    expect(screen.getByRole('textbox', { name: 'Compilation name' })).toHaveFocus();
  });

  it('Name Focus focuses the name', async () => {
    const focus = { shown: CURRENT_FOCUS, focuses: [], canName: true, editable: false, loading: false, error: '', editableFocus: () => false, name: () => 'f' };
    inApp(<FocusControls focus={focus as unknown as NoteFocus} onShow={() => undefined} onRequestClear={() => undefined} confirmingClear={false} onConfirmingClearChange={() => undefined} onReload={() => undefined} splittable={false} />);
    const trigger = screen.getByRole('button', { name: 'Switch Focus' });
    trigger.focus();
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Name this Focus…' }));
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveFocus();
  });
});
