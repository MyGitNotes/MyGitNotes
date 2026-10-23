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

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const BLOCK = ':::key-numbers{title="At a glance"}\n- **213 ha**｜Airport area\n- 5.6 million｜Passengers\n:::';
const DOC = `before\n\n${BLOCK}\n\nafter`;

function Editor({ initial, readOnly = false }: { initial: string; readOnly?: boolean; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string, readOnly = false) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial, readOnly })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  const widget = () => view.container.querySelector<HTMLElement>('.live-md-infographic');
  return { ...view, editor, widget };
}

const openEditor = () => fireEvent.click(screen.getByRole('button', { name: 'Edit data' }));
const dataEditor = () => screen.getByRole('group', { name: 'Infographic data editor: Key numbers' });
const gridInput = (root: HTMLElement) => root.querySelector<HTMLInputElement>('.ig-cell-input')!;

describe('an infographic block in the live editor', () => {
  it('shows the figure with a toolbar: kind, title, palette, Edit data and Markdown', async () => {
    const { widget } = await mount(DOC);
    const root = widget()!;
    expect(root.dataset.directiveType).toBe('key-numbers');
    const toolbar = within(root).getByRole('toolbar', { name: 'Infographic toolbar' });
    expect(toolbar).toHaveTextContent('Key numbers');
    expect(within(toolbar).getByRole('textbox', { name: 'Infographic title' })).toHaveValue('At a glance');
    expect(within(toolbar).getByRole('combobox', { name: 'Palette' })).toHaveValue('');
    expect(within(toolbar).getByRole('button', { name: 'Edit data' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Markdown' })).toBeInTheDocument();
    expect(root.querySelector('.live-directive-preview-content')).not.toBeNull();
    // Not the generic block widget, whose format select would list the generic blocks.
    expect(root.querySelector('.live-directive-type-select')).toBeNull();
  });

  it('opens the data editor from the button and by double-clicking the figure, and Cancel returns to the figure', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    expect(dataEditor()).toBeInTheDocument();
    expect(widget()!.querySelector('.live-directive-toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());
    expect(widget()!.querySelector('.live-directive-toolbar')).not.toBeNull();
    expect(editor.state.doc.toString()).toBe(DOC);

    fireEvent.doubleClick(widget()!.querySelector('.live-directive-preview-content')!);
    expect(dataEditor()).toBeInTheDocument();
  });

  it('keeps the document and the widget untouched while the writer types, and writes once on save', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    const root = widget()!;
    const input = gridInput(root);
    expect(input).toHaveFocus();
    const dispatch = vi.spyOn(editor, 'dispatch');

    fireEvent.keyDown(input, { key: 'N' });
    for (const value of ['N', 'Ne', 'New', 'New label']) fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'x' });
    fireEvent.change(input, { target: { value: 'x' } });

    // Typing and moving never reached the document, and the widget is the same element with its focus intact.
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe(DOC);
    expect(widget()).toBe(root);
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    const writes = dispatch.mock.calls.filter(([spec]) => typeof spec === 'object' && spec !== null && 'changes' in spec);
    expect(writes).toHaveLength(1);
    const saved = `before\n\n:::key-numbers{title="At a glance"}\n- New label｜Airport area\n- 5.6 million｜x\n:::\n\nafter`;
    expect(editor.state.doc.toString()).toBe(saved);
    // The editor is gone and the figure is back; one undo restores the block.
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());
    expect(widget()).not.toBe(root);
    undo(editor);
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it('closes without a change when saved untouched', async () => {
    const { editor } = await mount(DOC);
    const dispatch = vi.spyOn(editor, 'dispatch');
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());
    expect(dispatch.mock.calls.filter(([spec]) => typeof spec === 'object' && spec !== null && 'changes' in spec)).toHaveLength(0);
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it('commits the title field and the palette select as one change each', async () => {
    const { widget, editor } = await mount(DOC);
    const title = within(widget()!).getByRole('textbox', { name: 'Infographic title' });
    fireEvent.change(title, { target: { value: 'Basics' } });
    fireEvent.blur(title);
    expect(editor.state.doc.toString()).toBe(DOC.replace('At a glance', 'Basics'));
    const palette = within(widget()!).getByRole('combobox', { name: 'Palette' });
    fireEvent.change(palette, { target: { value: 'diverging' } });
    expect(editor.state.doc.toString()).toBe(DOC.replace('At a glance', 'Basics').replace('{title="Basics"}', '{title="Basics" palette="diverging"}'));
  });

  it('puts the cursor in the block with the Markdown button, which shows the source', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(within(widget()!).getByRole('button', { name: 'Markdown' }));
    const { head } = editor.state.selection.main;
    expect(head).toBeGreaterThan(DOC.indexOf(':::key-numbers'));
    expect(head).toBeLessThan(DOC.indexOf('\nafter'));
    await waitFor(() => expect(widget()).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Note content' }).textContent).toContain(':::key-numbers{title="At a glance"}');
    // The cursor stays where it was put, and so does the source.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(editor.state.selection.main.head).toBe(head);
    expect(widget()).toBeNull();
  });

  it('opens a block the grid cannot hold in Markdown only, naming the first problem', async () => {
    const stray = ':::parts\nStray text\n- a｜1\n:::';
    const { widget, editor } = await mount(`first\n\n${stray}`);
    const root = widget()!;
    expect(within(root).queryByRole('button', { name: 'Edit data' })).toBeNull();
    expect(within(root).queryByRole('textbox', { name: 'Infographic title' })).toBeNull();
    expect(within(root).getByRole('note')).toHaveTextContent('This block opens in Markdown: Line 4 is text outside the list.');
    fireEvent.doubleClick(root.querySelector('.live-directive-preview-content')!);
    expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull();
    await waitFor(() => expect(widget()).toBeNull());
    expect(editor.state.doc.toString()).toBe(`first\n\n${stray}`);
  });

  it('shows read-only notes the figure without a toolbar or editor', async () => {
    const { widget } = await mount(DOC, true);
    const root = widget()!;
    expect(root.querySelector('.live-directive-toolbar')).toBeNull();
    fireEvent.doubleClick(root.querySelector('.live-directive-preview-content')!);
    expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull();
  });

  it('leaves the child containers outside an infographic to the generic block widget', async () => {
    const { container } = await mount(':::scenario{label="x"}\n- a｜1\n:::');
    await waitFor(() => expect(container.querySelector('.live-md-directive')).not.toBeNull());
    expect(container.querySelector('.live-md-infographic')).toBeNull();
  });
});
