// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { type CompilationRow, parseCompilation } from '@mygitnotes/core/compilation';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { CompilationActionsProvider } from '../lib/compilation-actions.js';
import { compilationText } from '../lib/compilation-rows.js';
import { PanelProvider } from '../lib/panel-context.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { CompilationView } from './CompilationView.js';

vi.mock('../lib/note-editing.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/note-editing.js')>(), useEditorRegistry: () => () => () => {}, useNoteEditing: () => editing }));

const notebookId = 'nb1';
const root = 'notes/nb1';
const path = `${root}/reading.compilation.yml`;
const notebooks = [{ id: notebookId, title: 'NB1', root }];
const folders: [] = [];
const note = (filename: string, title: string) => ({ id: filename, path: `${root}/${filename}.md`, notebookId, title, content: `Body: ${title}`, metadata: {}, tags: [] });
const noteA = note('alpha/a', 'Note A');
const noteB = note('alpha/b', 'Note B');
const noteC = note('beta/c', 'Note C');
const noteD = note('alpha/d', 'Note D');
const item = (id: string, ref: NoteRef) => ({ ...ref, kind: 'note' as const, id });
const custom: CompilationRow = { id: 'reading', path, notebookId, name: 'Reading', kind: 'custom', view: 'book', items: [{ id: 'heading', kind: 'heading', title: 'Chapter' }, item('a', noteA), item('b', noteB)] };
const dynamic: CompilationRow = { id: 'reading', path, notebookId, name: 'Reading', kind: 'dynamic', view: 'small', source: { kind: 'folder', path: root, notebookId, recursive: true }, sort: { field: 'title', order: 'asc' } };
const save = vi.fn<(ref: NoteRef, text: string) => Promise<void>>();
const editing = { flushEditors: async () => true, refreshNotes: async () => {}, editorProps: () => ({ readOnly: false }), addToFocus: () => undefined };

beforeEach(() => {
  save.mockReset().mockResolvedValue();
  HTMLDialogElement.prototype.showModal ??= function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  setNoteQueryScope({ sourceId: 'test', revisions: {}, repositories: {}, drafts: {} });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open(row: CompilationRow, visible = [noteA, noteB], all = visible, options: { readOnly?: boolean; failPaths?: boolean; missingFromLookup?: string; assets?: { path: string; name: string; }[]; raw?: string; } = {}) {
  const stored = { id: row.id, path, notebookId, title: row.name, content: options.raw ?? compilationText(row), metadata: {}, tags: [] };
  const requests = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/notes/lookup') {
      const refs = JSON.parse(String(init?.body)).notes as NoteRef[];
      return Response.json({ notes: [stored, ...all].filter(result => result.path !== options.missingFromLookup && refs.some(ref => result.path === ref.path)) });
    }
    if (url.pathname === '/api/notes/query') {
      if (url.searchParams.get('select') === 'paths' && options.failPaths) return Response.json({ error: 'Membership unavailable' }, { status: 503 });
      return Response.json(url.searchParams.get('select') === 'paths' ? { notes: all.map(({ notebookId, path }) => ({ notebookId, path })) } : { notes: visible, total: all.length, nextCursor: visible.length < all.length ? 'next' : null });
    }
    return Response.json(url.pathname === '/api/assets' ? { assets: options.assets ?? [] } : {});
  });
  vi.stubGlobal('fetch', requests);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const actions = { save, canWrite: () => !options.readOnly, remove: vi.fn(), create: vi.fn(), repository: () => undefined };
  const wrapper = ({ children }: { children: ReactNode; }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PanelProvider>
          <CompilationActionsProvider value={actions}>{children}</CompilationActionsProvider>
        </PanelProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  render(createElement(CompilationView, { path, notebookId, notebooks, folders, frame: 'pane', onOpenNote: () => {} }), { wrapper });
  const book = row.view === 'book';
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if (this.classList.contains('screen-drag-overlay-frame')) {
      const style = this.parentElement!.style;
      return new DOMRect(Number.parseFloat(style.left), Number.parseFloat(style.top), Number.parseFloat(style.width), Number.parseFloat(style.height));
    }
    const slot = this.closest(book ? '.compilation-book-contents li' : '.screen-card-slot');
    const index = slot ? [...slot.parentElement!.children].indexOf(slot) : 0;
    return new DOMRect(book ? 0 : index * 200, book ? index * 40 : 0, 180, book ? 35 : 300);
  });
  return requests;
}

