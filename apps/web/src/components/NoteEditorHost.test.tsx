// @vitest-environment jsdom
import { createElement, forwardRef, Fragment, type ReactNode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { followMovedNote } from '../app/follow-moved-note.js';
import { NoteEditingProvider, useNoteEditing } from '../lib/note-editing.js';
import type { NoteEditorProps } from './NoteEditor.js';
import { HostedNoteEditor } from './NoteEditorHost.js';

const alpha = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {}, content: '# Alpha\n\nBody.' };

// The lists show the note at whatever path a host asks for, except at the paths in `unread`, which they have not read yet.
const lookup = vi.hoisted(() => ({ note: { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: {} as Record<string, unknown>, content: '# Alpha\n\nBody.' }, typing: false, unread: new Set<string>() }));
vi.mock('../lib/use-note-queries.js', () => ({ useNoteLookup: (refs: { path: string; }[]) => ({ notes: refs.filter(ref => !lookup.unread.has(ref.path)).map(ref => ({ ...lookup.note, path: ref.path })), committed: [], loading: refs.some(ref => lookup.unread.has(ref.path)), error: '' }) }));
// Each mounted editor has a text field of its own: it keeps its focus only while the editor stays mounted.
vi.mock('./NoteEditor.js', () => ({
  NoteEditor: forwardRef<unknown, NoteEditorProps>(({ frame, note, onSession }, _ref) => {
    /* eslint-disable react-hooks/exhaustive-deps -- The test double reports one mounted session and its cleanup; prop refreshes are exercised independently of mounting. */
    useEffect(() => {
      onSession?.({ content: note.content, title: note.title, dirty: lookup.typing, locked: false });
      return () => onSession?.(null);
    }, []);
    /* eslint-enable react-hooks/exhaustive-deps */
    return createElement('div', { 'data-testid': 'editor', 'data-frame': frame, 'data-path': note.path }, note.content, createElement('textarea', { 'aria-label': 'Typing' }));
  }),
}));

afterEach(() => {
  cleanup();
  lookup.note = { ...lookup.note, content: '# Alpha\n\nBody.', title: 'Alpha' };
  lookup.typing = false;
  lookup.unread.clear();
});

let editing: ReturnType<typeof useNoteEditing>;
const Probe = () => {
  /* eslint-disable react/globals -- The test probe captures its hook result for assertions after React commits. */
  editing = useNoteEditing();
  /* eslint-enable react/globals */
  return null;
};
let flushEditors: ReturnType<typeof vi.fn<(keys?: readonly string[]) => Promise<boolean>>>;
beforeEach(() => {
  flushEditors = vi.fn(async () => true);
});

/* eslint-disable react/no-children-prop -- The component test passes children explicitly as part of the tested props contract. */
const provide = (...children: ReactNode[]) => createElement(NoteEditingProvider, { register: () => () => {}, flushEditors, refreshNotes: async () => {}, closeZoom: () => {}, addToFocus: () => undefined, editorProps: () => ({ statuses: [], onSave: async () => alpha, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' }), children: createElement(Fragment, null, createElement(Probe), ...children) });
/* eslint-enable react/no-children-prop */

const twoHosts = () => provide(createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true })), createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'inline', active: false })));

it('mounts one editor for a note shown in two hosts and lets the other host claim it', async () => {
  render(twoHosts());
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'pane');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(screen.getByTestId('card').querySelector('h1')).toHaveTextContent('Alpha');

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(flushEditors).toHaveBeenCalledWith(['a:notes/a.md']);
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'inline');
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
});

it('keeps the owner when its pending edits cannot be saved', async () => {
  flushEditors.mockResolvedValue(false);
  render(twoHosts());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeNull();
});

it('lends the owner editor to zoom and takes it back when zoom closes', () => {
  render(twoHosts());
  const slot = document.createElement('div');
  document.body.append(slot);
  act(() => editing.setZoom({ key: 'a:notes/a.md', borrowed: true, slot }));
  const editor = screen.getByTestId('editor');
  expect(editor).toHaveAttribute('data-frame', 'zoom');
  expect(slot.contains(editor)).toBe(true);
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open in zoom.');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open in zoom.');
  expect(screen.queryByRole('button', { name: 'Edit here' })).toBeNull();

  act(() => editing.setZoom(null));
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'pane');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  slot.remove();
});

it('shows every host as open in zoom while zoom runs its own editor', () => {
  render(twoHosts());
  act(() => editing.setZoom({ key: 'a:notes/a.md', borrowed: false, slot: null }));
  expect(screen.queryByTestId('editor')).toBeNull();
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open in zoom.');
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open in zoom.');
});

const claimingCard = () => provide(createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true })), createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'inline', active: false, claim: true })));

it('takes the editor from its owner when mounted to claim it, saving the owner first', async () => {
  render(claimingCard());
  await waitFor(() => expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toHaveAttribute('data-frame', 'inline'));
  expect(flushEditors).toHaveBeenCalledWith(['a:notes/a.md']);
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(flushEditors).toHaveBeenCalledTimes(1);
});

it('claims nothing when it is the first host of the note', async () => {
  render(provide(createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'inline', active: false, claim: true })));
  await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  expect(flushEditors).not.toHaveBeenCalled();
});

it('falls back to the preview with its Edit here button when the claim fails', async () => {
  flushEditors.mockResolvedValue(false);
  render(claimingCard());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit here' })).toBeInTheDocument());
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeNull();
});

