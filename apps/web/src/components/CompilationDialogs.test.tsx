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
import { CompilationAddItem, CompilationEditRow } from './CompilationDialogs.js';

// A native select stands in for the Radix one, which jsdom cannot open.
vi.mock('./Select.js', () => ({ Select: ({ value, onValueChange, options, ...rest }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string; disabled?: boolean; }[]; }) => createElement('select', { ...rest, value, onChange: (event: { target: { value: string; }; }) => onValueChange(event.target.value) }, options.map(option => createElement('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label))) }));

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
  const onAdd = vi.fn<(items: CompilationItem[]) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: [], onAdd, onClose: () => {} }), { wrapper });
  const picker = screen.getByRole('combobox', { name: 'Notebook' });
  expect(picker).toHaveValue('r~a');
  expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual(['Company', 'Manual']);
  expect(await screen.findByText('X of r~a')).toBeInTheDocument();
  fireEvent.change(picker, { target: { value: 'r~b' } });
  fireEvent.click(await screen.findByText('X of r~b'));
  await waitFor(() => expect(onAdd).toHaveBeenCalled());
  const item = onAdd.mock.calls[0][0][0];
  expect(item).toMatchObject({ kind: 'note', notebookId: 'r~b', path: 'notes/b/x.md' });
  expect(requested.some(url => url.includes('r~b'))).toBe(true);
  const row: CompilationRow = { id: 'manual', name: 'Manual', notebookId: 'r~a', path: 'notes/a/manual.compilation.yml', view: 'book', kind: 'custom', items: [item] };
  const yaml = compilationText(row);
  expect(yaml).toContain('path: notes/b/x.md');
  expect(yaml).not.toContain('r~b');
});

it("lists the chosen notebook's folders", () => {
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [{ notebookId: 'r~b', path: 'guide', title: 'Guide' }] as never, items: [], onAdd: () => {}, onClose: () => {} }), { wrapper });
  fireEvent.change(screen.getByRole('combobox', { name: /Item type|Type/ }), { target: { value: 'folder' } });
  expect(screen.queryByText('notes/b/guide')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Notebook' }), { target: { value: 'r~b' } });
  expect(screen.getByText('notes/b/guide')).toBeInTheDocument();
});

it("keeps a folder source's own notebook when its compilation is edited, and shows its path (F002)", () => {
  const row: CompilationRow = { id: 'row', name: 'Manual', view: 'small', notebookId: 'r~a', path: 'notes/a/m.compilation.yml', kind: 'dynamic', source: { kind: 'folder', notebookId: 'r~b', path: 'notes/b/sub', recursive: true } };
  const onApply = vi.fn();
  render(createElement(CompilationEditRow, { row, notebooks, assets: [], folders: [], selectedNotebookId: 'r~a', onApply, onRemove: () => {}, onClose: () => {} }), { wrapper });
  expect(screen.getByRole('option', { name: 'notes/b/sub' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply.mock.calls[0][0].source).toEqual({ kind: 'folder', notebookId: 'r~b', path: 'notes/b/sub', recursive: true });
});

const meetings: CompilationItem[] = [{ id: 'internal', kind: 'heading', title: 'Internal meetings' }, { id: 'm1', kind: 'note', notebookId: 'r~a', path: 'notes/a/m1.md' }, { id: 'external', kind: 'heading', title: 'External meetings' }, { id: 'm2', kind: 'note', notebookId: 'r~a', path: 'notes/a/m2.md' }, { id: 'product', kind: 'heading', title: 'Product meetings' }, { id: 'm3', kind: 'note', notebookId: 'r~a', path: 'notes/a/m3.md' }];

it('offers no Chapter select when the compilation has no headings', () => {
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: meetings.filter(item => item.kind !== 'heading'), onAdd: () => {}, onClose: () => {} }), { wrapper });
  expect(screen.queryByRole('combobox', { name: 'Chapter' })).not.toBeInTheDocument();
});

