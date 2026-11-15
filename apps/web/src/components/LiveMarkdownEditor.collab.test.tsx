// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { historyField } from '@codemirror/commands';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import { I18nProvider } from '../lib/i18n/context.js';
import { type LiveEditorCarry, LiveMarkdownEditor } from './LiveMarkdownEditor.js';

/*
 * The collab mode of the Markdown editor (docs/specs/2026-11-15-builtin-live-editor §8.1): the Yjs binding owns the
 * text and its undo, so the view keeps no CodeMirror history, takes no text from props, and carries nothing between views.
 */

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const mount = (content: string, collab: { extension: ReturnType<typeof yCollab>; text: string; } | undefined, carry?: { current: LiveEditorCarry | null; }) => {
  const client = new QueryClient(), onChange = () => {};
  const tree = (text: string, readOnly = false) => createElement(QueryClientProvider, { client }, createElement(I18nProvider, null, createElement(MemoryRouter, {}, createElement(LiveMarkdownEditor, { content: text, notePath: 'notes/ex/a.md', notebookId: 'ex', readOnly, onChange, ariaLabel: 'Note content', collab, carry }))));
  const result = render(tree(content));
  return { rerender: (text: string, readOnly?: boolean) => result.rerender(tree(text, readOnly)), unmount: result.unmount, view: () => EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Note content' }))! };
};
const collabOf = (text: string) => {
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  ytext.insert(0, text);
  const undoManager = new Y.UndoManager(ytext);
  return { doc, ytext, undoManager, collab: { extension: yCollab(ytext, new Awareness(doc), { undoManager }), text: ytext.toString() } };
};

it('starts from the synced text with no history field, and ignores content prop changes', () => {
  const { ytext, collab } = collabOf('# Shared\n');
  const { rerender, view } = mount('# Ignored\n', collab);
  expect(view().state.doc.toString()).toBe('# Shared\n');
  expect(view().state.field(historyField, false)).toBeUndefined();
  rerender('# Other text from props\n');
  expect(view().state.doc.toString()).toBe('# Shared\n');
  // The binding is what changes the text: a remote update lands in the view.
  act(() => ytext.insert(ytext.length, 'peer\n'));
  expect(view().state.doc.toString()).toBe('# Shared\npeer\n');
});

it('sends typing into the shared text, and still turns read-only', () => {
  const { ytext, collab } = collabOf('a\n');
  const { rerender, view } = mount('a\n', collab);
  act(() => view().dispatch({ changes: { from: 2, insert: 'b\n' }, userEvent: 'input' }));
  expect(ytext.toString()).toBe('a\nb\n');
  rerender('a\n', true);
  expect(view().state.readOnly).toBe(true);
});

it('carries no state between views, and the direct mode keeps its history', () => {
  const carry = { current: { doc: '# Shared\n', state: {} } as LiveEditorCarry | null };
  const { collab } = collabOf('# Shared\n');
  const first = mount('# Shared\n', collab, carry);
  // A carry offered to the collab view is left untouched, and the view leaves none behind.
  expect(carry.current).toEqual({ doc: '# Shared\n', state: {} });
  carry.current = null;
  first.unmount();
  expect(carry.current).toBeNull();
  const direct = mount('# Direct\n', undefined);
  expect(direct.view().state.field(historyField, false)).toBeDefined();
});
