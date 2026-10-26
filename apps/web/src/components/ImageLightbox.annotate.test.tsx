// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { I18nProvider } from '../lib/i18n/index.js';
import { renderNote } from '../lib/markdown.js';
import { resetAnnotationAuthor } from './annotate-editor/controller.js';
import { ImageLightbox } from './ImageLightbox.js';
import { MarkdownEditor } from './MarkdownEditor.js';

const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  // The image box in the lightbox: 400 by 200 at (100, 50), so a client point maps to a percentage by plain arithmetic.
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    return this.classList.contains('ann-stage') ? new DOMRect(100, 50, 400, 200) : realRect.call(this);
  };
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 200;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  resetAnnotationAuthor();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: false }))));
});
afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.unstubAllGlobals();
});

const IMG = '![shot](shots/a.png)';
const BLOCK = `:::annotate[Review]\n${IMG}\n\n- {#1 pin x=10% y=20%} first\n- {#2 region x=30% y=40% w=20% h=10% by=al} second\n  more\n- {#3 pin x=80% y=80% resolved} done\n:::`;
const DOC = `before\n\n${BLOCK}\n\nafter`;

function Editor({ initial, readOnly }: { initial: string; readOnly: boolean; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string, readOnly = false) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(ImageLightbox), createElement(Editor, { initial, readOnly })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  const widget = () => view.container.querySelector<HTMLElement>('.live-md-annotate')!;
  return { ...view, editor, widget };
}

/** Clicks the figure's image, which opens the lightbox, and waits for the image to be measured. */
async function openLightbox(widget: () => HTMLElement) {
  fireEvent.click(widget().querySelector('.ann-stage img')!);
  const dialog = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('dialog.image-lightbox');
    expect(found).not.toBeNull();
    return found!;
  });
  await waitFor(() => expect(dialog.querySelector('.ann-stage')).not.toBeNull());
  return dialog;
}

function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

const at = (x: number, y: number) => [100 + x * 4, 50 + y * 2] as const;
const doc = (editor: EditorView) => editor.state.doc.toString();
const type = (field: HTMLTextAreaElement, value: string) => fireEvent.input(field, { target: { value } });
const saveWithKeys = (field: HTMLTextAreaElement) => fireEvent.keyDown(field, { key: 'Enter', metaKey: true });

