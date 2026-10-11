// @vitest-environment jsdom
import { createElement, type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import { BOOK_READING_STORAGE_KEY, resetBookReadingMode, writeBookReadingMode } from '../lib/book-reading.js';
import { CompilationEditingProvider, useCompilationEditing } from '../lib/compilation-editing.js';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationBook } from './CompilationBook.js';

const flushEditors = vi.fn<(keys?: readonly string[]) => Promise<boolean>>();
const editorProps = vi.fn<(note: { notebookId: string; }) => { readOnly: boolean; }>();
vi.mock('../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes: async () => {}, editorProps }) }));
/** Paths whose editor renders into the page's body instead of the section, as a note's zoom borrowing it does. */
const portalled = new Set<string>();
vi.mock('./NoteEditorHost.js', () => ({
  HostedNoteEditor: ({ path, onSession }: { path: string; onSession?: (session: { content: string; title: string; dirty: boolean; locked: boolean; } | null) => void; }) => {
    useEffect(() => {
      onSession?.({ content: 'body', title: `Editing ${path}`, dirty: false, locked: false });
      return () => onSession?.(null);
    }, [onSession, path]);
    const editor = createElement('textarea', { 'aria-label': portalled.has(path) ? 'Zoom editor' : 'Note content', 'defaultValue': 'body' });
    return portalled.has(path) ? createPortal(editor, document.body) : editor;
  },
}));
const laneOverride: { current: ReturnType<typeof import('../lib/compilation-queries.js').useLaneNotes> | null; } = { current: null };
vi.mock('../lib/compilation-queries.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/compilation-queries.js')>();
  return { ...actual, useLaneNotes: (...args: Parameters<typeof actual.useLaneNotes>) => laneOverride.current ?? actual.useLaneNotes(...args) };
});

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const noteA = { id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {}, content: '# Chapter One\n\nThe body of note A.' };
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/reading.compilation.yml', name: 'Reading', view: 'book', notebookId: 'nb1', kind: 'custom', items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/gone.md' }, { id: 'item-3', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

beforeEach(() => {
  localStorage.clear();
  resetBookReadingMode();
  flushEditors.mockReset().mockResolvedValue(true);
  editorProps.mockReset().mockReturnValue({ readOnly: false });
  portalled.clear();
  laneOverride.current = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [noteA] }), { headers: { 'Content-Type': 'application/json' } })));
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const Editing = ({ children }: { children: ReactNode; }) => createElement(CompilationEditingProvider, { value: useCompilationEditing() }, children);
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, createElement(Editing, null, children));
const book = (props: Partial<Parameters<typeof CompilationBook>[0]> = {}) => createElement(CompilationBook, { row, study, notebooks, assets: [], onOpen: () => {}, disabled: false, readOnly: true, ...props });
const chapters = () => [...document.querySelectorAll<HTMLElement>('.compilation-book > .compilation-book-section')];

it('lays the items out in order as chapters: the full note, a missing notice in place, the video player', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  expect(screen.getByText('The body of note A.')).toBeInTheDocument();
  expect(within(chapters()[0]).getByRole('heading', { level: 2, name: 'Note A' })).toBeInTheDocument();
  expect(chapters().map(chapter => within(chapter).getByRole('heading', { level: 2 }).textContent)).toEqual(['Note A', 'gone.md', 'A talk']);
  expect(within(chapters()[1]).getByText('This item may have moved or been deleted.')).toBeInTheDocument();
  expect(within(chapters()[2]).getByLabelText('Play video: A talk')).toBeInTheDocument();
});

it('names every chapter in a Contents landmark, marks the missing one, and jumps to a chapter on click', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const nav = screen.getByRole('navigation', { name: 'Contents' });
  const entries = within(nav).getAllByRole('button');
  expect(entries.map(entry => entry.textContent)).toEqual(['Note A', 'gone.md', 'A talk']);
  expect(within(entries[1]).getByLabelText('This item may have moved or been deleted.')).toBeInTheDocument();
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  const heading = within(chapters()[2]).getByRole('heading', { level: 2 });
  body.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  heading.getBoundingClientRect = () => ({ top: 700 }) as DOMRect;
  body.scrollTop = 50;
  fireEvent.click(entries[2]);
  expect(body.scrollTo).toHaveBeenCalledWith({ top: 650, behavior: 'smooth' });
  expect(heading).toHaveFocus();
  expect(window.location.hash).toBe('');
});

