// @vitest-environment jsdom
import { createElement, createRef, type Ref, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor.js';
import { annotateRequest as annotateRequestField } from './annotate-editor/open-request.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: false }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const IMG = '![shot](shots/a.png)';

function Editor({ initial, readOnly, onInsertImage, handle }: { initial: string; readOnly: boolean; onInsertImage?: (options?: { annotated?: boolean; }) => void; handle: Ref<MarkdownEditorHandle>; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { ref: handle, content, path: 'notes/a.md', mode: 'live', readOnly, onChange: setContent, ariaLabel: 'Note content', onInsertImage });
}

async function mount(initial: string, { readOnly = false, onInsertImage }: { readOnly?: boolean; onInsertImage?: (options?: { annotated?: boolean; }) => void; } = {}) {
  const handle = createRef<MarkdownEditorHandle>();
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial, readOnly, onInsertImage, handle })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  return { ...view, editor, handle };
}

const doc = (editor: EditorView) => editor.state.doc.toString();

describe('the Annotate button on an image line', () => {
  it('wraps the line as an annotate block and starts the new widget in annotate mode, as one undo step', async () => {
    const DOC = `before\n\n${IMG}\n\nafter`;
    const { container, editor } = await mount(DOC);
    const button = container.querySelector<HTMLButtonElement>('.live-md-annotate-image-btn')!;
    expect(button).toHaveTextContent('Annotate');
    fireEvent.click(button);
    expect(doc(editor)).toBe(`before\n\n:::annotate\n${IMG}\n:::\n\nafter`);
    await waitFor(() => expect(container.querySelector('.live-md-annotate')).not.toBeNull());
    expect(container.querySelector('.live-md-annotate')!.classList.contains('is-annotating')).toBe(true);
    expect(within(container.querySelector<HTMLElement>('.live-md-annotate')!).getByRole('button', { name: /drop a pin/ })).toHaveAttribute('aria-pressed', 'true');
    // The request is taken once: a widget drawn again does not restart the mode.
    await waitFor(() => expect(editor.state.field(annotateRequestField, false)).toBeNull());
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('is not offered in a read-only note', async () => {
    const { container } = await mount(`${IMG}\n\ntext`, { readOnly: true });
    expect(container.querySelector('.live-md-annotate-image-btn')).toBeNull();
  });

  it('is not offered for an image inside text, a list item or a quote', async () => {
    const { container } = await mount(`text ${IMG} more\n\n- ${IMG}\n\n> ${IMG}\n\nend`);
    expect(container.querySelector('.live-md-annotate-image-btn')).toBeNull();
  });
});

describe('the Insert group', () => {
  it('offers Annotated image only where the image picker exists, and asks the picker to annotate', async () => {
    const without = await mount('text');
    expect(screen.queryByRole('button', { name: 'Annotated image' })).toBeNull();
    without.unmount();
    const onInsertImage = vi.fn();
    await mount('text', { onInsertImage });
    fireEvent.click(screen.getByRole('button', { name: 'Annotated image' }));
    expect(onInsertImage).toHaveBeenLastCalledWith({ annotated: true });
    fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
    expect(onInsertImage).toHaveBeenLastCalledWith();
  });

  it('inserts the picked image as a block of its own and opens it in annotate mode', async () => {
    const { container, editor, handle } = await mount('first\n\nlast');
    editor.dispatch({ selection: { anchor: 5 } });
    act(() => (handle as { current: MarkdownEditorHandle; }).current.insertAnnotated('![a](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)'));
    expect(doc(editor)).toBe('first\n\n:::annotate\n![a](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)\n:::\n\nlast');
    await waitFor(() => expect(container.querySelector('.live-md-annotate')?.classList.contains('is-annotating')).toBe(true));
  });
});
