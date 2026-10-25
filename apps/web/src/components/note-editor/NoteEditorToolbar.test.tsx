// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteEditorToolbar } from './NoteEditorToolbar.js';

// The real toggle renders nothing without a Pi agent provider; this one stands in for an available agent.
const agent = vi.hoisted(() => ({ available: false }));
vi.mock('../assistant/AssistantDockToggle.js', () => ({ AssistantDockToggle: () => agent.available ? createElement('button', { type: 'button', 'aria-label': 'Agent' }) : null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const note = { id: 'a', path: 'notes/untitled.md', notebookId: 'a', title: 'Untitled', tags: [], metadata: {}, content: '# Untitled' };
const setMetadata = vi.fn();
const setNotePanel = vi.fn();
const session = { title: 'Untitled', metadata: { title: 'Untitled', tags: ['alpha'] }, setMetadata, locked: false, isSaving: false, hasUnsavedChanges: false, content: note.content, copyState: 'idle', copyNote: vi.fn(), close: vi.fn() };
const toolbar = (onRename?: (title: string) => Promise<void> | void, extra: Record<string, unknown> = {}) => createElement(NoteEditorToolbar, { frame: 'zoom', note, session: session as never, docPanel: { notePanel: null, showFrontmatter: false, setNotePanel, lastNotePanel: { current: 'find' } } as never, isMarkdown: false, autoSave: true, readOnly: false, editorMode: 'live', setEditorMode: vi.fn(), showLineNumbers: false, toggleLineNumbers: vi.fn(), showFormatToolbar: false, onClose: vi.fn(), onRename, statuses: ['todo', 'done'], availableTags: ['alpha', 'beta'], ...extra });

const startEditing = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit title: Untitled' }));
  return screen.getByRole('textbox', { name: 'Name' });
};
const openMore = async () => {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
};

it('renames in place: Enter commits the typed title, with the file name it gives shown while editing', () => {
  const onRename = vi.fn();
  render(toolbar(onRename));
  const input = startEditing();
  expect(input).toHaveValue('Untitled');
  fireEvent.change(input, { target: { value: 'Weekly plan' } });
  expect(screen.getByRole('status')).toHaveTextContent('File name: weekly-plan.md');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Weekly plan');
  // The new title shows while the rename lands, not an input.
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit title: Weekly plan' })).toBeDisabled();
});

it('commits the rename when the title field loses focus, and cancels it on Escape without renaming', () => {
  const onRename = vi.fn();
  render(toolbar(onRename));
  fireEvent.change(startEditing(), { target: { value: 'Blurred title' } });
  fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
  expect(onRename).toHaveBeenCalledExactlyOnceWith('Blurred title');
  cleanup();
  onRename.mockClear();

  render(toolbar(onRename));
  const input = startEditing();
  fireEvent.change(input, { target: { value: 'Never saved' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Edit title: Untitled' })).toBeInTheDocument();
  expect(onRename).not.toHaveBeenCalled();
});

it('does not rename to the same title, and refuses a name with no letter or digit for a file name', () => {
  const onRename = vi.fn();
  render(toolbar(onRename));
  fireEvent.keyDown(startEditing(), { key: 'Enter' });
  expect(onRename).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();

  const input = startEditing();
  fireEvent.change(input, { target: { value: '!!!' } });
  expect(screen.getByRole('status')).toHaveTextContent('at least one letter or digit');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRename).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
  // Leaving the field reverts instead of trapping the focus there.
  fireEvent.blur(screen.getByRole('textbox', { name: 'Name' }));
  expect(onRename).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
});

it('shows the title as plain text when the note cannot be renamed, as in a read-only notebook', () => {
  render(toolbar());
  expect(screen.getByText('Untitled').tagName).toBe('DIV');
  expect(screen.queryByRole('button', { name: /Edit title/ })).toBeNull();
});

it("holds the title, status and tags in the note row, the status and tags changing the note's metadata", () => {
  render(toolbar(vi.fn()));
  const row = screen.getByRole('group', { name: 'Note properties' });
  expect(within(row).getByRole('button', { name: 'Edit title: Untitled' })).toBeInTheDocument();
  expect(within(row).getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  const tags = within(row).getByRole('group', { name: /Tags/ });
  expect(within(tags).getByText('alpha')).toBeInTheDocument();
  fireEvent.click(within(tags).getByRole('button', { name: 'Remove tag alpha' }));
  expect(setMetadata).toHaveBeenLastCalledWith({ title: 'Untitled', tags: [] });
  const add = within(tags).getByRole('textbox', { name: 'Add tag' });
  fireEvent.focus(add);
  expect(within(tags).getByRole('option', { name: 'beta' })).toBeInTheDocument();
  expect(within(tags).queryByRole('option', { name: 'alpha' })).toBeNull();
  fireEvent.change(add, { target: { value: 'gamma' } });
  fireEvent.keyDown(add, { key: 'Enter' });
  expect(setMetadata).toHaveBeenLastCalledWith({ title: 'Untitled', tags: ['alpha', 'gamma'] });
});

it('opens the full frontmatter from the { } button at the right of the note row', () => {
  const { container } = render(toolbar(vi.fn()));
  const button = screen.getByRole('button', { name: 'Frontmatter' });
  expect(container.querySelector('.note-row')!.lastElementChild).toBe(button);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button);
  expect(setNotePanel).toHaveBeenCalledWith('frontmatter');
});

it('offers Add to outline, Move and the export items in the ⋯ menu, with no button of their own', async () => {
  render(toolbar(undefined, { onAddToOutline: vi.fn(), onMove: vi.fn() }));
  expect(screen.queryByRole('button', { name: 'Move note' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add to outline' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  await openMore();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Add to outline', 'Move note', 'Copy', 'Download (.md)', 'Download (PDF)']);
});

it('leaves out of the ⋯ menu what the note cannot do', async () => {
  render(toolbar());
  await openMore();
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Copy', 'Download (.md)', 'Download (PDF)']);
});

it('runs the menu items: moves the note, adds it to an outline, copies it', async () => {
  const onMove = vi.fn();
  const onAddToOutline = vi.fn();
  render(toolbar(undefined, { onAddToOutline, onMove }));
  await openMore();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move note' }));
  });
  expect(onMove).toHaveBeenCalledOnce();
  await openMore();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to outline' }));
  });
  expect(onAddToOutline).toHaveBeenCalledOnce();
  await openMore();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
  });
  expect(session.copyNote).toHaveBeenCalledOnce();
});

