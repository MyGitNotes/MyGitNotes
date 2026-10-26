// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { resetAnnotationAuthor } from './annotate-editor/controller.js';
import { resetRememberedPages } from '../lib/annotations/pdf-figure.js';

const { acquire } = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../lib/pdf/pdf-document.js', () => ({ sharedPdf: { acquire } }));

const BLOCK = ':::annotate[Contract]\n[a.pdf](/raw-assets/a.pdf)\n\n- {#1 pin x=10% y=20% page=1 resolved} done\n- {#2 pin x=30% y=40% page=2} open\n:::';
const DOC = `before\n\n${BLOCK}\n\nafter`;

function Editor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  return { ...view, editor, widget: () => view.container.querySelector<HTMLElement>('.live-md-annotate')! };
}

const fakePdf = () => ({ pageCount: 3, pageSize: async () => ({ width: 612, height: 792 }), render: () => ({ promise: Promise.resolve(), cancel: () => undefined }), destroy: async () => undefined });

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  resetAnnotationAuthor();
  resetRememberedPages();
  acquire.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: false }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a PDF annotate block in the live editor', () => {
  it('shows the resolved group and its markers with Show resolved, and hides them again', async () => {
    const release = vi.fn(async () => undefined);
    acquire.mockImplementation(async () => ({ pdf: fakePdf(), release }));
    const { widget } = await mount(DOC);
    await waitFor(() => expect(widget().querySelector('nav.ann-pager')).not.toBeNull());
    const details = () => widget().querySelector<HTMLDetailsElement>('details.ann-resolved')!;
    expect(details().open).toBe(false);
    fireEvent.click(within(widget()).getByRole('button', { name: 'Show resolved (1)' }));
    await waitFor(() => expect(widget().querySelector('nav.ann-pager')).not.toBeNull());
    expect(details().open).toBe(true);
    fireEvent.click(within(widget()).getByRole('button', { name: 'Hide resolved (1)' }));
    await waitFor(() => expect(widget().querySelector('nav.ann-pager')).not.toBeNull());
    expect(details().open).toBe(false);
  });

  it('keeps its page across Show resolved, which redraws the block', async () => {
    acquire.mockImplementation(async () => ({ pdf: fakePdf(), release: async () => undefined }));
    const { widget } = await mount(DOC);
    await waitFor(() => expect(widget().querySelector('nav.ann-pager')).not.toBeNull());
    expect(widget().querySelector('.ann-pager-status')).toHaveTextContent('Page 2 of 3');
    fireEvent.click(within(widget()).getByRole('button', { name: 'Show resolved (1)' }));
    await waitFor(() => expect(widget().querySelector('.ann-pager-status')).toHaveTextContent('Page 2 of 3'));
  });
});
