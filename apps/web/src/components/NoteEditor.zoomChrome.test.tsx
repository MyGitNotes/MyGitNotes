// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; onChange: (content: string) => void; }>(({ content, onChange }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })) }));

afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

it('separates the pressed zoom toggle from the close icon at the right end', async () => {
  const onClose = vi.fn(), toggleFrame = vi.fn(async () => true);
  const { container } = render(editor({ onClose, zoomNavigation: { open: vi.fn(), returnToFocus: toggleFrame, selection: { current: null } } }));
  const toggle = screen.getByRole('button', { name: 'Return to Focus' });
  const close = screen.getByRole('button', { name: 'Close note' });
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('.note-toolbar')?.firstElementChild?.classList.contains('note-row')).toBe(true);
  expect(container.querySelector('.note-controls')?.lastElementChild).toBe(close);
  expect(close.previousElementSibling).toBe(toggle);
  expect(close.querySelector('.lucide-x')).not.toBeNull();
  fireEvent.click(toggle);
  expect(toggleFrame).toHaveBeenCalledWith('live');
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(close); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('collapses the document panel from its own tab row', async () => {
  const { container } = render(editor({ onClose: () => {} }));
  const panel = () => container.querySelector('.note-document-panel');
  fireEvent.click(screen.getByRole('button', { name: 'Document tools' }));
  expect(panel()?.getAttribute('data-open')).toBe('true');

  const collapse = screen.getByRole('button', { name: 'Collapse document tools' });
  // The collapse action is not a tab, so it stays outside the tablist.
  expect(collapse.closest('[role="tablist"]')).toBeNull();
  fireEvent.click(collapse);
  expect(panel()?.getAttribute('data-open')).toBe('false');
});
