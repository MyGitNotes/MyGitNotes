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
import { MarkdownEditor } from './MarkdownEditor.js';
import { resetAnnotationAuthor } from './annotate-editor/controller.js';

const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
  // The image box: 400 by 200 at (100, 50), so a client point maps to a percentage by plain arithmetic.
  HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
    return this.classList.contains('ann-stage') ? new DOMRect(100, 50, 400, 200) : realRect.call(this);
  };
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

function Editor({ initial, readOnly = false }: { initial: string; readOnly?: boolean; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string, readOnly = false) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial, readOnly })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  const widget = () => view.container.querySelector<HTMLElement>('.live-md-annotate')!;
  return { ...view, editor, widget };
}

/** Pointer events without a PointerEvent in jsdom: a mouse event of the pointer type, carrying the fields the controller reads. */
function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
}

/** A drag in image percentages: x% of 400 px, y% of 200 px, from the box's corner. */
const at = (x: number, y: number) => [100 + x * 4, 50 + y * 2] as const;

const stage = (widget: () => HTMLElement) => widget().querySelector<HTMLElement>('.ann-stage')!;
const startAnnotating = (widget: () => HTMLElement) => fireEvent.click(within(widget()).getByRole('button', { name: /Click the image to drop a pin/ }));
const doc = (editor: EditorView) => editor.state.doc.toString();
const type = (field: HTMLTextAreaElement, value: string) => fireEvent.input(field, { target: { value } });
const saveWithKeys = (field: HTMLTextAreaElement) => fireEvent.keyDown(field, { key: 'Enter', metaKey: true });