describe('the lightbox of an annotated image in the live editor', () => {
  it('shows every pin and region of the block with their comments', async () => {
    const { widget } = await mount(DOC);
    const dialog = await openLightbox(widget);
    expect([...dialog.querySelectorAll('.ann-marker')].map(marker => marker.getAttribute('aria-label'))).toEqual(['2, region, open', '1, pin, open', '3, pin, resolved']);
    expect(within(dialog).getByText('first')).toBeInTheDocument();
    expect(dialog.querySelector('.ann-item.ann-n-2 .ann-comment')).toHaveTextContent('second');
    // The image keeps the overlay's box, so the markers sit where they sit in the note.
    expect(dialog.querySelector('.ann-stage img')).not.toBeNull();
  });

  it('keeps resolved ones behind the same Show resolved state as the note', async () => {
    const { widget } = await mount(DOC);
    let dialog = await openLightbox(widget);
    expect(dialog.querySelector<HTMLDetailsElement>('details.ann-resolved')!.open).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close image preview (Esc)' }));
    await waitFor(() => expect(document.querySelector('dialog.image-lightbox')).toBeNull());

    fireEvent.click(within(widget()).getByRole('button', { name: 'Show resolved (1)' }));
    dialog = await openLightbox(widget);
    expect(dialog.querySelector<HTMLDetailsElement>('details.ann-resolved')!.open).toBe(true);
    // Hiding them in the lightbox hides them in the note too.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide resolved (1)' }));
    expect(widget().querySelector<HTMLDetailsElement>('details.ann-resolved')!.open).toBe(false);
  });

  it('selects an annotation from its marker and offers Edit, Resolve and Delete', async () => {
    const { widget, editor } = await mount(DOC);
    const dialog = await openLightbox(widget);
    fireEvent.click(dialog.querySelector('.ann-marker.ann-n-1')!);
    const item = dialog.querySelector('.ann-item.ann-n-1') as HTMLElement;
    expect(item).toHaveClass('is-selected');
    for (const name of ['Edit', 'Resolve', 'Delete']) expect(within(item).getByRole('button', { name })).toBeInTheDocument();
    expect(doc(editor)).toBe(DOC);
  });

  it('edits, resolves and deletes in the note’s own text, each as an undo step', async () => {
    const { widget, editor } = await mount(DOC);
    const dialog = await openLightbox(widget);
    fireEvent.click(dialog.querySelector('.ann-marker.ann-n-2')!);
    fireEvent.click(within(dialog.querySelector('.ann-item.ann-n-2') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const field = (await within(dialog).findByRole('textbox', { name: 'Comment for region 2' })) as HTMLTextAreaElement;
    type(field, 'rewritten');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toBe(DOC.replace('second\n  more', 'rewritten')));
    // The lightbox and the note both show the new comment.
    expect(within(dialog).getByText('rewritten')).toBeInTheDocument();
    expect(within(widget()).getByText('rewritten')).toBeInTheDocument();

    fireEvent.click(within(dialog.querySelector('.ann-item.ann-n-2') as HTMLElement).getByRole('button', { name: 'Resolve' }));
    expect(doc(editor)).toContain('- {#2 region x=30% y=40% w=20% h=10% resolved by=al} rewritten');
    fireEvent.click(dialog.querySelector('.ann-marker.ann-n-1')!);
    fireEvent.click(within(dialog.querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(doc(editor)).not.toContain('{#1 pin');
    undo(editor);
    expect(doc(editor)).toContain('{#1 pin x=10% y=20%} first');
    undo(editor);
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('adds a pin with a click and a region with a drag in annotate mode, and the note shows both', async () => {
    const { widget, editor } = await mount(DOC);
    const dialog = await openLightbox(widget);
    fireEvent.click(within(dialog).getByRole('button', { name: /Click the image to drop a pin/ }));
    const under = dialog.querySelector('.ann-edit-under')!;
    pointer(under, 'pointerdown', ...at(25, 50));
    pointer(under, 'pointerup', ...at(25, 50));
    const field = (await within(dialog).findByRole('textbox', { name: 'Comment for pin 4' })) as HTMLTextAreaElement;
    expect(doc(editor)).toBe(DOC);
    type(field, 'from the lightbox');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toBe(DOC.replace('\n:::\n\nafter', '\n- {#4 pin x=25% y=50%} from the lightbox\n:::\n\nafter')));
    expect(widget().querySelector('.ann-marker.ann-n-4')).not.toBeNull();

    const next = dialog.querySelector('.ann-edit-under')!;
    pointer(next, 'pointerdown', ...at(60, 70));
    pointer(next, 'pointermove', ...at(40, 50));
    pointer(next, 'pointerup', ...at(40, 50));
    const second = (await within(dialog).findByRole('textbox', { name: 'Comment for region 5' })) as HTMLTextAreaElement;
    type(second, 'a box');
    saveWithKeys(second);
    await waitFor(() => expect(doc(editor)).toContain('- {#5 region x=40% y=50% w=20% h=20%} a box\n:::'));
    undo(editor);
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('answers P, R, the arrows, Enter and Delete on the image like the note does', async () => {
    const { widget, editor } = await mount(DOC);
    const dialog = await openLightbox(widget);
    fireEvent.click(within(dialog).getByRole('button', { name: /Click the image to drop a pin/ }));
    const stage = dialog.querySelector('.ann-stage') as HTMLElement;
    expect(document.activeElement).toBe(stage);
    fireEvent.keyDown(stage, { key: 'p' });
    expect(dialog.querySelector('.ann-pending-pin')).not.toBeNull();
    // Each change draws the figure again, so the image is found again.
    fireEvent.keyDown(dialog.querySelector('.ann-stage')!, { key: 'ArrowRight' });
    fireEvent.keyDown(dialog.querySelector('.ann-stage')!, { key: 'Enter' });
    const field = (await within(dialog).findByRole('textbox', { name: 'Comment for pin 4' })) as HTMLTextAreaElement;
    type(field, 'keys');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 pin x=50.5% y=50%} keys'));
    // The new annotation is selected; Delete on the image removes it.
    (dialog.querySelector('.ann-stage') as HTMLElement).focus();
    fireEvent.keyDown(dialog.querySelector('.ann-stage')!, { key: 'Delete' });
    expect(doc(editor)).toBe(DOC);
  });

  it('closes on Escape only when there is nothing on the image to dismiss first', async () => {
    const { widget } = await mount(DOC);
    const dialog = await openLightbox(widget);
    fireEvent.click(within(dialog).getByRole('button', { name: /Click the image to drop a pin/ }));
    const stage = dialog.querySelector('.ann-stage') as HTMLElement;
    fireEvent.keyDown(stage, { key: 'Escape' });
    expect(document.querySelector('dialog.image-lightbox')).not.toBeNull();
    fireEvent.keyDown(stage, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('dialog.image-lightbox')).toBeNull());
  });

  it('does not zoom when a comment is double-clicked or the list is scrolled', async () => {
    const { widget } = await mount(DOC);
    const dialog = await openLightbox(widget);
    const percent = () => dialog.querySelector('.image-lightbox-scale')!.textContent;
    const before = percent();
    fireEvent.doubleClick(dialog.querySelector('.ann-item .ann-comment')!);
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    dialog.querySelector('.ann-side')!.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(percent()).toBe(before);
  });

  it('closes when the block leaves the note', async () => {
    const { widget, editor } = await mount(DOC);
    await openLightbox(widget);
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'nothing here' } });
    await waitFor(() => expect(document.querySelector('dialog.image-lightbox')).toBeNull());
  });
});

describe('the lightbox where the note is not edited', () => {
  it('shows the annotations of a read-only note with no editing', async () => {
    const { widget, editor } = await mount(DOC, true);
    const dialog = await openLightbox(widget);
    expect(dialog.querySelectorAll('.ann-marker')).toHaveLength(3);
    expect(within(dialog).queryByRole('button', { name: /Click the image to drop a pin/ })).toBeNull();
    expect(dialog.querySelector('.ann-edit-under, .ann-edit-over')).toBeNull();
    fireEvent.click(dialog.querySelector('.ann-marker.ann-n-1')!);
    expect(within(dialog).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(doc(editor)).toBe(DOC);
  });

  it('keeps an image without annotations as a plain preview', async () => {
    await mount(`${IMG}\n\nafter`);
    fireEvent.click(
      await waitFor(() => {
        const image = document.querySelector<HTMLImageElement>('.live-md-rendered img');
        expect(image).not.toBeNull();
        return image!;
      }),
    );
    const dialog = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('dialog.image-lightbox');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(dialog.querySelector('.ann-figure, .image-lightbox-annotated')).toBeNull();
  });

  it('shows the annotations of a figure in a read view, read only', async () => {
    render(createElement(I18nProvider, null, createElement(ImageLightbox), createElement('div', { 'data-markdown-view': true, dangerouslySetInnerHTML: { __html: renderNote(DOC, 'notes/a.md') } })));
    fireEvent.click(document.querySelector('[data-markdown-view] .ann-stage img')!);
    const dialog = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('dialog.image-lightbox');
      expect(found).not.toBeNull();
      return found!;
    });
    await waitFor(() => expect(dialog.querySelectorAll('.ann-marker')).toHaveLength(3));
    expect(dialog.querySelector('.ann-edit-under')).toBeNull();
    expect(dialog.querySelector('.ann-item.ann-n-2 .ann-comment')).toHaveTextContent('second');
  });

  it('opens nothing for a PDF figure: its pages are canvases, not images', async () => {
    render(createElement(I18nProvider, null, createElement(ImageLightbox), createElement('div', { 'data-markdown-view': true }, createElement('figure', { className: 'ann-figure ann-pdf' }, createElement('div', { className: 'ann-stage' }, createElement('canvas', { 'data-testid': 'page' }))))));
    fireEvent.click(screen.getByTestId('page'));
    expect(document.querySelector('dialog.image-lightbox')).toBeNull();
  });
});
