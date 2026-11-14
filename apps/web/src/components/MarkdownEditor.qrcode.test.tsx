// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { requestFormat } from '../lib/format-request.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { formatKeymap } from './live-markdown/format-commands.js';

afterEach(cleanup);

function SourceEditor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'raw', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

const renderSource = (initial: string) => {
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SourceEditor, { initial })));
  return screen.getByLabelText<HTMLTextAreaElement>('Note content');
};

it('turns the selected text into a QR code from the toolbar, naming its key', () => {
  const textarea = renderSource('Scan https://example.com/talk now');
  textarea.setSelectionRange(5, 5 + 'https://example.com/talk'.length);
  const button = screen.getByRole('button', { name: /^Turn into QR code \(/ });
  expect(button.getAttribute('aria-label')).toMatch(/L\)$/);
  fireEvent.click(button);
  expect(textarea.value).toBe('Scan :qrcode{url="https://example.com/talk"} now');
});

it('turns the address under the caret into a QR code with Ctrl+Shift+L in the source editor', () => {
  const textarea = renderSource('Scan https://example.com/talk now');
  textarea.setSelectionRange(12, 12);
  fireEvent.keyDown(textarea, { key: 'L', ctrlKey: true, shiftKey: true });
  expect(textarea.value).toBe('Scan :qrcode{url="https://example.com/talk"} now');
});

it('answers the palette command, which asks the editor around the focused element', () => {
  const textarea = renderSource('plain');
  textarea.setSelectionRange(5, 5);
  let taken = false;
  act(() => {
    taken = requestFormat(textarea, 'qrcode');
  });
  expect(taken).toBe(true);
  expect(textarea.value).toBe('plain\n\n::qrcode{url=""}');
  // Outside any editor nothing takes the request.
  expect(requestFormat(document.body, 'qrcode')).toBe(false);
});

it('says why a text it cannot write is left alone', async () => {
  const textarea = renderSource('a "b\' } c');
  textarea.setSelectionRange(2, 7);
  fireEvent.click(screen.getByRole('button', { name: /^Turn into QR code/ }));
  expect(textarea.value).toBe('a "b\' } c');
  expect(await screen.findByRole('status')).toHaveTextContent('Cannot turn this text into a QR code');
  await waitFor(() => expect(textarea.value).toBe('a "b\' } c'));
});

it('binds Mod-Shift-l in the live editor, and reports a refusal on the editor for its wrapper to show', () => {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'a word b', selection: EditorSelection.range(2, 6), extensions: [formatKeymap] }) });
  const press = () => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, shiftKey: true }), 'editor');
  expect(press()).toBe(true);
  expect(view.state.doc.toString()).toBe('a :qrcode{url="word"} b');

  const refused: string[] = [];
  document.body.addEventListener('mygitnotes:format-refused', event => refused.push((event as CustomEvent<string>).detail));
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x a } b' }, selection: EditorSelection.range(2, 5) });
  expect(press()).toBe(true);
  expect(view.state.doc.toString()).toBe('x a } b');
  expect(refused).toEqual(['qrcode-text']);
  view.destroy();
});
