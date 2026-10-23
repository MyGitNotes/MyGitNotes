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
    const saved = `before\n\n:::key-numbers{title="At a glance"}\n- **New label**｜Airport area\n- 5.6 million｜x\n:::\n\nafter`;
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

// CodeMirror destroys a widget that leaves the viewport, and draws it again when it comes back. Revealing the block's
// source destroys it the same way, and works without layout, so it stands in for scrolling away and back.
describe('a data editor whose widget is destroyed and drawn again', () => {
  const away = (editor: EditorView, at = DOC.indexOf('Airport')) => {
    editor.focus();
    editor.dispatch({ selection: { anchor: at } });
  };
  const back = (editor: EditorView) => editor.dispatch({ selection: { anchor: 0 } });
  const writes = (dispatch: { mock: { calls: unknown[][]; }; }) => dispatch.mock.calls.filter(([spec]) => typeof spec === 'object' && spec !== null && 'changes' in spec);
  const draftCell = (row: number, col: number) => dataEditor().querySelector<HTMLElement>(`[data-cell][data-row="${row}"][data-col="${col}"]`)!.textContent;

  it('keeps the draft, the typed text and the selection, and still saves as one change', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    const input = gridInput(widget()!);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Draft title' } });
    fireEvent.keyDown(input, { key: 'N' });
    fireEvent.change(input, { target: { value: 'New label' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Left mid-edit: the text typed into the next cell is part of the draft too.
    fireEvent.keyDown(input, { key: 'x' });
    fireEvent.change(input, { target: { value: 'x' } });

    const root = widget()!;
    away(editor);
    await waitFor(() => expect(widget()).toBeNull());
    expect(editor.state.doc.toString()).toBe(DOC);
    back(editor);
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(widget()).not.toBe(root);

    expect(dataEditor()).toBeInTheDocument();
    expect(draftCell(0, 0)).toBe('New label');
    expect(draftCell(1, 0)).toBe('x');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Draft title');
    // The selection came back with it: the cell being typed in is the active one.
    expect(dataEditor().querySelector('[data-cell][data-active]')).toBe(dataEditor().querySelector('[data-cell][data-row="1"][data-col="0"]'));

    const dispatch = vi.spyOn(editor, 'dispatch');
    fireEvent.keyDown(gridInput(widget()!), { key: 'Enter', metaKey: true });
    expect(writes(dispatch)).toHaveLength(1);
    expect(editor.state.doc.toString()).toBe('before\n\n:::key-numbers{title="Draft title"}\n- **New label**｜Airport area\n- x｜Passengers\n:::\n\nafter');
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());
    undo(editor);
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it('keeps the active tab', async () => {
    const bars = '::::bars\n:::scenario{label="2025"}\n- A｜1\n:::\n:::scenario{label="2045"}\n- B｜2\n:::\n::::';
    const { widget, editor } = await mount(`before\n\n${bars}\n\nafter`);
    openEditor();
    fireEvent.click(screen.getByRole('tab', { name: '2045' }));
    away(editor, editor.state.doc.toString().indexOf('A｜'));
    await waitFor(() => expect(widget()).toBeNull());
    back(editor);
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(screen.getByRole('tab', { name: '2045' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '2025' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps the draft through an edit before the block, which only moves it', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    const input = gridInput(widget()!);
    fireEvent.keyDown(input, { key: 'N' });
    fireEvent.change(input, { target: { value: 'Moved' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    away(editor);
    await waitFor(() => expect(widget()).toBeNull());
    editor.dispatch({ changes: { from: 0, insert: 'intro\n\n' }, selection: { anchor: 0 } });
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(draftCell(0, 0)).toBe('Moved');

    const dispatch = vi.spyOn(editor, 'dispatch');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(writes(dispatch)).toHaveLength(1);
    expect(editor.state.doc.toString()).toBe('intro\n\nbefore\n\n:::key-numbers{title="At a glance"}\n- **Moved**｜Airport area\n- 5.6 million｜Passengers\n:::\n\nafter');
  });

  it("drops the draft when the block's text changes underneath, and draws the figure", async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    const input = gridInput(widget()!);
    fireEvent.keyDown(input, { key: 'N' });
    fireEvent.change(input, { target: { value: 'Lost' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    away(editor);
    await waitFor(() => expect(widget()).toBeNull());
    const at = DOC.indexOf('At a glance');
    editor.dispatch({ changes: { from: at, to: at + 'At a glance'.length, insert: 'Edited in source' }, selection: { anchor: 0 } });
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull();
    expect(widget()!.querySelector('.live-directive-preview-content')).not.toBeNull();
    expect(editor.state.doc.toString()).toContain('Edited in source');
    expect(editor.state.doc.toString()).not.toContain('Lost');
  });

  it('does not bring back an editor that was cancelled or saved', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    const input = gridInput(widget()!);
    fireEvent.keyDown(input, { key: 'N' });
    fireEvent.change(input, { target: { value: 'Never' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());

    away(editor);
    await waitFor(() => expect(widget()).toBeNull());
    back(editor);
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull();

    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull());
    away(editor, editor.state.doc.toString().indexOf('Airport'));
    await waitFor(() => expect(widget()).toBeNull());
    back(editor);
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(screen.queryByRole('group', { name: /data editor/ })).toBeNull();
  });

  it('does not take focus when the editor comes back', async () => {
    const { widget, editor } = await mount(DOC);
    openEditor();
    away(editor);
    await waitFor(() => expect(widget()).toBeNull());
    back(editor);
    await waitFor(() => expect(widget()).not.toBeNull());
    expect(dataEditor()).toBeInTheDocument();
    expect(gridInput(widget()!)).not.toHaveFocus();
  });
});
