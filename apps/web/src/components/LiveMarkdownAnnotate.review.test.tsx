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

const realRect = HTMLElement.prototype.getBoundingClientRect;
let answerSession: (() => void) | undefined;

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    return this.classList.contains('ann-stage') ? new DOMRect(100, 50, 400, 200) : realRect.call(this);
  };
  resetAnnotationAuthor();
  // A hosted session request that takes longer than a click.
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      new Promise<Response>(resolve => {
        answerSession = () => resolve(new Response(JSON.stringify({ authenticated: false })));
      })
    ),
  );
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.unstubAllGlobals();
});

function Editor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  const widgets = () => [...view.container.querySelectorAll<HTMLElement>('.live-md-annotate')];
  return { ...view, editor, widgets };
}

function pointer(target: Element, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

const block = (image: string) => `:::annotate\n![shot](shots/${image}.png)\n\n- {#1 pin x=10% y=20%} first\n:::`;

describe('annotating: the next click while the session request is still out', () => {
  it('keeps the typed comment of the first pin (R-F001)', async () => {
    const { editor, widgets } = await mount('before\n\n:::annotate\n![shot](shots/a.png)\n:::\n\nafter');
    fireEvent.click(within(widgets()[0]).getByRole('button', { name: /Click the image to drop a pin/ }));
    const under = () => widgets()[0].querySelector('.ann-edit-under')!;
    pointer(under(), 'pointerdown', 140, 90);
    pointer(under(), 'pointerup', 140, 90);
    const field = await waitFor(() => widgets()[0].querySelector<HTMLTextAreaElement>('.ann-pending-item textarea')!);
    fireEvent.input(field, { target: { value: 'first comment' } });
    const next = under();
    pointer(next, 'pointerdown', 300, 150);
    pointer(next, 'pointerup', 300, 150);
    answerSession!();
    await waitFor(() => expect(editor.state.doc.toString()).toContain('first comment'));
    expect(widgets()[0].querySelector('.ann-pending-item')).not.toBeNull();
  });
});

describe('two annotate blocks', () => {
  it("does not hand a removed block's mode to the block that takes its place (R-F006)", async () => {
    const first = block('a');
    const second = block('b');
    const { editor, widgets } = await mount(`${first}\n\nmiddle\n\n${second}`);
    expect(widgets()).toHaveLength(2);
    fireEvent.click(within(widgets()[0]).getByRole('button', { name: /Click the image to drop a pin/ }));
    expect(widgets()[0]).toHaveClass('is-annotating');
    editor.dispatch({ changes: { from: 0, to: first.length + 2 } });
    await waitFor(() => expect(widgets()).toHaveLength(1));
    expect(widgets()[0]).not.toHaveClass('is-annotating');
    expect(widgets()[0].querySelector('img')?.getAttribute('src')).toContain('b.png');
  });
});

describe('the Annotate button', () => {
  it('is not offered on the image line of an annotate block shown as source (R-F005)', async () => {
    const { editor, container } = await mount(`${block('a')}\n\nafter`);
    editor.focus();
    editor.dispatch({ selection: { anchor: 40 } });
    await waitFor(() => expect(container.querySelector('.live-md-annotate')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Annotate' })).toBeNull();
  });
});
