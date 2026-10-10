// @vitest-environment jsdom
import { createElement, type ReactElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: 'First line\n\nSecond line\n' };
const editor = (frame: NoteEditorProps['frame']): ReactElement => createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(PanelProvider, null, createElement(NoteEditor, { note, frame, active: false, statuses: [], autoSave: false, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' } as NoteEditorProps))));
/** The frame's CodeMirror view, once the lazily loaded editor has mounted it. */
const view = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull());
  return EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-content')!)!;
};

// Spec E4: a card or Book section that edits is opened in zoom on the same editing session, and closing zoom gives it back. The frames render
// the editor in different trees, so each builds its own CodeMirror view; the caret and the undo history must still carry over.
for (const [from, to] of [['inline', 'zoom'], ['zoom', 'inline'], ['compact', 'zoom']] as const) {
  it(`keeps the caret and the undo history when the editor moves from the ${from} frame to the ${to} frame`, async () => {
    const { container, rerender } = render(editor(from));
    const first = await view(container);
    act(() => {
      first.dispatch({ changes: { from: 10, insert: ' TYPED' }, selection: { anchor: 16 }, userEvent: 'input.type' });
      first.dispatch({ selection: { anchor: 4 } });
    });
    expect(first.state.doc.toString()).toBe('First line TYPED\n\nSecond line\n');

    rerender(editor(to));
    await waitFor(() => expect(container.querySelector('.cm-content') && EditorView.findFromDOM(container)).not.toBe(first));
    const second = await view(container);
    expect(second).not.toBe(first);
    expect(second.state.doc.toString()).toBe('First line TYPED\n\nSecond line\n');
    expect(second.state.selection.main.head).toBe(4);

    act(() => {
      expect(undo(second)).toBe(true);
    });
    expect(second.state.doc.toString()).toBe(note.content);
    act(() => {
      expect(redo(second)).toBe(true);
    });
    expect(second.state.doc.toString()).toBe('First line TYPED\n\nSecond line\n');
  });
}
