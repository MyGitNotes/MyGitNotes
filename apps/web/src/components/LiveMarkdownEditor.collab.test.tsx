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

it('shows an unparsable leading YAML block raw: its lines marked, no heading, rule or shortcode drawn in it, and its text editable', () => {
  const text = '---\ntitle: [Ideas\ncreated: "2026-11-15T17:48:48Z"\n---\n# Body :smile:\n';
  const { collab, ytext } = collabOf(text);
  const { view } = mount(text, collab);
  const lines = [...view().contentDOM.querySelectorAll('.cm-line')];
  expect(lines.slice(0, 4).every(line => line.classList.contains('live-md-frontmatter'))).toBe(true);
  expect(lines[4]!.classList.contains('live-md-frontmatter')).toBe(false);
  // Nothing of the body's decoration reaches it: `title: Ideas` over `---` is no heading, `:48:` no shortcode.
  for (const line of lines.slice(0, 4)) expect(line.className).not.toMatch(/live-md-h\d|heading|hr/);
  expect(lines.slice(0, 4).some(line => line.querySelector('.cm-widget, [class*="emoji"], [class*="shortcode"]'))).toBe(false);
  act(() => view().dispatch({ changes: { from: 4, to: 9, insert: 'name' }, userEvent: 'input' }));
  expect(ytext.toString()).toBe(text.replace('title', 'name'));
});

const NOTE = '---\ntitle: Ideas\ntags: [a]\n---\n\n# Body\ntext\n';
const BODY = NOTE.indexOf('# Body');

it('hides a parsable frontmatter block and its separator, numbering the body with its file lines', () => {
  const { collab } = collabOf(NOTE);
  const { view } = mount(NOTE, collab);
  const lines = [...view().contentDOM.querySelectorAll('.cm-line')].map(line => line.textContent);
  expect(lines).not.toContain('title: Ideas');
  expect(lines[0]).toContain('Body');
  const numbers = [...view().dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map(element => element.textContent).filter(Boolean);
  expect(numbers).toContain('6');
  expect(numbers).not.toContain('1');
});

it('keeps local edits out of the hidden block: select-all and delete, typing at 0, paste over it, Vim-style whole-doc delete', () => {
  const { collab, ytext } = collabOf(NOTE);
  const { view } = mount(NOTE, collab);
  act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length }, userEvent: 'delete' }));
  expect(ytext.toString()).toBe(NOTE.slice(0, BODY));
  act(() => view().dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input' }));
  expect(ytext.toString()).toBe(NOTE.slice(0, BODY) + 'x');
  act(() => view().dispatch({ changes: { from: 2, to: BODY + 1, insert: 'pasted' }, userEvent: 'input.paste' }));
  expect(ytext.toString()).toBe(NOTE.slice(0, BODY) + 'pasted');
  expect(view().state.selection.main.head).toBeGreaterThanOrEqual(BODY);
});

it('lets a remote edit inside the block through, and shows the block once it stops parsing', () => {
  const { collab, ytext } = collabOf(NOTE);
  const { view } = mount(NOTE, collab);
  act(() => ytext.insert(NOTE.indexOf('[a]') + 2, ', b'));
  expect(view().state.doc.toString()).toContain('tags: [a, b]');
  act(() => ytext.insert(NOTE.indexOf('Ideas'), '['));
  const lines = [...view().contentDOM.querySelectorAll('.cm-line')];
  expect(lines[1]!.textContent).toBe('title: [Ideas');
  expect(lines[1]!.classList.contains('live-md-frontmatter')).toBe(true);
});

it('counts no page break in the frontmatter: the body starts on page 1', () => {
  const { collab } = collabOf(NOTE);
  const { view } = mount(NOTE, collab);
  const labels = [...view().dom.querySelectorAll('[data-page-break], .live-md-page-break-tag')].map(element => element.textContent || element.getAttribute('data-page-label'));
  expect(labels.join(' ')).toContain('1');
  expect(labels.join(' ')).not.toContain('2');
});
