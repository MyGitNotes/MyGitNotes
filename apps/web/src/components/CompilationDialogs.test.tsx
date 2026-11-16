// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationItem, CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookConfig } from '../lib/types.js';
import { compilationText } from '../lib/compilation-rows.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { CompilationAddItem } from './CompilationDialogs.js';

// A native select stands in for the Radix one, which jsdom cannot open.
vi.mock('./Select.js', () => ({
  Select: ({ value, onValueChange, options, ...rest }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string; }[]; }) => createElement('select', { ...rest, value, onChange: (event: { target: { value: string; }; }) => onValueChange(event.target.value) }, options.map(option => createElement('option', { key: option.value, value: option.value }, option.label))),
}));

const REVISION = 'f'.repeat(40);
let client: QueryClient;
let requested: string[];
const notebooks: NotebookConfig[] = [{ id: 'r~a', title: 'Company', root: 'notes/a' }, { id: 'r~b', title: 'Manual', root: 'notes/b' }, { id: 'other~c', title: 'Elsewhere', root: 'notes/c' }];
const noteOf = (notebookId: string, root: string) => ({ id: `${root}/x.md`, path: `${root}/x.md`, notebookId, title: `X of ${notebookId}`, tags: [], metadata: {} });

beforeEach(() => {
  requested = [];
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const text = decodeURIComponent(`${String(input)} ${typeof init?.body === 'string' ? init.body : ''}`);
      requested.push(text);
      const notes = text.includes('r~b') ? [noteOf('r~b', 'notes/b')] : text.includes('/assets') ? [] : [noteOf('r~a', 'notes/a')];
      return new Response(JSON.stringify(text.includes('/assets') ? { assets: [] } : { revision: REVISION, total: notes.length, notes }), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

it("offers the notebooks of the compilation's repository only, the compilation's own first, and pins a note of the chosen notebook by its repository path", async () => {
  const onAdd = vi.fn<(item: CompilationItem) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], onAdd, onClose: () => {} }), { wrapper });
  const picker = screen.getByRole('combobox', { name: 'Notebook' });
  expect(picker).toHaveValue('r~a');
  expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual(['Company', 'Manual']);
  expect(await screen.findByText('X of r~a')).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: 'r~b' } });
  fireEvent.click(await screen.findByText('X of r~b'));
  await waitFor(() => expect(onAdd).toHaveBeenCalled());
  const item = onAdd.mock.calls[0][0];
  expect(item).toMatchObject({ kind: 'note', notebookId: 'r~b', path: 'notes/b/x.md' });
  expect(requested.some(url => url.includes('r~b'))).toBe(true);
  const row: CompilationRow = { id: 'manual', name: 'Manual', notebookId: 'r~a', path: 'notes/a/manual.compilation.yml', view: 'book', kind: 'custom', items: [item] };
  const yaml = compilationText(row);
  expect(yaml).toContain('path: notes/b/x.md');
  expect(yaml).not.toContain('r~b');
});

it("lists the chosen notebook's folders", () => {
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [{ notebookId: 'r~b', path: 'guide', title: 'Guide' }] as never, onAdd: () => {}, onClose: () => {} }), { wrapper });
  fireEvent.change(screen.getByRole('combobox', { name: /Item type|Type/ }), { target: { value: 'folder' } });
  expect(screen.queryByText('notes/b/guide')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Notebook' }), { target: { value: 'r~b' } });
  expect(screen.getByText('notes/b/guide')).toBeInTheDocument();
});