describe('an annotate block in the live editor: the toolbar', () => {
  it('shows the figure with a toolbar holding the open count, Annotate, Show resolved, Markdown and Remove', async () => {
    const { widget } = await mount(DOC);
    const root = widget();
    expect(root.dataset.directiveType).toBe('annotate');
    const toolbar = within(root).getByRole('toolbar', { name: 'Image annotation toolbar' });
    expect(toolbar).toHaveTextContent('Image annotations · 2 open');
    expect(within(toolbar).getByRole('button', { name: /Click the image to drop a pin/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(toolbar).getByRole('button', { name: 'Show resolved (1)' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Edit this block as Markdown' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /Turn this block back into the plain image/ })).toBeInTheDocument();
    expect(root.querySelector('figure.ann-figure .ann-marker.ann-n-1')).not.toBeNull();
    // Not the generic block widget, whose format select would list the generic blocks.
    expect(root.querySelector('.live-directive-type-select')).toBeNull();
  });

  it('shows no toolbar and no editing layers in a read-only note', async () => {
    const { widget, editor } = await mount(DOC, true);
    const root = widget();
    expect(root.querySelector('[role=toolbar]')).toBeNull();
    expect(root.querySelector('.ann-edit-under, .ann-edit-over')).toBeNull();
    expect(root.querySelector('.ann-stage')!.hasAttribute('tabindex')).toBe(false);
    expect(root.querySelector('figure.ann-figure')).not.toBeNull();
    expect(doc(editor)).toBe(DOC);
  });

  it('draws a block inside a blockquote without an editing toolbar beyond Markdown', async () => {
    const { widget } = await mount(`> :::annotate\n> ${IMG}\n> :::`);
    const toolbar = widget().querySelector('[role=toolbar]')!;
    expect(toolbar).toHaveTextContent('Markdown');
    expect(within(toolbar as HTMLElement).queryByRole('button', { name: /drop a pin/ })).toBeNull();
    expect(widget().querySelector('.ann-edit-under')).toBeNull();
  });

  it('shows the resolved group and its markers with Show resolved, and hides them again', async () => {
    const { widget, editor } = await mount(DOC);
    const details = () => widget().querySelector<HTMLDetailsElement>('details.ann-resolved')!;
    expect(details().open).toBe(false);
    fireEvent.click(within(widget()).getByRole('button', { name: 'Show resolved (1)' }));
    expect(details().open).toBe(true);
    fireEvent.click(within(widget()).getByRole('button', { name: 'Hide resolved (1)' }));
    expect(details().open).toBe(false);
    expect(doc(editor)).toBe(DOC);
  });
});

describe('adding an annotation', () => {
  it('writes a pin as one undo step: click, type, Mod+Enter', async () => {
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    const under = widget().querySelector('.ann-edit-under')!;
    pointer(under, 'pointerdown', ...at(25, 50));
    pointer(under, 'pointerup', ...at(25, 50));
    const field = await screen.findByRole('textbox', { name: 'Comment for pin 4' });
    // Nothing is written until the comment is saved.
    expect(doc(editor)).toBe(DOC);
    expect(widget().querySelector('.ann-pending')).not.toBeNull();
    type(field as HTMLTextAreaElement, 'new note');
    saveWithKeys(field as HTMLTextAreaElement);
    await waitFor(() => expect(doc(editor)).toBe(DOC.replace('\n:::\n\nafter', '\n- {#4 pin x=25% y=50%} new note\n:::\n\nafter')));
    expect(widget().querySelector('.ann-marker.ann-n-4')).not.toBeNull();
    // The new annotation is selected and the mode stays on for the next one.
    expect(widget().querySelector('.ann-item.ann-n-4')).toHaveClass('is-selected');
    expect(widget().classList.contains('is-annotating')).toBe(true);
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('frames a region by dragging, in whichever direction', async () => {
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    const under = widget().querySelector('.ann-edit-under')!;
    pointer(under, 'pointerdown', ...at(60, 70));
    pointer(under, 'pointermove', ...at(40, 50));
    expect(widget().querySelector('.ann-feedback-region')).not.toBeNull();
    pointer(under, 'pointerup', ...at(40, 50));
    const field = await screen.findByRole('textbox', { name: 'Comment for region 4' });
    type(field as HTMLTextAreaElement, 'a box');
    saveWithKeys(field as HTMLTextAreaElement);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 region x=40% y=50% w=20% h=20%} a box\n:::'));
  });

  it('treats a drag under 1% as a pin and a tiny wobble as a click', async () => {
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    const under = widget().querySelector('.ann-edit-under')!;
    pointer(under, 'pointerdown', ...at(10, 10));
    pointer(under, 'pointermove', 100 + 10 * 4 + 2, 50 + 10 * 2 + 2);
    pointer(under, 'pointerup', 100 + 10 * 4 + 2, 50 + 10 * 2 + 2);
    const field = await screen.findByRole('textbox', { name: 'Comment for pin 4' });
    type(field as HTMLTextAreaElement, 'p');
    saveWithKeys(field as HTMLTextAreaElement);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 pin x=10% y=10%} p'));
  });

  it('writes nothing when the form is cancelled with Escape or left empty', async () => {
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    const under = widget().querySelector('.ann-edit-under')!;
    pointer(under, 'pointerdown', ...at(5, 5));
    pointer(under, 'pointerup', ...at(5, 5));
    const field = await screen.findByRole('textbox', { name: 'Comment for pin 4' });
    type(field as HTMLTextAreaElement, 'typed');
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(widget().querySelector('.ann-pending')).toBeNull());
    expect(doc(editor)).toBe(DOC);

    pointer(widget().querySelector('.ann-edit-under')!, 'pointerdown', ...at(5, 5));
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerup', ...at(5, 5));
    const empty = await screen.findByRole('textbox', { name: 'Comment for pin 4' });
    fireEvent.blur(empty);
    await waitFor(() => expect(widget().querySelector('.ann-pending')).toBeNull());
    expect(doc(editor)).toBe(DOC);
  });

  it('saves a pending annotation that has text when focus leaves the form', async () => {
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerdown', ...at(5, 5));
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerup', ...at(5, 5));
    const field = (await screen.findByRole('textbox', { name: 'Comment for pin 4' })) as HTMLTextAreaElement;
    type(field, 'kept');
    fireEvent.blur(field);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 pin x=5% y=5%} kept'));
  });

  it('puts the signed-in login in by= when the session knows one, and leaves it out locally', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ authenticated: true, login: 'molly' }))));
    const { widget, editor } = await mount(DOC);
    startAnnotating(widget);
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerdown', ...at(5, 5));
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerup', ...at(5, 5));
    const field = (await screen.findByRole('textbox', { name: 'Comment for pin 4' })) as HTMLTextAreaElement;
    type(field, 'hosted');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 pin x=5% y=5% by=molly} hosted'));
  });

  it('adds nothing on a press outside annotate mode', async () => {
    const { widget, editor } = await mount(DOC);
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerdown', ...at(5, 5));
    pointer(widget().querySelector('.ann-edit-under')!, 'pointerup', ...at(5, 5));
    expect(widget().querySelector('.ann-pending')).toBeNull();
    expect(doc(editor)).toBe(DOC);
  });

  it('leaves annotate mode with Escape, after deselecting', async () => {
    const { widget } = await mount(DOC);
    startAnnotating(widget);
    expect(widget().classList.contains('is-annotating')).toBe(true);
    fireEvent.keyDown(stage(widget), { key: 'Escape' });
    expect(widget().classList.contains('is-annotating')).toBe(false);
  });
});