async function pickUp(label: string, root: HTMLElement = document.body) {
  const handle = await within(root).findByRole('button', { name: label });
  handle.focus();
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
  // The keyboard sensor attaches its document listener on the next task.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(handle).toHaveAttribute('aria-pressed', 'true');
  return handle;
}

async function drag(label: string, direction: 'ArrowDown' | 'ArrowRight' | 'ArrowUp' | 'ArrowLeft', root: HTMLElement = document.body) {
  const handle = await pickUp(label, root);
  fireEvent.keyDown(handle, { code: direction, key: direction });
  fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
}

const written = () => parseCompilation(save.mock.calls.at(-1)![1], [root]);

it('shows the description and preserves external YAML when applying compilation settings', async () => {
  const description = 'Notes for the next session';
  const external = 'translationKey: "reading"\n';
  const raw = `description: ${description}\n${external}${compilationText(custom)}`;
  open(custom, undefined, undefined, { raw });
  expect(await screen.findByText(description)).toBeVisible();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More compilation actions: Reading' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit compilation' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit compilation' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Compilation name' }), { target: { value: 'Next readings' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(written()).toMatchObject({ title: 'Next readings', description });
  expect(save.mock.calls[0][1].endsWith(external)).toBe(true);
});

it.each([{ handle: 'Move item: Note A', expected: ['heading', 'b', 'a'] }, { handle: 'Move chapter heading: Chapter', expected: ['a', 'heading', 'b'] }])('saves a custom book contents drop from $handle', async ({ handle, expected }) => {
  open(custom);
  await screen.findByText('Body: Note A');
  const contents = screen.getByRole('navigation', { name: 'Contents' });
  await drag(handle, 'ArrowDown', contents);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(written().items?.map(entry => entry.id)).toEqual(expected);
});

it('saves a touch pointer drag started on the book handle', async () => {
  open(custom);
  await screen.findByText('Body: Note A');
  const handle = screen.getByRole('button', { name: 'Move item: Note A' });
  // The same pointer sensor drives a mouse or touch handle. Move far enough to activate, then onto Note B.
  const pointer = (target: HTMLElement | Document, type: string, y: number) => {
    fireEvent(target, new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, pointerType: 'touch', clientX: 10, clientY: y }));
  };
  pointer(handle, 'pointerdown', 55);
  pointer(document, 'pointermove', 65);
  pointer(document, 'pointermove', 95);
  pointer(document, 'pointerup', 95);
  // dnd-kit keeps its document click suppressor for 50 ms after pointerup.
  await new Promise(resolve => setTimeout(resolve, 55));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(written().items?.map(entry => entry.id)).toEqual(['heading', 'b', 'a']);
});

it('keeps the contents drawer open after cancelling a drag or dropping a row', async () => {
  open(custom);
  await screen.findByText('Body: Note A');
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }));
  const drawer = screen.getByRole('dialog', { name: 'Contents' });
  const handle = await pickUp('Move item: Note A', drawer);
  fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
  fireEvent.keyDown(handle, { code: 'Escape', key: 'Escape' });
  expect(drawer).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  await drag('Move item: Note A', 'ArrowDown', drawer);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(drawer).toBeInTheDocument();
  expect(written().items?.map(entry => entry.id)).toEqual(['heading', 'b', 'a']);
});

it('leaves a pinned folder’s note sections as plain jump rows', async () => {
  open({ ...custom, items: [{ id: 'folder', kind: 'folder', notebookId, path: `${root}/alpha` }] }, [noteA]);
  const contents = await screen.findByRole('navigation', { name: 'Contents' });
  expect(await within(contents).findByRole('button', { name: 'Note A' })).toBeInTheDocument();
  expect(within(contents).queryByRole('button', { name: 'Move item: Note A' })).not.toBeInTheDocument();
  expect(within(contents).getByRole('button', { name: 'Move item: alpha' })).toBeInTheDocument();
});

