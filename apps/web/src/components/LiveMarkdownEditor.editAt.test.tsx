// @vitest-environment jsdom
import { createElement, createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { I18nProvider } from '../lib/i18n/context.js';
import { LiveMarkdownEditor, type LiveMarkdownHandle } from './LiveMarkdownEditor.js';

beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('turns a reading view editable, places the caret at the point and focuses it before returning', () => {
  const ref = createRef<LiveMarkdownHandle>();
  const client = new QueryClient();
  render(createElement(QueryClientProvider, { client }, createElement(I18nProvider, null, createElement(MemoryRouter, {}, createElement(LiveMarkdownEditor, { ref, content: 'first line\nsecond line', notePath: 'notes/a.md', readOnly: true, onChange: () => {}, ariaLabel: 'Note content' })))));
  const content = screen.getByRole('textbox', { name: 'Note content' });
  const view = EditorView.findFromDOM(content)!;
  expect(content.getAttribute('contenteditable')).toBe('false');
  const at = vi.spyOn(EditorView.prototype, 'posAtCoords').mockReturnValue(14);
  // The focus must find the content editable already: checked from inside the focus itself.
  let editableOnFocus: string | null = null;
  content.addEventListener('focus', () => void (editableOnFocus = content.getAttribute('contenteditable')));
  ref.current!.editAt!(30, 40);
  expect(at).toHaveBeenCalledWith({ x: 30, y: 40 }, false);
  expect(editableOnFocus).toBe('true');
  expect(document.activeElement).toBe(content);
  expect(view.state.readOnly).toBe(false);
  expect(view.state.selection.main.head).toBe(14);
});
