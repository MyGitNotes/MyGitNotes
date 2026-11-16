// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookConfig } from '../lib/types.js';
import { compilationText } from '../lib/compilation-rows.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { CompilationOrderDialog } from './CompilationOrderDialog.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;
let fetched: string[];

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: Extract<CompilationRow, { kind: 'dynamic'; }> = { id: 'row-1', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'small', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'folder', path: 'notes/nb1', recursive: true, notebookId: 'nb1' }, sort: { field: 'title', order: 'asc' }, study: { filter: 'all', dueFirst: false, status: 'published' } };
const note = (name: string, mtime: number) => ({ id: `notes/nb1/${name}.md`, path: `notes/nb1/${name}.md`, notebookId: 'nb1', title: `Note ${name.toUpperCase()}`, tags: [], metadata: {}, mtime });

beforeEach(() => {
  fetched = [];
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(`${String(input)} ${typeof init?.body === 'string' ? init.body : ''}`);
      return new Response(JSON.stringify({ revision: REVISION, notes: [note('b', 300), note('a', 200), note('c', 100)] }), { headers: { 'Content-Type': 'application/json' } });
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
const titles = () => within(screen.getByRole('list', { name: 'Edit order' })).getAllByRole('listitem').map(item => item.textContent);

it('opens on a snapshot of the current order and saves every member path in that order', async () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave, onClose }), { wrapper });
  await waitFor(() => expect(titles()).toEqual(['1Note A', '2Note B', '3Note C']));
  fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
  expect(onSave).toHaveBeenCalledWith(['notes/nb1/a.md', 'notes/nb1/b.md', 'notes/nb1/c.md']);
  expect(onClose).toHaveBeenCalled();
});

it('starts from the stored manual order when the compilation already follows it', async () => {
  render(createElement(CompilationOrderDialog, { row: { ...row, sort: { field: 'manual', order: 'asc' }, manualOrder: ['notes/nb1/c.md'] }, notebooks, assets: [], disabled: false, onSave: () => {}, onClose: () => {} }), { wrapper });
  // C was placed by hand; A and B follow, oldest update first.
  await waitFor(() => expect(titles()).toEqual(['1Note C', '2Note A', '3Note B']));
});

it('loads every member regardless of the study status filter', async () => {
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave: () => {}, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(titles()).toHaveLength(3));
  expect(fetched.length).toBeGreaterThan(0);
  expect(fetched.some(request => request.includes('published'))).toBe(false);
});

it('saves nothing when cancelled', async () => {
  const onSave = vi.fn();
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(titles()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onSave).not.toHaveBeenCalled();
});

