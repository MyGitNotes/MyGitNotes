// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { I18nProvider } from '../lib/i18n/index.js';
import { MarkdownEditor } from './MarkdownEditor.js';

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

const BLOCK = '::::argument-map{title="Umbrella"}\n- [C] Take an umbrella\n\n:::reason{to="C" id="R1"}\n- [W] It will rain\n:::\n\n:::objection{to="W" id="O1"}\n- Forecasts are often wrong\n:::\n::::';
const DOC = `before\n\n${BLOCK}\n\nafter`;

function Editor({ initial, readOnly = false }: { initial: string; readOnly?: boolean; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'live', readOnly, onChange: setContent, ariaLabel: 'Note content' });
}

async function mount(initial: string, readOnly = false) {
  const view = render(createElement(I18nProvider, null, createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial, readOnly })))));
  const editor = EditorView.findFromDOM(await screen.findByRole('textbox', { name: 'Note content' }, { timeout: 5000 }))!;
  const widget = () => view.container.querySelector<HTMLElement>('.live-md-argument-map');
  return { ...view, editor, widget };
}

describe('an argument map block in the live editor', () => {
  it('shows the rendered figure with a toolbar holding an Edit button', async () => {
    const { widget } = await mount(DOC);
    const root = widget()!;
    expect(root.dataset.directiveType).toBe('argument-map');
    const toolbar = within(root).getByRole('toolbar', { name: 'Argument map toolbar' });
    expect(toolbar).toHaveTextContent('Argument map');
    expect(within(toolbar).getByRole('button', { name: 'Edit this argument map as Markdown' })).toHaveTextContent('Edit');
    expect(root.querySelector('figure.am-figure .am-root')).toHaveTextContent('Take an umbrella');
    expect(root.querySelectorAll('details.am-details[open]')).toHaveLength(2);
    // Not the generic block widget, whose format select would list the generic blocks, and not an infographic.
    expect(root.querySelector('.live-directive-type-select')).toBeNull();
    expect(root.classList.contains('live-md-infographic')).toBe(false);
  });

  it('switches views and collapses an argument inside the figure without touching the document', async () => {
    const { widget, editor } = await mount(DOC);
    const root = widget()!;
    const standard = root.querySelector<HTMLInputElement>('input.am-input-standard')!;
    expect(standard.checked).toBe(false);
    fireEvent.click(standard);
    expect(standard.checked).toBe(true);
    const details = root.querySelector<HTMLDetailsElement>('details.am-details')!;
    details.open = false;
    expect(details.open).toBe(false);
    expect(editor.state.doc.toString()).toBe(DOC);
    expect(widget()).toBe(root);
  });

  it('puts the cursor in the block with the Edit button, which shows the source', async () => {
    const { widget, editor } = await mount(DOC);
    fireEvent.click(within(widget()!).getByRole('button', { name: 'Edit this argument map as Markdown' }));
    const { head } = editor.state.selection.main;
    expect(head).toBeGreaterThan(DOC.indexOf('::::argument-map'));
    expect(head).toBeLessThan(DOC.indexOf('\nafter'));
    await waitFor(() => expect(widget()).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Note content' }).textContent).toContain('::::argument-map{title="Umbrella"}');
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it('keeps the figure when its tabs, arguments or body are clicked or double-clicked; only the Edit button opens the source', async () => {
    const { widget, editor } = await mount(DOC);
    const root = widget()!;
    for (const target of [root.querySelector('label.am-tab-standard')!, root.querySelector('summary')!, root.querySelector('.live-directive-preview-content')!]) {
      fireEvent.click(target);
      fireEvent.doubleClick(target);
    }
    // A press must not move the browser selection into the widget, which CodeMirror would read as entering the block.
    expect(fireEvent.mouseDown(root.querySelector('label.am-tab-map')!)).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(widget()).toBe(root);
    expect(editor.state.doc.toString()).toBe(DOC);
  });

  it('draws two blocks with the same text with ids of their own', async () => {
    const { container } = await mount(`${BLOCK}\n\ntext\n\n${BLOCK}`);
    await waitFor(() => expect(container.querySelectorAll('.live-md-argument-map')).toHaveLength(2));
    const ids = [...container.querySelectorAll('.live-md-argument-map [id]')].map(element => element.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows an argument map that cannot be drawn as an error box with the rest of the note', async () => {
    const { widget } = await mount(`${BLOCK.replace('to="W"', 'to="Z"')}\n\nafter`);
    const root = widget()!;
    expect(within(root).getByRole('alert')).toHaveTextContent('This argument map could not be drawn');
    expect(root.querySelector('.am-error-message')).toHaveTextContent('unknown id "Z"');
  });

  it('shows read-only notes the figure without a toolbar', async () => {
    const { widget } = await mount(DOC, true);
    const root = widget()!;
    expect(root.querySelector('.live-directive-toolbar')).toBeNull();
    expect(root.querySelector('figure.am-figure')).not.toBeNull();
    fireEvent.doubleClick(root.querySelector('.live-directive-preview-content')!);
    expect(widget()).toBe(root);
  });

  it('leaves reason and objection outside an argument map to the generic block widget', async () => {
    const { container } = await mount(':::reason{to="x"}\n- a\n:::');
    await waitFor(() => expect(container.querySelector('.live-md-directive')).not.toBeNull());
    expect(container.querySelector('.live-md-argument-map')).toBeNull();
  });
});