it('jumps without animation for a reader who prefers reduced motion', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /A talk/ }));
  expect(document.querySelector<HTMLElement>('.compilation-book')!.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
});

it('highlights the entry whose heading last passed the top quarter of the body', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  const tops = [-500, 150, 900];
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: tops[index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /gone\.md/ })).toHaveAttribute('aria-current', 'location'));
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('button').filter(entry => entry.getAttribute('aria-current'))).toHaveLength(1);
});

it('opens an item from its heading', async () => {
  const onOpen = vi.fn();
  render(book({ onOpen }), { wrapper });
  fireEvent.click(await waitFor(() => within(chapters()[0]).getByRole('button', { name: 'Note A' })));
  expect(onOpen).toHaveBeenCalledWith(row.kind === 'custom' ? row.items[0] : undefined, expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it('is read-only: no Edit control, no drag handle or unpin control, and a body click opens the note', async () => {
  const onOpen = vi.fn();
  render(book({ onOpen }), { wrapper });
  await waitFor(() => expect(screen.getByText('The body of note A.')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Move item: Note A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Unpin: Note A')).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  fireEvent.click(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it("edits a note section in place, saves it for the next one, and follows the editor's title in the contents", async () => {
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  const section = chapters()[0];
  await waitFor(() => expect(section).toHaveAttribute('data-editing'));
  expect(within(section).getByLabelText('Note content')).toBeInTheDocument();
  expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Editing notes/nb1/a.md');
  expect(await within(screen.getByRole('navigation', { name: 'Contents' })).findByRole('button', { name: /Editing notes\/nb1\/a\.md/ })).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(section).not.toHaveAttribute('data-editing'));
  expect(flushEditors).toHaveBeenCalledWith(['nb1:notes/nb1/a.md']);
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /Note A/ })).toBeInTheDocument();
});

it('highlights the chapter that edits in the contents wherever the book is scrolled, and scrolling decides again once editing ends (B12)', async () => {
  const noteB = { ...noteA, id: 'notes/nb1/b.md', path: 'notes/nb1/b.md', title: 'Note B', content: '# Chapter Two\n\nThe body of note B.' };
  const pair: CompilationRow = { ...row, items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
  laneOverride.current = { notes: [noteA, noteB] as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} };
  render(book({ row: pair, readOnly: false }), { wrapper });
  await screen.findByRole('button', { name: 'Edit Note A' });
  const nav = screen.getByRole('navigation', { name: 'Contents' });
  const current = () => within(nav).getAllByRole('button').filter(entry => entry.getAttribute('aria-current') === 'location').map(entry => entry.textContent);
  // The reader has scrolled to the end of the book, where the second chapter is the one in view.
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: [-2000, 100][index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(current()).toEqual(['Note B']));
  // Editing the first chapter names it at once, though the book is still scrolled to the second.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  await waitFor(() => expect(current()).toEqual(['Editing notes/nb1/a.md']));
  act(() => void body.dispatchEvent(new Event('scroll')));
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  expect(current()).toEqual(['Editing notes/nb1/a.md']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  await waitFor(() => expect(current()).toEqual(['Note B']));
});

it('ends a section only on keys typed inside it, not on keys of its editor portalled into zoom (E4, K2)', async () => {
  portalled.add('notes/nb1/a.md');
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  const zoomEditor = await screen.findByLabelText('Zoom editor');
  expect(chapters()[0]).not.toContainElement(zoomEditor);
  fireEvent.keyDown(zoomEditor, { key: 'Escape' });
  await act(async () => {});
  expect(chapters()[0]).toHaveAttribute('data-editing');
  expect(flushEditors).not.toHaveBeenCalled();
});

it('holds same-named notes of different folders apart while one edits, as a note id is not unique (E11)', async () => {
  const notesAt = ['x', 'y'].map(folder => ({ id: 'index', path: `notes/nb1/${folder}/index.md`, notebookId: 'nb1', title: `Index ${folder}`, tags: [], metadata: {}, content: `Body of ${folder}` }));
  laneOverride.current = { notes: notesAt as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} };
  const same: CompilationRow = { ...row, items: ['x', 'y'].map(folder => ({ id: `pin-${folder}`, kind: 'note' as const, notebookId: 'nb1', path: `notes/nb1/${folder}/index.md` })) };
  render(book({ row: same, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Index x' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  expect(screen.getByText('Body of y')).toBeInTheDocument();
  expect(within(chapters()[1]).getByRole('button', { name: 'Edit Index y' })).toBeInTheDocument();
  expect(screen.queryByText('This item may have moved or been deleted.')).not.toBeInTheDocument();
  expect(chapters()).toHaveLength(2);
});

it('offers no Edit on a note whose repository cannot be written, though the compilation can (E13)', async () => {
  editorProps.mockImplementation(note => ({ readOnly: note.notebookId === 'nb1' }));
  const onOpen = vi.fn();
  render(book({ readOnly: false, onOpen }), { wrapper });
  await waitFor(() => expect(screen.getByText('The body of note A.')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  fireEvent.click(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  expect(chapters()[0]).not.toHaveAttribute('data-editing');
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it("lists a folder's notes as sub-sections under it, in the book and in the contents, each a note section", async () => {
  const folder: CompilationRow = { ...row, items: [{ id: 'folder-1', kind: 'folder', notebookId: 'nb1', path: 'notes/nb1/sub' }] };
  render(book({ row: folder, readOnly: false }), { wrapper });
  await waitFor(() => expect(within(chapters()[0]).getByRole('heading', { level: 3, name: 'Note A' })).toBeInTheDocument());
  expect(within(chapters()[0]).getByRole('heading', { level: 2, name: 'sub' })).toBeInTheDocument();
  expect(within(chapters()[0]).getByRole('button', { name: 'Edit Note A' })).toBeInTheDocument();
  const entries = within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('listitem');
  expect(entries.map(entry => [entry.textContent, entry.getAttribute('data-level')])).toEqual([['sub', '0'], ['Note A', '1']]);
});

it('shows the empty message and an empty contents list for a compilation with no members', () => {
  render(book({ row: { ...row, items: [] } }), { wrapper });
  expect(screen.getByText('Add notes, folders, assets or YouTube, or drag from another custom compilation.')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).queryAllByRole('button')).toHaveLength(0);
});

it('ends the contents list with Load more chapters while a paging dynamic compilation has more', async () => {
  const loadMore = vi.fn();
  laneOverride.current = { notes: [noteA] as never, loading: false, error: '', hasMore: true, loadingMore: false, loadMore };
  const dynamic: CompilationRow = { id: 'live', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'book', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'tag', tag: 'clue', notebookId: 'nb1' }, sort: { field: 'title', order: 'asc' } };
  render(book({ row: dynamic }), { wrapper });
  const more = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: 'Load more chapters' });
  fireEvent.click(more);
  expect(loadMore).toHaveBeenCalledTimes(1);
  laneOverride.current = { notes: [noteA] as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore };
  cleanup();
  render(book({ row: dynamic }), { wrapper });
  expect(screen.queryByRole('button', { name: 'Load more chapters' })).not.toBeInTheDocument();
});

it('moves the contents into a drawer behind a Contents button: choosing an entry closes it and jumps, Escape or the close button returns focus', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const open = screen.getByRole('button', { name: 'Show contents' });
  fireEvent.click(open);
  const drawer = screen.getByRole('dialog', { name: 'Contents' });
  expect(within(drawer).getByRole('button', { name: 'Close contents' })).toHaveFocus();
  fireEvent.click(within(drawer).getByRole('button', { name: /A talk/ }));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(within(chapters()[2]).getByRole('heading', { level: 2 })).toHaveFocus();

  fireEvent.click(open);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();

  fireEvent.click(open);
  fireEvent.click(screen.getByRole('button', { name: 'Close contents' }));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();

  fireEvent.click(open);
  fireEvent.click(screen.getByTestId('book-drawer-backdrop'));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();
});

it('keeps a section editing, and every chapter as a note, when its note drops out of the loaded notes while it edits (E11)', async () => {
  const noteB = { ...noteA, id: 'notes/nb1/b.md', path: 'notes/nb1/b.md', title: 'Note B', content: '# Chapter Two\n\nThe body of note B.' };
  const pair: CompilationRow = { ...row, items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
  const lane = (notes: unknown[]) => ({ notes: notes as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} });
  laneOverride.current = lane([noteA, noteB]);
  const { rerender } = render(book({ row: pair, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  // A page of the dynamic list moves on and takes the edited note and its neighbour out of what is loaded.
  laneOverride.current = lane([]);
  rerender(book({ row: pair, readOnly: false }));
  expect(chapters()[0]).toHaveAttribute('data-editing');
  expect(within(chapters()[0]).getByLabelText('Note content')).toBeInTheDocument();
  expect(screen.queryByText('This item may have moved or been deleted.')).not.toBeInTheDocument();
  expect(chapters().map(chapter => within(chapter).getByRole('heading', { level: 2 }).textContent)).toEqual(['Editing notes/nb1/a.md', 'Note B']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  // With editing over, the live notes apply again.
  await waitFor(() => expect(screen.getAllByText('This item may have moved or been deleted.')).toHaveLength(2));
});

const pager = () => screen.getByRole('navigation', { name: 'Pages' });
const next = () => within(pager()).getByRole('button', { name: 'Next' });
const previous = () => within(pager()).getByRole('button', { name: 'Previous' });
const count = () => within(pager()).getByRole('status').textContent;
const pageTitle = () => chapters().map(chapter => within(chapter).getByRole('heading', { level: 2 }).textContent);
const contentsButtons = () => within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('button');
const touch = (element: Element, type: 'touchStart' | 'touchEnd', x: number, y = 100) => fireEvent[type](element, type === 'touchStart' ? { touches: [{ clientX: x, clientY: y }] } : { changedTouches: [{ clientX: x, clientY: y }], touches: [] });
const noteB = { ...noteA, id: 'notes/nb1/b.md', path: 'notes/nb1/b.md', title: 'Note B', content: '# Chapter Two\n\nThe body of note B.' };
const pairRow: CompilationRow = { ...row, items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
const lane = (notes: unknown[], more: Partial<{ hasMore: boolean; loadingMore: boolean; loadMore: () => void; }> = {}) => ({ notes: notes as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {}, ...more });

it('reads continuously until this device picks paging, and keeps the choice in the browser without writing the compilation', async () => {
  const onView = vi.fn();
  render(book({ onView }), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  expect(chapters()).toHaveLength(3);
  expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument();
  const modes = screen.getByRole('group', { name: 'Reading mode' });
  expect(within(modes).getByRole('button', { name: 'Continuous' })).toHaveAttribute('aria-pressed', 'true');
  const calls = vi.mocked(fetch).mock.calls.length;
  // At the top of the book the first chapter is the one in view, which paged opens on.
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: index * 900 }) as DOMRect;
  });
  act(() => void document.querySelector('.compilation-book')!.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(contentsButtons()[0]).toHaveAttribute('aria-current', 'location'));
  fireEvent.click(within(modes).getByRole('button', { name: 'Paged' }));
  expect(within(modes).getByRole('button', { name: 'Paged' })).toHaveAttribute('aria-pressed', 'true');
  expect(localStorage.getItem(BOOK_READING_STORAGE_KEY)).toBe('paged');
  expect(chapters()).toHaveLength(1);
  expect(count()).toBe('1 / 3');
  // Nothing was sent to the server and the compilation file was not touched.
  expect(onView).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.slice(calls).filter(([, init]) => init?.method && init.method !== 'GET')).toEqual([]);
  // A reload on this device opens paged.
  cleanup();
  resetBookReadingMode();
  render(book(), { wrapper });
  await screen.findByRole('navigation', { name: 'Pages' });
  expect(chapters()).toHaveLength(1);
});

it('shows one chapter per page with Previous, "3 / 14" and Next, and a turn starts at the top of the new page on its heading', async () => {
  writeBookReadingMode('paged');
  render(book(), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  expect(count()).toBe('1 / 3');
  expect(previous()).toBeDisabled();
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.scrollTop = 400;
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
  expect(count()).toBe('2 / 3');
  expect(body.scrollTop).toBe(0);
  expect(within(chapters()[0]).getByRole('heading', { level: 2 })).toHaveFocus();
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['A talk']));
  expect(next()).toBeDisabled();
  fireEvent.click(previous());
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
});

it("highlights the page's chapter in the contents and goes to a page from the contents list and the drawer", async () => {
  writeBookReadingMode('paged');
  render(book(), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  const current = () => contentsButtons().filter(entry => entry.getAttribute('aria-current') === 'location').map(entry => entry.textContent);
  expect(current()).toEqual(['Note A']);
  fireEvent.click(contentsButtons()[2]);
  await waitFor(() => expect(pageTitle()).toEqual(['A talk']));
  expect(current()).toEqual(['A talk']);
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Contents' })).getByRole('button', { name: /gone\.md/ }));
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(current()).toEqual(['gone.md']);
});

it('turns the page with ← and →, but not from an editor, an input, a dialog, or with a modifier', async () => {
  writeBookReadingMode('paged');
  laneOverride.current = lane([noteA, noteB]);
  render(book({ row: pairRow, readOnly: false }), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  const outside = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(outside, { key: 'ArrowRight' });
  fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true });
  fireEvent.keyDown(document.body, { key: 'ArrowRight', isComposing: true });
  expect(pageTitle()).toEqual(['Note A']);
  // The contents drawer is a dialog over the book.
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  const editor = await screen.findByLabelText('Note content');
  fireEvent.keyDown(editor, { key: 'ArrowRight' });
  expect(pageTitle()).toEqual(['Editing notes/nb1/a.md']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
  expect(pageTitle()).toEqual(['Note A']);
  fireEvent.click(screen.getByRole('button', { name: 'Close contents' }));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(pageTitle()).toEqual(['Note B']));
  fireEvent.keyDown(within(chapters()[0]).getByRole('heading', { level: 2 }), { key: 'ArrowLeft' });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  outside.remove();
});

it('turns the page with a horizontal swipe on the body, but not a vertical scroll, a text selection or a section being edited', async () => {
  writeBookReadingMode('paged');
  laneOverride.current = lane([noteA, noteB]);
  render(book({ row: pairRow, readOnly: false }), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  touch(body, 'touchStart', 300, 100);
  touch(body, 'touchEnd', 290, 400);
  touch(body, 'touchStart', 300, 100);
  touch(body, 'touchEnd', 280, 100);
  expect(pageTitle()).toEqual(['Note A']);
  const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, toString: () => 'text' } as Selection);
  touch(body, 'touchStart', 300, 100);
  touch(body, 'touchEnd', 100, 110);
  expect(pageTitle()).toEqual(['Note A']);
  selection.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  touch(await screen.findByLabelText('Note content'), 'touchStart', 300, 100);
  touch(body, 'touchEnd', 100, 110);
  expect(pageTitle()).toEqual(['Editing notes/nb1/a.md']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  touch(body, 'touchStart', 300, 100);
  touch(body, 'touchEnd', 100, 110);
  await waitFor(() => expect(pageTitle()).toEqual(['Note B']));
  touch(body, 'touchStart', 100, 100);
  touch(body, 'touchEnd', 300, 90);
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
});

it('saves a section that edits before leaving its page, and stays with its notice when the save fails (P5)', async () => {
  writeBookReadingMode('paged');
  laneOverride.current = lane([noteA, noteB]);
  render(book({ row: pairRow, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  flushEditors.mockResolvedValueOnce(false);
  fireEvent.click(next());
  await waitFor(() => expect(flushEditors).toHaveBeenCalledWith(['nb1:notes/nb1/a.md']));
  await act(async () => {});
  expect(pageTitle()).toEqual(['Editing notes/nb1/a.md']);
  expect(chapters()[0]).toHaveAttribute('data-editing');
  flushEditors.mockResolvedValue(true);
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['Note B']));
  expect(flushEditors).toHaveBeenCalledTimes(2);
  expect(screen.queryByLabelText('Note content')).not.toBeInTheDocument();
});

it('loads the next batch of a dynamic compilation at the last loaded page, and keeps Next available until nothing is left (P6)', async () => {
  writeBookReadingMode('paged');
  const loadMore = vi.fn();
  laneOverride.current = lane([noteA], { hasMore: true, loadMore });
  const { rerender } = render(book(), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  expect(loadMore).not.toHaveBeenCalled();
  expect(count()).toBe('1 / 3+');
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['A talk']));
  // The last loaded page asks for the next batch, and Next stays available because more is coming.
  await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  expect(next()).toBeEnabled();
  // While the batch loads, Next waits.
  laneOverride.current = lane([noteA], { hasMore: true, loadingMore: true, loadMore });
  rerender(book());
  expect(next()).toBeDisabled();
  // The batch arrives and Next goes on into it.
  const longer: CompilationRow = { ...row, items: [...(row as Extract<CompilationRow, { kind: 'custom'; }>).items, { id: 'item-4', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
  laneOverride.current = lane([noteA, noteB], { hasMore: true, loadMore });
  rerender(book({ row: longer }));
  expect(count()).toBe('3 / 4+');
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['Note B']));
  // Nothing is left: the last page ends the book.
  laneOverride.current = lane([noteA, noteB], { hasMore: false, loadMore });
  rerender(book({ row: longer }));
  expect(count()).toBe('4 / 4');
  expect(next()).toBeDisabled();
});

it('keeps the reader at the same chapter when the mode changes (P7)', async () => {
  laneOverride.current = lane([noteA, noteB]);
  render(book({ row: pairRow }), { wrapper });
  await waitFor(() => expect(chapters()).toHaveLength(2));
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: [-2000, 120][index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(contentsButtons().filter(entry => entry.getAttribute('aria-current')).map(entry => entry.textContent)).toEqual(['Note B']));
  // Continuous with Note B in view opens paged on Note B.
  fireEvent.click(screen.getByRole('button', { name: 'Paged' }));
  await waitFor(() => expect(pageTitle()).toEqual(['Note B']));
  expect(count()).toBe('2 / 2');
  // Back to continuous scrolls to Note B at once, not smoothly.
  within(chapters()[0]).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: 640 }) as DOMRect;
  vi.mocked(body.scrollTo).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Continuous' }));
  await waitFor(() => expect(chapters()).toHaveLength(2));
  await waitFor(() => expect(body.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' })));
  expect(localStorage.getItem(BOOK_READING_STORAGE_KEY)).toBe('continuous');
});

it('opens paged on the chapter that edits without remounting its editor, so nothing typed is lost (P7)', async () => {
  laneOverride.current = lane([noteA, noteB]);
  render(book({ row: pairRow, readOnly: false }), { wrapper });
  await screen.findByRole('button', { name: 'Edit Note A' });
  // The reader has scrolled to Note B, but it is Note A that edits.
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: [-2000, 100][index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(contentsButtons().filter(entry => entry.getAttribute('aria-current')).map(entry => entry.textContent)).toEqual(['Note B']));
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  const editor = await screen.findByLabelText('Note content');
  fireEvent.change(editor, { target: { value: 'typed and not yet saved' } });
  const toggle = screen.getByRole('button', { name: 'Paged' });
  toggle.focus();
  fireEvent.click(toggle);
  await waitFor(() => expect(chapters()).toHaveLength(1));
  expect(chapters()[0]).toHaveAttribute('data-editing');
  expect(count()).toBe('1 / 2');
  // The same editor, with its text, and the focus still on the button that was pressed.
  expect(screen.getByLabelText('Note content')).toBe(editor);
  expect(editor).toHaveValue('typed and not yet saved');
  expect(toggle).toHaveFocus();
});

it('shows a folder chapter as one page with its notes in order', async () => {
  writeBookReadingMode('paged');
  const mixed: CompilationRow = { ...row, items: [{ id: 'folder-1', kind: 'folder', notebookId: 'nb1', path: 'notes/nb1/sub' }, { id: 'item-3', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
  render(book({ row: mixed }), { wrapper });
  await waitFor(() => expect(within(chapters()[0]).getByRole('heading', { level: 3, name: 'Note A' })).toBeInTheDocument());
  expect(pageTitle()).toEqual(['sub']);
  expect(count()).toBe('1 / 2');
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['A talk']));
});

it("keeps a folder's notes in the contents while the book is on another page, and a click on one goes to its page and section", async () => {
  writeBookReadingMode('paged');
  const mixed: CompilationRow = { ...row, items: [{ id: 'folder-1', kind: 'folder', notebookId: 'nb1', path: 'notes/nb1/sub' }, { id: 'item-3', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
  render(book({ row: mixed }), { wrapper });
  await waitFor(() => expect(within(chapters()[0]).getByRole('heading', { level: 3, name: 'Note A' })).toBeInTheDocument());
  await waitFor(() => expect(contentsButtons().map(entry => entry.textContent)).toEqual(['sub', 'Note A', 'A talk']));
  fireEvent.click(next());
  await waitFor(() => expect(pageTitle()).toEqual(['A talk']));
  expect(contentsButtons().map(entry => entry.textContent)).toEqual(['sub', 'Note A', 'A talk']);
  fireEvent.click(contentsButtons()[1]);
  await waitFor(() => expect(pageTitle()).toEqual(['sub']));
  await waitFor(() => expect(within(chapters()[0]).getByRole('heading', { level: 3, name: 'Note A' })).toHaveFocus());
});

it('turns one page for two quick presses of Next while the section that edits is still saving (P5)', async () => {
  writeBookReadingMode('paged');
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  let finishSave: (saved: boolean) => void = () => {};
  flushEditors.mockReturnValueOnce(new Promise<boolean>(resolve => void (finishSave = resolve)));
  fireEvent.click(next());
  fireEvent.click(next());
  await act(async () => finishSave(true));
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
  expect(count()).toBe('2 / 3');
  expect(flushEditors).toHaveBeenCalledTimes(1);
});

it('leaves focus on the mode button when the mode changes, in both directions', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(chapters()).toHaveLength(3));
  const toggle = (name: string) => within(screen.getByRole('group', { name: 'Reading mode' })).getByRole('button', { name });
  toggle('Paged').focus();
  fireEvent.click(toggle('Paged'));
  await screen.findByRole('navigation', { name: 'Pages' });
  expect(toggle('Paged')).toHaveFocus();
  toggle('Continuous').focus();
  fireEvent.click(toggle('Continuous'));
  await waitFor(() => expect(chapters()).toHaveLength(3));
  expect(toggle('Continuous')).toHaveFocus();
});

it('turns only the Book the reader last used when ← or → is pressed with nothing focused', async () => {
  writeBookReadingMode('paged');
  laneOverride.current = lane([noteA, noteB]);
  render(createElement('div', null, book({ row: pairRow }), book({ row: { ...pairRow, id: 'row-2' } })), { wrapper });
  const books = () => [...document.querySelectorAll<HTMLElement>('.compilation-book-view')];
  const titles = () => books().map(view => within(view).getByRole('heading', { level: 2 }).textContent);
  await waitFor(() => expect(titles()).toEqual(['Note A', 'Note A']));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(titles()).toEqual(['Note B', 'Note A']));
  fireEvent.pointerDown(within(books()[1]).getByRole('heading', { level: 2 }));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(titles()).toEqual(['Note B', 'Note B']));
  fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
  await waitFor(() => expect(titles()).toEqual(['Note B', 'Note A']));
});

it('lets the contents drawer leave the reader where it opened from when the page cannot turn', async () => {
  writeBookReadingMode('paged');
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  flushEditors.mockResolvedValueOnce(false);
  const open = screen.getByRole('button', { name: 'Show contents' });
  fireEvent.click(open);
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Contents' })).getByRole('button', { name: /A talk/ }));
  await waitFor(() => expect(flushEditors).toHaveBeenCalled());
  await waitFor(() => expect(open).toHaveFocus());
  expect(chapters()[0]).toHaveAttribute('data-editing');
});

it('leaves ← and → to a wide code block the reader clicked, though the click leaves focus on the page', async () => {
  writeBookReadingMode('paged');
  render(book(), { wrapper });
  await waitFor(() => expect(pageTitle()).toEqual(['Note A']));
  const block = document.createElement('pre');
  block.style.overflowX = 'auto';
  Object.defineProperty(block, 'scrollWidth', { value: 900, configurable: true });
  Object.defineProperty(block, 'clientWidth', { value: 300, configurable: true });
  chapters()[0].appendChild(block);
  fireEvent.pointerDown(block);
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  expect(pageTitle()).toEqual(['Note A']);
  fireEvent.pointerDown(within(chapters()[0]).getByRole('heading', { level: 2 }));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(pageTitle()).toEqual(['gone.md']));
});

it('hands the arrow keys to a remaining Book when the one the reader used goes away', async () => {
  writeBookReadingMode('paged');
  laneOverride.current = lane([noteA, noteB]);
  const both = (second: boolean) => createElement('div', null, book({ row: pairRow }), second ? book({ row: { ...pairRow, id: 'row-2' } }) : null);
  const { rerender } = render(both(true), { wrapper });
  const books = () => [...document.querySelectorAll<HTMLElement>('.compilation-book-view')];
  await waitFor(() => expect(books()).toHaveLength(2));
  fireEvent.pointerDown(within(books()[1]).getByRole('heading', { level: 2 }));
  rerender(both(false));
  await waitFor(() => expect(books()).toHaveLength(1));
  fireEvent.keyDown(document.body, { key: 'ArrowRight' });
  await waitFor(() => expect(within(books()[0]).getByRole('heading', { level: 2 })).toHaveTextContent('Note B'));
});