const custom: Extract<CompilationRow, { kind: 'custom'; }> = { id: 'row-c', path: 'notes/nb1/book.compilation.yml', name: 'Book', view: 'book', notebookId: 'nb1', kind: 'custom', items: [{ id: 'h1', kind: 'heading', title: 'Internal meetings' }, { id: 'ia', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'h2', kind: 'heading', title: 'External meetings' }, { id: 'ib', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }, { id: 'v', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
/** Each row as the dialog shows it: a heading by its title field, an item by its title, indented under a heading. */
const arranged = () => within(screen.getByRole('list', { name: 'Arrange contents' })).getAllByRole('listitem').map(row => row.hasAttribute('data-heading') ? `# ${within(row).getByRole('textbox', { name: 'Chapter title' }).getAttribute('value')}` : `${row.hasAttribute('data-indent') ? '  ' : ''}${row.querySelector('.compilation-order-title')!.textContent}`);

it('arranges a custom compilation: adds a chapter after the focused row, renames and removes headings, moves a row with the keyboard, and saves the flat list once', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    // Rows stack 40px apart and, as in a browser, a row's rect includes the translation dnd-kit gives it.
    if (this.matches('.compilation-order-list')) return { x: 0, y: 0, left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, toJSON() {} } as DOMRect;
    const row = this.closest<HTMLElement>('.compilation-order-row');
    const index = row ? [...row.parentElement!.children].indexOf(row) : 0;
    const top = index * 40 + Number(/translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(row?.style.transform ?? '')?.[1] ?? 0);
    return { x: 0, y: top, left: 0, top, width: 300, height: 36, right: 300, bottom: top + 36, toJSON() {} } as DOMRect;
  });
  const onSaveItems = vi.fn();
  render(createElement(CompilationOrderDialog, { row: custom, notebooks, assets: [], disabled: false, onSave: () => {}, onSaveItems, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(arranged()).toEqual(['# Internal meetings', '  Note A', '# External meetings', '  Note B', '  A talk']));
  // A new chapter goes after the row that has focus.
  fireEvent.focus(screen.getByRole('button', { name: 'Move item: Note A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add chapter' }));
  const fresh = screen.getAllByRole('textbox', { name: 'Chapter title' })[1];
  expect(fresh).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(fresh, { target: { value: 'Planning' } });
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Chapter title' })[0], { target: { value: 'Internal' } });
  expect(arranged()).toEqual(['# Internal', '  Note A', '# Planning', '# External meetings', '  Note B', '  A talk']);
  // Removing a heading keeps its items, which join the chapter before.
  fireEvent.click(screen.getByRole('button', { name: 'Remove chapter heading (items stay): External meetings' }));
  expect(arranged()).toEqual(['# Internal', '  Note A', '# Planning', '  Note B', '  A talk']);
  // Note B moves up one row with the keyboard, out of Planning into Internal.
  const handle = screen.getByRole('button', { name: 'Move item: Note B' });
  handle.focus();
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  await act(async () => void fireEvent.keyDown(handle, { code: 'ArrowUp', key: 'ArrowUp' }));
  await act(async () => void fireEvent.keyDown(handle, { code: 'Space', key: ' ' }));
  await waitFor(() => expect(arranged()).toEqual(['# Internal', '  Note A', '  Note B', '# Planning', '  A talk']));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSaveItems).toHaveBeenCalledTimes(1);
  const items = onSaveItems.mock.calls[0][0];
  expect(items.map((item: { id: string; }) => item.id).filter((id: string) => !['h1', 'ia', 'ib', 'v'].includes(id))).toHaveLength(1);
  expect(compilationText({ ...custom, items })).toMatch(/items:\n {2}- id: h1\n {4}kind: heading\n {4}title: Internal\n {2}- id: ia\n {4}kind: note\n {4}path: notes\/nb1\/a.md\n {2}- id: ib\n {4}kind: note\n {4}path: notes\/nb1\/b.md\n {2}- id: [\w-]+\n {4}kind: heading\n {4}title: Planning\n {2}- id: v\n/);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockRestore();
});

it('adds a chapter at the end when no row has focus', async () => {
  render(createElement(CompilationOrderDialog, { row: custom, notebooks, assets: [], disabled: false, onSave: () => {}, onSaveItems: () => {}, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(arranged()).toHaveLength(5));
  fireEvent.click(screen.getByRole('button', { name: 'Add chapter' }));
  expect(arranged().at(-1)).toBe('# ');
});

it('keeps the chapter separators of a dynamic compilation grouped by folder fixed and refuses a drop across one, saving one flat order', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ ...note('x/a', 300), title: 'Note A' }, { ...note('x/b', 200), title: 'Note B' }, { ...note('y/c', 100), title: 'Note C' }] }), { headers: { 'Content-Type': 'application/json' } })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.matches('.compilation-order-list')) return { x: 0, y: 0, left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400, toJSON() {} } as DOMRect;
    const row = this.closest<HTMLElement>('.compilation-order-row');
    const index = row ? [...row.parentElement!.children].indexOf(row) : 0;
    const top = index * 40 + Number(/translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(row?.style.transform ?? '')?.[1] ?? 0);
    return { x: 0, y: top, left: 0, top, width: 300, height: 36, right: 300, bottom: top + 36, toJSON() {} } as DOMRect;
  });
  const grouped = { ...row, study: undefined, group: 'folder' as const };
  const folders = [{ notebookId: 'nb1', path: 'x', title: 'Ex', order: 0 }, { notebookId: 'nb1', path: 'y', title: 'Why', order: 1 }];
  const onSave = vi.fn();
  render(createElement(CompilationOrderDialog, { row: grouped, notebooks, assets: [], folders, disabled: false, onSave, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(titles()).toEqual(['Ex', '1Note A', '2Note B', 'Why', '3Note C']));
  expect(screen.queryByRole('button', { name: /Move .*: Ex/ })).not.toBeInTheDocument();
  const move = async (label: string, key: 'ArrowUp' | 'ArrowDown') => {
    const handle = screen.getByRole('button', { name: label });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));
    await act(async () => void fireEvent.keyDown(handle, { code: key, key }));
    await act(async () => void fireEvent.keyDown(handle, { code: 'Space', key: ' ' }));
  };
  // Within a chapter a note moves; into the next chapter it does not.
  await move('Move item: Note B', 'ArrowUp');
  await waitFor(() => expect(titles()).toEqual(['Ex', '1Note B', '2Note A', 'Why', '3Note C']));
  await move('Move item: Note C', 'ArrowUp');
  expect(titles()).toEqual(['Ex', '1Note B', '2Note A', 'Why', '3Note C']);
  fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
  expect(onSave).toHaveBeenCalledWith(['notes/nb1/x/b.md', 'notes/nb1/x/a.md', 'notes/nb1/y/c.md']);
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockRestore();
});
