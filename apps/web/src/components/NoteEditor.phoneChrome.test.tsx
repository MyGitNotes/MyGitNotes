// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { LINE_NUMBERS_STORAGE_KEY } from '../lib/editor-preferences.js';
import { PanelProvider } from '../lib/panel-context.js';
import { PhoneNotesProvider } from '../lib/phone-notes.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; showLineNumbers?: boolean; onChange: (content: string) => void; }>(({ content, showLineNumbers, onChange }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, 'data-line-numbers': showLineNumbers ? 'true' : 'false', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) })) }));

let phone = true;
beforeEach(() => {
  phone = true;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: ['work'], metadata: { title: 'Alpha', status: 'working', tags: ['work'] }, content: '# Alpha\n\nBody words here.\n' };
const editor = (props: Partial<NoteEditorProps> = {}, back = () => {}, changesCount = 0) => createElement(PhoneNotesProvider, { value: { back, changesCount } }, createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'pane', active: true, statuses: ['inbox', 'working', 'done'], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps)));
const bar = () => screen.getByRole('group', { name: 'Note' });

it("shows one title bar with back, the title, the status, edit and more, and nothing of a desktop note's rows", () => {
  const back = vi.fn();
  render(editor({}, back));
  const inBar = within(bar());
  expect(inBar.getByRole('button', { name: 'Back to the note list' })).toBeInTheDocument();
  expect(inBar.getByText('Alpha')).toBeInTheDocument();
  expect(inBar.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  expect(inBar.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  expect(inBar.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  // Neither the note row, the line numbers and view buttons, nor the word-count footer survive on a phone.
  expect(screen.queryByRole('group', { name: 'Note properties' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Line Numbers' })).toBeNull();
  expect(screen.queryByText(/^\d+ words$/)).toBeNull();
  fireEvent.click(inBar.getByRole('button', { name: 'Back to the note list' }));
  expect(back).toHaveBeenCalledTimes(1);
});

it('toggles between reading and editing from the bar', () => {
  render(editor());
  const content = () => screen.getByLabelText('Note content') as HTMLTextAreaElement;
  fireEvent.click(within(bar()).getByRole('button', { name: 'Edit' }));
  expect(within(bar()).getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
  expect(content()).not.toHaveAttribute('readonly');
  fireEvent.click(within(bar()).getByRole('button', { name: 'Done' }));
  expect(within(bar()).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
});

it('closes a zoomed note from the same bar', () => {
  const onClose = vi.fn();
  render(editor({ frame: 'zoom', onClose }));
  fireEvent.click(within(bar()).getByRole('button', { name: 'Close note' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('holds the status, tags, tools and actions in a sheet the "⋯" button opens, and closes it with Escape', () => {
  const onMove = vi.fn(), onRename = vi.fn();
  render(editor({ onMove, onRename }, () => {}, 3));
  expect(screen.queryByRole('dialog')).toBeNull();
  const more = within(bar()).getByRole('button', { name: 'More actions' });
  more.focus();
  fireEvent.click(more);
  const sheet = within(screen.getByRole('dialog', { name: 'Alpha' }));
  expect(sheet.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  expect(sheet.getByRole('button', { name: 'Remove tag work' })).toBeInTheDocument();
  // The rail's eight tools, with the count of pending changes on Changes.
  for (const tool of ['Calendar', 'Todo', 'Changes', 'Outline', 'Find in note', 'Frontmatter', 'View settings', 'History']) expect(sheet.getByRole('button', { name: new RegExp(tool) })).toBeInTheDocument();
  expect(sheet.getByRole('button', { name: /Changes/ })).toHaveTextContent('3');
  for (const action of ['Rename', 'Move note', 'Copy', 'Download (.md)', 'Download (PDF)', 'Switch to source']) expect(sheet.getByRole('button', { name: action })).toBeInTheDocument();
  fireEvent.click(sheet.getByRole('button', { name: 'Move note' }));
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(more).toHaveFocus();
  fireEvent.click(more);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('renames the note from the sheet', async () => {
  const onRename = vi.fn(async () => {});
  render(editor({ onRename }));
  fireEvent.click(within(bar()).getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Beta' } });
  await act(async () => {
    fireEvent.submit(screen.getByLabelText('Name').closest('form')!);
  });
  expect(onRename).toHaveBeenCalledWith('Beta');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('offers a zoomed note only its own sections, and opens one as a full-height sheet that Close dismisses', () => {
  render(editor({ frame: 'zoom', onClose: () => {} }));
  fireEvent.click(within(bar()).getByRole('button', { name: 'More actions' }));
  const menu = within(screen.getByRole('dialog'));
  expect(menu.queryByRole('button', { name: /Calendar/ })).toBeNull();
  expect(menu.queryByRole('button', { name: /Changes/ })).toBeNull();
  fireEvent.click(menu.getByRole('button', { name: 'Frontmatter' }));
  const tool = screen.getByRole('dialog', { name: 'Frontmatter' });
  expect(tool.closest('[data-variant]')).toHaveAttribute('data-variant', 'full');
  fireEvent.click(within(tool).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows no line numbers on a phone whatever this device chose, and leaves that choice for larger screens', () => {
  window.localStorage.setItem(LINE_NUMBERS_STORAGE_KEY, 'true');
  const { unmount } = render(editor());
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-line-numbers', 'false');
  expect(window.localStorage.getItem(LINE_NUMBERS_STORAGE_KEY)).toBe('true');
  unmount();
  phone = false;
  render(editor());
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-line-numbers', 'true');
});

it('keeps the rows, actions and footer of a larger screen', () => {
  phone = false;
  render(editor());
  expect(screen.queryByRole('group', { name: 'Note' })).toBeNull();
  expect(screen.getByRole('group', { name: 'Note properties' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Line Numbers' })).toBeInTheDocument();
  expect(screen.getByText(/^\d+ words$/)).toBeInTheDocument();
});