describe('editing an annotation', () => {
  const select = (widget: () => HTMLElement, id: number) => fireEvent.click(widget().querySelector(`.ann-marker.ann-n-${id}`)!);

  it('selects with a click on a marker, shows Edit, Resolve and Delete, and changes no text', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 1);
    const item = widget().querySelector('.ann-item.ann-n-1')!;
    expect(item).toHaveClass('is-selected');
    expect(widget().querySelector('.ann-marker.ann-n-1')).toHaveClass('is-selected');
    for (const name of ['Edit', 'Resolve', 'Delete']) expect(within(item as HTMLElement).getByRole('button', { name })).toBeInTheDocument();
    expect(doc(editor)).toBe(DOC);
  });

  it('moves a selected pin by dragging it: one change to one line, one undo step', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 1);
    const handle = widget().querySelector('.ann-move-pin')!;
    pointer(handle, 'pointerdown', ...at(10, 20));
    pointer(handle, 'pointermove', ...at(30, 45));
    expect(doc(editor)).toBe(DOC);
    pointer(handle, 'pointerup', ...at(30, 45));
    expect(doc(editor)).toBe(DOC.replace('x=10% y=20%', 'x=30% y=45%'));
    expect(widget().querySelector('.ann-item.ann-n-1')).toHaveClass('is-selected');
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('moves a selected region by dragging its body', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 2);
    const box = widget().querySelector('.ann-move-box')!;
    pointer(box, 'pointerdown', ...at(35, 42));
    pointer(box, 'pointermove', ...at(45, 52));
    pointer(box, 'pointerup', ...at(45, 52));
    expect(doc(editor)).toBe(DOC.replace('x=30% y=40% w=20% h=10%', 'x=40% y=50% w=20% h=10%'));
  });

  it('resizes a region from a corner handle', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 2);
    const handle = widget().querySelector('.ann-handle-se')!;
    pointer(handle, 'pointerdown', ...at(50, 50));
    pointer(handle, 'pointermove', ...at(70, 60));
    pointer(handle, 'pointerup', ...at(70, 60));
    expect(doc(editor)).toBe(DOC.replace('x=30% y=40% w=20% h=10%', 'x=30% y=40% w=40% h=20%'));
  });

  it('does not write when a drag is released where it began', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 1);
    const handle = widget().querySelector('.ann-move-pin')!;
    pointer(handle, 'pointerdown', ...at(10, 20));
    pointer(handle, 'pointerup', ...at(10, 20));
    expect(doc(editor)).toBe(DOC);
  });

  it('resolves and reopens with one added or removed word, keeping the selection', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 1);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Resolve' }));
    expect(doc(editor)).toBe(DOC.replace('x=10% y=20%}', 'x=10% y=20% resolved}'));
    expect(widget().querySelector('.ann-item.ann-n-1')).toHaveClass('is-selected');
    expect(widget().querySelector('[role=toolbar]')).toHaveTextContent('1 open');
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Reopen' }));
    expect(doc(editor)).toBe(DOC);
  });

  it('edits a comment: Edit opens a textarea, Mod+Enter writes only that comment', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 2);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-2') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const field = (await screen.findByRole('textbox', { name: 'Comment for region 2' })) as HTMLTextAreaElement;
    expect(field.value).toBe('second\nmore');
    type(field, 'rewritten');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toBe(DOC.replace('second\n  more', 'rewritten')));
  });

  it('cancels a comment edit with Escape and writes nothing', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.doubleClick(widget().querySelector('.ann-item.ann-n-1 .ann-comment')!);
    const field = (await screen.findByRole('textbox', { name: 'Comment for pin 1' })) as HTMLTextAreaElement;
    type(field, 'nope');
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment for pin 1' })).toBeNull());
    expect(doc(editor)).toBe(DOC);
  });

  it('deletes the row without asking, selects the next one, and does not renumber', async () => {
    const { widget, editor } = await mount(DOC);
    select(widget, 1);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Delete' }));
    expect(doc(editor)).toBe(DOC.replace('- {#1 pin x=10% y=20%} first\n', ''));
    expect(widget().querySelector('.ann-item.ann-n-2')).toHaveClass('is-selected');
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('keeps the selection and the resolved filter across edits made elsewhere', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(within(widget()).getByRole('button', { name: 'Show resolved (1)' }));
    select(widget, 2);
    const from = doc(editor).indexOf('before');
    editor.dispatch({ changes: { from, to: from + 6, insert: 'BEFORE' } });
    expect(widget().querySelector('.ann-item.ann-n-2')).toHaveClass('is-selected');
    expect(widget().querySelector<HTMLDetailsElement>('details.ann-resolved')!.open).toBe(true);
  });

  it('redraws in the same element when its text changes, so nothing is rebuilt around a form', async () => {
    const { widget, editor } = await mount(DOC);
    const before = widget();
    select(widget, 1);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Resolve' }));
    expect(widget()).toBe(before);
    expect(doc(editor)).toContain('resolved');
  });
});

