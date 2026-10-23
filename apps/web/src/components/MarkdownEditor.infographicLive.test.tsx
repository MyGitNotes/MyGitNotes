// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { infographicEditorRequest as infographicRequestField } from './infographic-editor/open-request.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);
// One Radix menu opening per file: in jsdom a second toolbar menu in the same file does not open.

function Editor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

it('inserts an infographic from the live toolbar as a block of its own and opens its data editor', async () => {
  render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial: 'first\nsecond' })))));
  const view = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  view.dispatch({ selection: { anchor: 6 } });

  fireEvent.keyDown(screen.getByRole('button', { name: 'Insert infographic' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: /Bars/ }));

  const doc = view.state.doc.toString();
  expect(doc).toMatch(/^first\n\n::::bars\{[^\n]*\}\n[^]*\n::::\n\nsecond$/);
  const editor = await screen.findByRole('group', { name: 'Infographic data editor: Bars' });
  // The editor is open on the inserted block, and the request is taken up once.
  expect(editor.querySelector('.ig-cell-input')).toBeEnabled();
  expect(within(editor).getAllByRole('tab').length).toBeGreaterThan(0);
  await waitFor(() => expect(view.state.field(infographicRequestField, false)).toBeNull());
  // The cursor waits after the block, and nothing of the document changed by opening the editor.
  expect(view.state.doc.toString()).toBe(doc);
});