it.each(['small', 'book'] as const)('hides %s handles on read-only or study-filtered compilations', async view => {
  open({ ...custom, view }, undefined, undefined, { readOnly: true });
  await screen.findByText('Body: Note A');
  expect(screen.queryByRole('button', { name: /^Move (item|chapter heading):/ })).not.toBeInTheDocument();
  cleanup();
  open({ ...custom, view, study: { status: 'Review', filter: 'all', dueFirst: false } });
  expect(await screen.findByRole('region', { name: custom.name })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Move (item|chapter heading):/ })).not.toBeInTheDocument();
});

it('drags a lane card from its always-available handle without a toggle in the header', async () => {
  open({ ...custom, view: 'small' });
  await screen.findByText('Body: Note A');
  expect(screen.queryByRole('button', { name: 'Toggle drag handles' })).not.toBeInTheDocument();
  await drag('Move item: Note A', 'ArrowRight');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(written().items?.map(entry => entry.id)).toEqual(['heading', 'b', 'a']);
});

it.each(['small', 'book'] as const)('saves every dynamic member in manual order from %s, including the unloaded members', async view => {
  const requests = open({ ...dynamic, view }, [noteA, noteC], [noteA, noteB, noteC, noteD]);
  await screen.findByText('Body: Note A');
  expect(screen.queryByText('Body: Note B')).not.toBeInTheDocument();
  await drag('Move item: Note A', view === 'book' ? 'ArrowDown' : 'ArrowRight');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(requests.mock.calls.some(([url]) => url.includes('select=paths'))).toBe(true);
  expect(written()).toMatchObject({ sort: { field: 'manual', order: 'asc' }, manualOrder: [noteB.path, noteC.path, noteA.path, noteD.path] });
});

it.each(['small', 'book'] as const)('refuses a %s drag from one folder chapter to another', async view => {
  const requests = open({ ...dynamic, view, group: 'folder' }, [noteA, noteC]);
  await screen.findByText('Body: Note A');
  expect(screen.queryByRole('button', { name: /^Move chapter heading:/ })).not.toBeInTheDocument();
  await drag('Move item: Note A', view === 'book' ? 'ArrowDown' : 'ArrowRight');
  expect(requests.mock.calls.some(([url]) => url.includes('select=paths'))).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it('keeps folder chapters fixed but can move an asset ahead of a note in its own chapter', async () => {
  const asset = { path: `${root}/alpha/diagram.pdf`, name: 'diagram.pdf' };
  open({ ...dynamic, group: 'folder' }, [noteA, noteB, noteC], undefined, { assets: [asset] });
  await screen.findByText('Body: Note B');
  await drag('Move item: diagram.pdf', 'ArrowLeft');
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(written().manualOrder).toEqual([noteA.path, asset.path, noteB.path, noteC.path]);
  await waitFor(() => expect([...document.querySelectorAll('.screen-card-title')].map(card => card.textContent)).toEqual(['Note A', 'diagram.pdf', 'Note B', 'Note C']));
});

it('reports a failed full-membership read without saving a partial order', async () => {
  open(dynamic, [noteA, noteC], [noteA, noteB, noteC], { failPaths: true });
  await screen.findByText('Body: Note A');
  await drag('Move item: Note A', 'ArrowRight');
  expect(await screen.findByRole('alert')).toHaveTextContent('Membership unavailable');
  expect(save).not.toHaveBeenCalled();
});

it('does not write if a listed member disappears from the full lookup', async () => {
  open(dynamic, [noteA, noteC], [noteA, noteB, noteC], { missingFromLookup: noteB.path });
  await screen.findByText('Body: Note A');
  await drag('Move item: Note A', 'ArrowRight');
  expect(await screen.findByRole('alert')).toHaveTextContent('Drag the item again');
  expect(save).not.toHaveBeenCalled();
});