describe('the keyboard', () => {
  const press = (widget: () => HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(stage(widget), { key, ...init });

  it('adds a pin at the centre with P and a 20% region with R, then Enter reaches the comment', async () => {
    const { widget, editor } = await mount(DOC);
    stage(widget).focus();
    press(widget, 'p');
    expect(widget().querySelector('.ann-pending-pin')).not.toBeNull();
    // Focus stays on the image so the arrows move the marker; Enter takes it to the comment.
    await Promise.resolve();
    expect(document.activeElement).toBe(stage(widget));
    const field = (await screen.findByRole('textbox', { name: 'Comment for pin 4' })) as HTMLTextAreaElement;
    type(field, 'by key');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 pin x=50% y=50%} by key'));
  });

  it('moves a pending marker with the arrows before it is saved', async () => {
    const { widget, editor } = await mount(DOC);
    press(widget, 'r');
    press(widget, 'ArrowRight');
    press(widget, 'ArrowDown', { shiftKey: true });
    press(widget, 'ArrowRight', { altKey: true });
    const field = (await screen.findByRole('textbox', { name: 'Comment for region 4' })) as HTMLTextAreaElement;
    type(field, 'moved');
    saveWithKeys(field);
    await waitFor(() => expect(doc(editor)).toContain('- {#4 region x=40.5% y=45% w=20.5% h=20%} moved'));
  });

  it('nudges a selected annotation by 0.5%, or 5% with Shift, and a run of nudges is one undo step', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-1')!);
    press(widget, 'ArrowRight');
    press(widget, 'ArrowRight');
    press(widget, 'ArrowRight', { shiftKey: true });
    expect(doc(editor)).toBe(DOC.replace('x=10% y=20%', 'x=16% y=20%'));
    undo(editor);
    expect(doc(editor)).toBe(DOC);
    press(widget, 'ArrowDown', { shiftKey: true });
    expect(doc(editor)).toBe(DOC.replace('x=10% y=20%', 'x=10% y=25%'));
  });

  it('resizes a selected region with Alt and the arrows', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-2')!);
    press(widget, 'ArrowRight', { altKey: true, shiftKey: true });
    expect(doc(editor)).toContain('x=30% y=40% w=25% h=10%');
  });

  it('opens the comment of the selected annotation with Enter and deletes it with Delete', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-1')!);
    press(widget, 'Enter');
    expect(await screen.findByRole('textbox', { name: 'Comment for pin 1' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment for pin 1' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Comment for pin 1' })).toBeNull());
    press(widget, 'Delete');
    expect(doc(editor)).not.toContain('first');
  });

  it('leaves the selection with Escape', async () => {
    const { widget } = await mount(DOC);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-1')!);
    press(widget, 'Escape');
    expect(widget().querySelector('.is-selected')).toBeNull();
  });

  it('undoes and redoes with the keyboard while focus is in the widget', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-1')!);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-1') as HTMLElement).getByRole('button', { name: 'Resolve' }));
    expect(doc(editor)).toContain('resolved}');
    press(widget, 'z', { metaKey: true });
    expect(doc(editor)).toBe(DOC);
    press(widget, 'z', { metaKey: true, shiftKey: true });
    expect(doc(editor)).toContain('x=10% y=20% resolved}');
    press(widget, 'z', { ctrlKey: true });
    press(widget, 'y', { ctrlKey: true });
    expect(doc(editor)).toContain('x=10% y=20% resolved}');
  });
});