it('puts Refresh first in the zoom controls as a ghost icon button with a tooltip', async () => {
  const onRefresh = vi.fn(async () => {});
  const { container } = render(toolbar(undefined, { onRefresh }));
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  expect(refresh).toHaveClass('ui-icon-button');
  expect(refresh).toHaveAttribute('title', expect.stringContaining('latest version'));
  expect(refresh.textContent).toBe('');
  expect(container.querySelector('.note-controls')!.firstElementChild).toBe(refresh);
  expect(container.querySelector('.note-row')).not.toContainElement(refresh);
  fireEvent.click(refresh);
  expect(onRefresh).toHaveBeenCalledOnce();
});

it('makes zoom one row: back button, note row, then the actions grouped as view with ⋯ and panels', () => {
  const groups = (isMarkdown: boolean, extra: Record<string, unknown> = {}) => {
    const { container } = render(toolbar(vi.fn(), { isMarkdown, toggleFormatToolbar: vi.fn(), ...extra }));
    const bar = container.querySelector('.note-toolbar')!;
    const names = [...container.querySelectorAll('.note-controls-group')].map(group => group.getAttribute('aria-label'));
    const members = [...container.querySelectorAll('.note-controls-group')].map(group => [...group.querySelectorAll('button')].map(button => button.getAttribute('aria-label')));
    const order = [...bar.children].map(child => child.className.split(' ')[0]);
    cleanup();
    return { names, members, order };
  };
  const { names, members, order } = groups(true);
  expect(order).toEqual(['note-close', 'note-row', 'note-controls']);
  expect(names).toEqual(['View', 'Panels']);
  expect(members).toEqual([['Switch to source', 'Line Numbers', 'Formatting toolbar', 'More actions'], ['Document tools']]);
  // A note that is not Markdown has no modes.
  expect(groups(false).members[0]).toEqual(['Line Numbers', 'Formatting toolbar', 'More actions']);
});

it("puts a pane's actions into the tab bar slot it is given, leaving only the note row in the toolbar", () => {
  const slot = document.createElement('div');
  document.body.append(slot);
  const { container } = render(toolbar(vi.fn(), { frame: 'pane', isMarkdown: true, toggleFormatToolbar: vi.fn(), actionsSlot: slot }));
  expect(container.querySelector('.note-controls')).toBeNull();
  expect([...slot.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual(['Switch to source', 'Line Numbers', 'Formatting toolbar', 'More actions']);
  expect(container.querySelector('.note-toolbar')).toHaveAttribute('data-actions', 'bar');
  expect(screen.getByRole('button', { name: 'Frontmatter' })).toBeInTheDocument();
  slot.remove();
});

it("keeps a pane's actions in a row above the note row where the tab bar has no slot, as on a phone", () => {
  const { container } = render(toolbar(vi.fn(), { frame: 'pane', isMarkdown: true }));
  const bar = container.querySelector('.note-toolbar')!;
  expect(bar).toHaveAttribute('data-actions', 'inline');
  expect(bar.querySelector('.note-controls')).not.toBeNull();
  expect(bar.querySelector('.note-row')).not.toBeNull();
});

it('switches the mode with one icon button that shows the mode in use and names the other, with the leader key for the same switch', () => {
  const setEditorMode = vi.fn();
  const { rerender } = render(toolbar(undefined, { isMarkdown: true, setEditorMode }));
  const toSource = screen.getByRole('button', { name: 'Switch to source' });
  expect(toSource).toHaveAttribute('data-mode-toggle', 'live');
  expect(toSource.textContent).toBe('');
  expect(toSource).toHaveAttribute('title', expect.stringMatching(/^Switch to source \(.+ M\)$/));
  expect(screen.queryByText('Live Preview')).toBeNull();
  fireEvent.click(toSource);
  expect(setEditorMode).toHaveBeenCalledWith('raw');
  rerender(toolbar(undefined, { isMarkdown: true, setEditorMode, editorMode: 'raw' }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch to live preview' }));
  expect(setEditorMode).toHaveBeenLastCalledWith('live');
  // A Focus pane answers the leader too.
  rerender(toolbar(undefined, { isMarkdown: true, setEditorMode, frame: 'pane' }));
  expect(screen.getByRole('button', { name: 'Switch to source' })).toHaveAttribute('title', expect.stringMatching(/^Switch to source \(.+ M\)$/));
});

it('offers the assistant toggle in zoom only, leaving a Focus pane to the header toggle', () => {
  agent.available = true;
  onTestFinished(() => {
    agent.available = false;
  });
  render(toolbar());
  expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument();
  cleanup();
  render(toolbar(undefined, { frame: 'pane' }));
  expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull();
});