it('adds at the end by default and, with a chapter chosen, as that chapter\'s last item', async () => {
  const onAdd = vi.fn<(items: CompilationItem[]) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: meetings, onAdd, onClose: () => {} }), { wrapper });
  const chapter = screen.getByRole('combobox', { name: 'Chapter' });
  expect(chapter).toHaveValue('');
  expect(within(chapter).getAllByRole('option').map(option => option.textContent)).toEqual(['At the end', 'Internal meetings', 'External meetings', 'Product meetings']);
  fireEvent.change(chapter, { target: { value: 'external' } });
  fireEvent.click(await screen.findByText('X of r~a'));
  await waitFor(() => expect(onAdd).toHaveBeenCalled());
  expect(onAdd.mock.calls[0][0].map(item => item.kind === 'heading' ? item.title : 'path' in item ? item.path : item.id)).toEqual(['Internal meetings', 'notes/a/m1.md', 'External meetings', 'notes/a/m2.md', 'notes/a/x.md', 'Product meetings', 'notes/a/m3.md']);
  cleanup();
  const atEnd = vi.fn<(items: CompilationItem[]) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: meetings, onAdd: atEnd, onClose: () => {} }), { wrapper });
  fireEvent.click(await screen.findByText('X of r~a'));
  await waitFor(() => expect(atEnd).toHaveBeenCalled());
  expect(atEnd.mock.calls[0][0].at(-1)).toMatchObject({ kind: 'note', path: 'notes/a/x.md' });
});

it('sets and clears the chapters by folder of a dynamic compilation from its Chapters select', () => {
  const row: CompilationRow = { id: 'row', name: 'Live', view: 'book', notebookId: 'r~a', path: 'notes/a/live.compilation.yml', kind: 'dynamic', source: { kind: 'tag', tag: 'meeting', notebookId: 'r~a' } };
  const onApply = vi.fn();
  const { rerender } = render(createElement(CompilationEditRow, { row, notebooks, assets: [], folders: [], selectedNotebookId: 'r~a', onApply, onRemove: () => {}, onClose: () => {} }), { wrapper });
  const chapters = screen.getByRole('combobox', { name: 'Chapters' });
  expect(chapters).toHaveValue('');
  expect(within(chapters).getAllByRole('option').map(option => option.textContent)).toEqual(['None', 'One per folder']);
  fireEvent.change(chapters, { target: { value: 'folder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply.mock.calls[0][0]).toMatchObject({ kind: 'dynamic', group: 'folder' });
  rerender(createElement(CompilationEditRow, { row: { ...row, group: 'folder' }, notebooks, assets: [], folders: [], selectedNotebookId: 'r~a', onApply, onRemove: () => {}, onClose: () => {} }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapters' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply.mock.calls[1][0]).not.toHaveProperty('group');
});

it("pins a note whole by default, or one heading's section picked from the note's headings, a repeated heading disabled", async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, notes: [{ ...noteOf('r~a', 'notes/a'), content: '## Monday\n\n### Action items\n\n## Tuesday\n\n### Action items\n' }] }), { headers: { 'Content-Type': 'application/json' } })));
  const onAdd = vi.fn<(items: CompilationItem[]) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: [], onAdd, onClose: () => {} }), { wrapper });
  fireEvent.click(await screen.findByText('X of r~a'));
  const picker = await screen.findByRole('combobox', { name: 'Heading in the note' });
  expect(picker).toHaveValue('');
  const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
  expect(options.map(option => [option.textContent!.trim(), option.disabled])).toEqual([['Whole note', false], ['Monday', false], ['Action items', false], ['Tuesday', false], ['Action items (Same text as an earlier heading; only the first can be pinned)', true]]);
  expect(onAdd).not.toHaveBeenCalled();
  fireEvent.change(picker, { target: { value: options[3].value } });
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect(onAdd.mock.calls[0][0]).toEqual([expect.objectContaining({ kind: 'note', path: 'notes/a/x.md', anchor: 'Tuesday' })]);
});

it('pins a note without headings at once, as before', async () => {
  const onAdd = vi.fn<(items: CompilationItem[]) => void>();
  render(createElement(CompilationAddItem, { rowName: 'Manual', notebookId: 'r~a', notebooks, assets: [], folders: [], items: [], onAdd, onClose: () => {} }), { wrapper });
  fireEvent.click(await screen.findByText('X of r~a'));
  await waitFor(() => expect(onAdd).toHaveBeenCalled());
  expect(onAdd.mock.calls[0][0][0]).not.toHaveProperty('anchor');
});