describe('damaged rows and removing annotations', () => {
  const DAMAGED = `:::annotate\n${IMG}\n\n- {#1 pin x=1% y=1%} one\n- {#1 pin x=2% y=2%} dup\n- {pin x=3% y=3%} none\n- {#5 pin x=4% y=4% reslved} typo\n:::`;

  it('keeps every row byte for byte through an edit of another row, and Fix numbering repairs numbers only', async () => {
    const { widget, editor } = await mount(DAMAGED);
    fireEvent.click(widget().querySelector('.ann-marker.ann-n-5')!);
    fireEvent.click(within(widget().querySelector('.ann-item.ann-n-5') as HTMLElement).getByRole('button', { name: 'Resolve' }));
    expect(doc(editor)).toBe(DAMAGED.replace('y=4% reslved}', 'y=4% reslved resolved}'));
    undo(editor);
    fireEvent.click(within(widget()).getByRole('button', { name: /Give rows with a missing/ }));
    expect(doc(editor)).toBe(DAMAGED.replace('{#1 pin x=2%', '{#6 pin x=2%').replace('{pin x=3%', '{#7 pin x=3%'));
    expect(within(widget()).queryByRole('button', { name: /Give rows with a missing/ })).toBeNull();
  });

  it('turns the block back into its image with Remove annotations, as one undo step', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(within(widget()).getByRole('button', { name: /Turn this block back into the plain image/ }));
    expect(doc(editor)).toBe(`before\n\n${IMG}\n\nafter`);
    undo(editor);
    expect(doc(editor)).toBe(DOC);
  });

  it('shows a block error as the error box with only the Markdown button', async () => {
    const { widget } = await mount(':::annotate\nnot an image\n:::');
    expect(widget().querySelector('.ann-error')).not.toBeNull();
    const toolbar = widget().querySelector('[role=toolbar]') as HTMLElement;
    expect(within(toolbar).queryByRole('button', { name: /drop a pin/ })).toBeNull();
    expect(within(toolbar).getByRole('button', { name: 'Edit this block as Markdown' })).toBeInTheDocument();
  });
});
