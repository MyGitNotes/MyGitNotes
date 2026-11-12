// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { MarkdownEditor } from './MarkdownEditor.js';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

function SourceEditor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'raw', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

it('inserts the picked icon at the caret of the source editor, with the size chosen', async () => {
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SourceEditor, { initial: 'hello world' })));
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(6, 6);
  fireEvent.click(screen.getByRole('button', { name: 'Insert icon' }));
  const search = await screen.findByRole('searchbox', { name: 'Search icons' });
  fireEvent.change(search, { target: { value: 'file-text' } });
  fireEvent.click(screen.getByRole('radio', { name: '20 px' }));
  fireEvent.click(await screen.findByRole('option', { name: /FileText/ }));
  expect(textarea.value).toBe('hello :icon{name="FileText" size="20"}world');
  expect(screen.queryByRole('searchbox', { name: 'Search icons' })).toBeNull();
  await waitFor(() => expect(textarea.selectionStart).toBe('hello :icon{name="FileText" size="20"}'.length));
});
