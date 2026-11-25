// @vitest-environment jsdom
import { createElement, type ReactNode, useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type Location, MemoryRouter, type NavigateFunction, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { compilationFields } from '@mygitnotes/core/compilation';
import { boardsRoute } from '../../lib/routes.js';
import { setNoteQueryScope } from '../../lib/use-note-queries.js';
import type { CompilationViewProps } from '../CompilationView.js';
import { BoardsPage } from './BoardsPage.js';

const flushEditors = vi.fn<() => Promise<boolean>>();
vi.mock('../../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors }) }));
const shownBoards = vi.fn<(props: CompilationViewProps) => void>();
vi.mock('../CompilationView.js', () => ({
  CompilationView: (props: CompilationViewProps) => {
    shownBoards(props);
    return createElement('section', { 'aria-label': `Board ${props.path}` }, props.lead);
  },
}));
const phone = { current: false };
vi.mock('../../lib/use-phone.js', () => ({ usePhone: () => phone.current }));

const notebooks = [{ id: 'thesis', title: 'Thesis', root: 'notes/thesis' }];
const items = 'items:\n  - id: n1\n    kind: note\n    path: notes/thesis/a.md\n';
const file = (id: string, title: string, arrangement: string, extra = '') => {
  const path = `notes/thesis/${id}.compilation.yml`, raw = `version: 1\nid: ${id}\ntitle: ${title}\narrangement: ${arrangement}\n${arrangement === 'lane' ? 'size: small\n' : ''}${items}${extra}`;
  const fields = compilationFields(raw, path, ['notes/thesis']);
  return { id: path, path, notebookId: 'thesis', title: fields.title, tags: [], kind: 'compilation', content: raw, metadata: { ...fields.metadata, updated: '2026-11-24T09:00:00Z' } };
};
const listing = [file('chapter', '第三章', 'board', 'board:\n  cards:\n    - { item: n1, x: 0, y: 0 }\n'), file('kept', '曾是白板', 'book', 'board: {}\n'), file('reading', '閱讀清單', 'lane')];
const sidePanel = { focusNotebook: 'thesis', openInFocus: vi.fn(), fullscreen: vi.fn() };
const onCreate = vi.fn<() => Promise<string | undefined>>();
const at: { location?: Location; navigate?: NavigateFunction; } = {};
function Probe() {
  const location = useLocation(), navigate = useNavigate();
  useLayoutEffect(() => {
    at.location = location;
    at.navigate = navigate;
  }, [location, navigate]);
  return null;
}

function page(url: string, { writable = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const wrapper = ({ children }: { children: ReactNode; }) => (
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return render(createElement(BoardsPage, { notebookId: 'thesis', notebooks, folders: [], writable, sidePanel, onOpenNote: vi.fn(), onCreate }), { wrapper });
}
const address = () => at.location!.pathname + at.location!.search;

beforeEach(() => {
  phone.current = false;
  flushEditors.mockReset().mockResolvedValue(true);
  shownBoards.mockReset();
  onCreate.mockReset();
  setNoteQueryScope({ sourceId: 'test', revisions: {}, repositories: {}, drafts: {} });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => Response.json(new URL(input, 'http://localhost').searchParams.get('kind') === 'compilation' ? { notes: listing, total: listing.length, nextCursor: null } : { notes: [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lists the boards and the compilations holding board data as tiles, and opens one on the page with its breadcrumb', async () => {
  page(boardsRoute('thesis'));
  const tiles = await screen.findByRole('list', { name: 'Whiteboards of this notebook' });
  expect(within(tiles).getAllByRole('button').map(tile => tile.querySelector('.boards-tile-title')!.textContent)).toEqual(['曾是白板', '第三章']);
  expect(within(tiles).getAllByRole('button')[1]).toHaveTextContent('1 cards');
  fireEvent.click(within(tiles).getByRole('button', { name: /第三章/ }));
  expect(address()).toBe(boardsRoute('thesis', 'notes/thesis/chapter.compilation.yml'));
  await screen.findByRole('region', { name: 'Board notes/thesis/chapter.compilation.yml' });
  expect(shownBoards).toHaveBeenLastCalledWith(expect.objectContaining({ frame: 'page', notebookId: 'thesis', path: 'notes/thesis/chapter.compilation.yml', sidePanel }));
  // The breadcrumb saves the side panel's note, then goes back to the list.
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Whiteboard path' })).getByRole('button', { name: 'Whiteboards' }));
  await waitFor(() => expect(address()).toBe(boardsRoute('thesis')));
  expect(flushEditors).toHaveBeenCalled();
});

it('creates an untitled board and opens it; a read-only notebook or a phone has no 新增白板', async () => {
  onCreate.mockResolvedValue('notes/thesis/untitled.compilation.yml');
  page(boardsRoute('thesis'));
  await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'New whiteboard' })));
  await waitFor(() => expect(address()).toBe(boardsRoute('thesis', 'notes/thesis/untitled.compilation.yml')));
  cleanup();
  page(boardsRoute('thesis'), { writable: false });
  await screen.findByRole('list', { name: 'Whiteboards of this notebook' });
  expect(screen.queryByRole('button', { name: 'New whiteboard' })).toBeNull();
  cleanup();
  phone.current = true;
  page(boardsRoute('thesis'));
  await screen.findByRole('list', { name: 'Whiteboards of this notebook' });
  expect(screen.queryByRole('button', { name: 'New whiteboard' })).toBeNull();
});

it.each([['/graph?notebook=thesis', boardsRoute('thesis')], ['/graph?notebook=thesis&lanes=chapter', boardsRoute('thesis', 'notes/thesis/chapter.compilation.yml')], ['/graph?notebook=thesis&lanes=kept', boardsRoute('thesis', 'notes/thesis/kept.compilation.yml')], ['/graph?notebook=thesis&lanes=reading', '/notebooks/thesis/notes/reading.compilation.yml?zoom']])('replaces the former graph address %s with %s', async (url, target) => {
  page(url);
  await waitFor(() => expect(address()).toBe(target));
});

it('leaves a board by Back only once its editors are saved, and keeps it with its address when they cannot be', async () => {
  page(boardsRoute('thesis'));
  fireEvent.click(await screen.findByRole('button', { name: /第三章/ }));
  await screen.findByRole('region', { name: 'Board notes/thesis/chapter.compilation.yml' });
  let finish!: (saved: boolean) => void;
  flushEditors.mockReturnValueOnce(new Promise<boolean>(resolve => void (finish = resolve)));
  act(() => void at.navigate!(-1));
  await waitFor(() => expect(flushEditors).toHaveBeenCalledTimes(1));
  // The address is the list's already; the board and its side panel stay until they are saved.
  expect(address()).toBe(boardsRoute('thesis'));
  expect(screen.getByRole('region', { name: 'Board notes/thesis/chapter.compilation.yml' })).toBeInTheDocument();
  finish(true);
  await screen.findByRole('list', { name: 'Whiteboards of this notebook' });
  // Forward has nothing shown to save; a refused save on the way back keeps the board and its address.
  act(() => void at.navigate!(1));
  await screen.findByRole('region', { name: 'Board notes/thesis/chapter.compilation.yml' });
  expect(flushEditors).toHaveBeenCalledTimes(1);
  flushEditors.mockResolvedValueOnce(false);
  act(() => void at.navigate!(-1));
  await waitFor(() => expect(flushEditors).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(address()).toBe(boardsRoute('thesis', 'notes/thesis/chapter.compilation.yml')));
  expect(screen.getByRole('region', { name: 'Board notes/thesis/chapter.compilation.yml' })).toBeInTheDocument();
});
