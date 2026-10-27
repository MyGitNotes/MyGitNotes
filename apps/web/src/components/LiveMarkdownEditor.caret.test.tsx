// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { I18nProvider } from '../lib/i18n/context.js';
import { LiveMarkdownEditor } from './LiveMarkdownEditor.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const mount = (content: string, onCaret: (position: number, end?: number) => void) => {
  const client = new QueryClient(), onChange = () => {};
  const tree = (text: string) => createElement(QueryClientProvider, { client }, createElement(I18nProvider, null, createElement(MemoryRouter, {}, createElement(LiveMarkdownEditor, { content: text, notePath: 'notes/ex/a.md', notebookId: 'ex', readOnly: false, onChange, onCaret, ariaLabel: 'Note content' }))));
  const result = render(tree(content));
  return { rerender: (text: string) => result.rerender(tree(text)), view: () => EditorView.findFromDOM(screen.getByRole('textbox', { name: 'Note content' }))! };
};

it('reports where the caret moves when the note is edited while focus is elsewhere, once a caret was placed', async () => {
  const onCaret = vi.fn();
  const { rerender, view: current } = mount('first\nsecond', onCaret);
  // An editor nobody focused claims no position, so an outside edit reports nothing.
  rerender('zero\nfirst\nsecond');
  expect(onCaret).not.toHaveBeenCalled();

  const view = current();
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: 11 } });
  });
  const input = document.createElement('textarea');
  document.body.append(input);
  act(() => input.focus());
  expect(view.hasFocus).toBe(false);
  onCaret.mockClear();

  // The agent inserts a line above the caret while the writer types in its chat box.
  rerender('agent\nzero\nfirst\nsecond');
  expect(current()).toBe(view);
  expect(view.state.doc.toString()).toBe('agent\nzero\nfirst\nsecond');
  expect(view.state.selection.main.head).toBe(17);
  expect(onCaret).toHaveBeenLastCalledWith(17, 17);
});
