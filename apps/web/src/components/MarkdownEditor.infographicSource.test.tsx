// @vitest-environment jsdom
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { checkCells, parseInfographic } from '../lib/infographics/model.js';
import { MarkdownEditor } from './MarkdownEditor.js';

afterEach(cleanup);
// One Radix menu opening per file: in jsdom a second toolbar menu in the same file does not open.

function Editor({ initial }: { initial: string; }) {
  const [content, setContent] = useState(initial);
  return createElement(MarkdownEditor, { content, path: 'notes/a.md', mode: 'raw', readOnly: false, onChange: setContent, ariaLabel: 'Note content' });
}

it('inserts an infographic from the source toolbar as a block of its own and lists the kinds with a purpose each', async () => {
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial: 'first\n\n\nsecond' }))));
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
  textarea.setSelectionRange(7, 7);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Insert infographic' }), { key: 'Enter' });
  const menu = await screen.findByRole('menu');
  const items = within(menu).getAllByRole('menuitem');
  expect(items.map(item => item.querySelector('.infographic-insert-name')?.textContent)).toEqual(['Key numbers', 'Bars', 'Parts of a whole', 'Line chart', 'Timeline', 'Status board', 'Map']);
  for (const item of items) expect(item.querySelector('.infographic-insert-purpose')?.textContent).toBeTruthy();

  fireEvent.click(within(menu).getByRole('menuitem', { name: /Timeline/ }));
  const inserted = textarea.value.slice('first\n\n'.length, textarea.value.indexOf('\n\nsecond'));
  expect(textarea.value).toBe(`first\n\n${inserted}\n\nsecond`);
  const block = parseInfographic(inserted);
  expect(block?.kind).toBe('timeline');
  expect(block?.problems).toEqual([]);
  expect(checkCells(block!)).toEqual([]);
});

it('keeps the infographic kinds out of the generic block menu', () => {
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(Editor, { initial: '' }))));
  expect(screen.getByRole('button', { name: 'Insert infographic' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Insert block' })).toBeInTheDocument();
});