it('shows the preview with its Edit here button, not the loading status, once another host takes over a note it owned from the start', async () => {
  render(provide(createElement('section', { 'data-testid': 'card' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'inline', active: false, claim: true })), createElement('section', { 'data-testid': 'pane' }, createElement(HostedNoteEditor, { notebookId: 'a', path: 'notes/a.md', frame: 'pane', active: true }))));
  await waitFor(() => expect(screen.getByTestId('card').querySelector('[data-testid="editor"]')).toBeInTheDocument());
  expect(screen.getByTestId('pane')).toHaveTextContent('This note is open for editing elsewhere.');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit here' }));
  });
  expect(screen.getByTestId('pane').querySelector('[data-testid="editor"]')).toBeInTheDocument();
  expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  expect(screen.getByTestId('card')).not.toHaveTextContent('Loading note');
  expect(within(screen.getByTestId('card')).getByRole('button', { name: 'Edit here' })).toBeInTheDocument();
});

it('shows a note that changed under its editor, as a rename that retitled it does', () => {
  const view = render(twoHosts());
  expect(screen.getByTestId('editor')).toHaveTextContent('# Alpha');
  lookup.note = { ...lookup.note, title: 'Beta', content: '# Beta\n\nBody.' };
  view.rerender(twoHosts());
  expect(screen.getByTestId('editor')).toHaveTextContent('# Beta');
});

describe('a note the page followed to where it moved', () => {
  const MOVED = 'notes/archive/alpha.md';
  /** The page heard that the note lies elsewhere now (another person moved or renamed it), as an open editor hears it. */
  const follow = () => followMovedNote({ note: { notebookId: 'a', path: 'notes/a.md' }, to: MOVED, notebook: { id: 'a', root: 'notes' }, routedPath: null, search: '', relocatePaths: () => {}, navigate: () => {}, refresh: () => {} });
  const host = (path: string, frame: 'pane' | 'inline' = 'pane') => createElement(HostedNoteEditor, { notebookId: 'a', path, frame, active: frame === 'pane' });

  it('keeps its editor and the focus in it, showing the note where it lies before the lists read it there', () => {
    const view = render(provide(host('notes/a.md')));
    const typing = screen.getByRole('textbox', { name: 'Typing' });
    act(() => typing.focus());
    follow();
    lookup.unread.add(MOVED);
    view.rerender(provide(host(MOVED)));
    expect(screen.getByRole('textbox', { name: 'Typing' })).toBe(typing);
    expect(document.activeElement).toBe(typing);
    expect(screen.getByTestId('editor')).toHaveAttribute('data-path', MOVED);
    // The lists read it there: still the same editor.
    lookup.unread.clear();
    view.rerender(provide(host(MOVED)));
    expect(screen.getByRole('textbox', { name: 'Typing' })).toBe(typing);
    expect(screen.getByTestId('editor')).toHaveAttribute('data-path', MOVED);
  });

  it('keeps the editor in the host that had it when every host of the note follows it', async () => {
    const both = (path: string) => provide(createElement('section', { 'data-testid': 'card' }, host(path, 'inline')), createElement('section', { 'data-testid': 'pane' }, host(path)));
    const view = render(both('notes/a.md'));
    // The pane holds the editor, though the card came first.
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('pane')).getByRole('button', { name: 'Edit here' }));
    });
    const typing = within(screen.getByTestId('pane')).getByRole('textbox', { name: 'Typing' });
    act(() => typing.focus());
    follow();
    view.rerender(both(MOVED));
    expect(within(screen.getByTestId('pane')).getByRole('textbox', { name: 'Typing' })).toBe(typing);
    expect(document.activeElement).toBe(typing);
    expect(screen.getByTestId('card')).toHaveTextContent('This note is open for editing elsewhere.');
  });

  it('keeps the editor it lends to zoom there, focused, while zoom follows the note after it', () => {
    const view = render(provide(host('notes/a.md')));
    const slot = document.createElement('div');
    document.body.append(slot);
    act(() => editing.setZoom({ key: 'a:notes/a.md', borrowed: true, slot }));
    const typing = screen.getByRole('textbox', { name: 'Typing' });
    act(() => typing.focus());
    follow();
    view.rerender(provide(host(MOVED)));
    expect(slot.contains(typing)).toBe(true);
    expect(document.activeElement).toBe(typing);
    act(() => editing.setZoom({ key: `a:${MOVED}`, borrowed: true, slot }));
    expect(slot.contains(typing)).toBe(true);
    expect(document.activeElement).toBe(typing);
    slot.remove();
  });

  it('opens another note shown in its place in an editor of its own', () => {
    const view = render(provide(host('notes/a.md')));
    const typing = screen.getByRole('textbox', { name: 'Typing' });
    view.rerender(provide(host('notes/b.md')));
    expect(screen.getByRole('textbox', { name: 'Typing' })).not.toBe(typing);
    expect(screen.getByTestId('editor')).toHaveAttribute('data-path', 'notes/b.md');
  });
});

it('keeps the editor on its own text when the note changes under unsaved typing', () => {
  lookup.typing = true;
  const view = render(twoHosts());
  lookup.note = { ...lookup.note, title: 'Beta', content: '# Beta\n\nBody.' };
  view.rerender(twoHosts());
  expect(screen.getByTestId('editor')).toHaveTextContent('# Alpha');
});
