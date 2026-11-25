// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { KanbanView } from './KanbanView.js';
import { StatusColorProvider } from '../lib/status-color.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';

const REVISION = 'd'.repeat(40);
let client: QueryClient;
let requests: string[];

const noteOf = (path: string, status?: string) => ({ id: path, path, notebookId: 'life', title: path, status, tags: [], metadata: {} });

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(url);
      const withoutStatus = url.includes('noStatus=1');
      const body = withoutStatus ? { revision: REVISION, total: 7, nextCursor: null, notes: [noteOf('notes/life/loose.md')] } : { revision: REVISION, total: 3, nextCursor: null, notes: [noteOf('notes/life/a.md', 'inbox')] };
      return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('github-notes:language');
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

const board = () => createElement(KanbanView, { query: { notebookId: 'life' }, statuses: ['inbox'], onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {} });

it('asks the server for the notes that carry no status', async () => {
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  expect(requests.some(url => url.includes('noStatus=1'))).toBe(true);
  expect(requests.some(url => url.includes('status=inbox'))).toBe(true);
});

it('paints each column dot from the notebook statuses', async () => {
  render(
    <StatusColorProvider statuses={['inbox', { name: 'doing', color: 'red' }, 'later']}>
      <KanbanView query={{ notebookId: 'life' }} statuses={['inbox', 'doing', 'later', 'stray']} onOpenNote={() => {}} onUpdateNoteStatus={() => {}} onDeleteNote={() => {}} onNewNoteWithStatus={() => {}} />
    </StatusColorProvider>,
    { wrapper },
  );
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  const dot = (status: string) => document.querySelector(`[data-status-column="${status}"] .status-dot`);
  expect(['inbox', 'doing', 'later', 'stray'].map(status => [...dot(status)!.classList].find(name => name.startsWith('bg-')))).toEqual(['bg-primary', 'bg-danger', 'bg-status-purple', 'bg-muted']);
});

it.each([['zh-TW', ['收件匣', '審核中', '進行中', 'later']], ['en', ['inbox', 'In review', 'working', 'later']]])('titles each column with the notebook label for %s and keeps the stored name as its id', async (language, titles) => {
  window.localStorage.setItem('github-notes:language', language);
  render(
    <I18nProvider>
      <StatusColorProvider statuses={['inbox', { name: 'review', label: { en: 'In review', 'zh-TW': '審核中' } }, 'working', 'later']}>
        <KanbanView query={{ notebookId: 'life' }} statuses={['inbox', 'review', 'working', 'later']} onOpenNote={() => {}} onUpdateNoteStatus={() => {}} onDeleteNote={() => {}} onNewNoteWithStatus={() => {}} />
      </StatusColorProvider>
    </I18nProvider>,
    { wrapper },
  );
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  expect(['inbox', 'review', 'working', 'later'].map(id => document.querySelector(`[data-status-column="${id}"] h3`)?.textContent)).toEqual(titles);
});

it('counts each column and the board from the server totals', async () => {
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  const counts = [...document.querySelectorAll('.rounded-full')].map(node => node.textContent);
  expect(counts).toContain('3');
  expect(counts).toContain('7');
  expect(screen.getByText(/10/)).toBeInTheDocument();
});

it('leaves out the no-status column when the server answers none', async () => {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => new Response(JSON.stringify(String(url).includes('noStatus=1') ? { revision: REVISION, total: 0, nextCursor: null, notes: [] } : { revision: REVISION, total: 3, nextCursor: null, notes: [noteOf('notes/life/a.md', 'inbox')] }), { headers: { 'Content-Type': 'application/json' } }) as never);
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText('No status')).not.toBeInTheDocument());
});

it('asks only the filtered status column when the board filters by status', async () => {
  render(createElement(KanbanView, { query: { notebookId: 'life', status: 'inbox' }, statuses: ['inbox', 'done'], onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {} }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  expect(requests.some(url => url.includes('status=inbox'))).toBe(true);
  expect(requests.some(url => url.includes('status=done'))).toBe(false);
  expect(document.querySelector('[data-status-column="done"]')).toBeInTheDocument();
});

it('dates a card by its updated field when the source reports no mtime', async () => {
  const dated = { ...noteOf('notes/life/dated.md', 'inbox'), metadata: { updated: '2026-01-05T10:00:00Z' } };
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [dated] }), { headers: { 'Content-Type': 'application/json' } }) as never);
  render(board(), { wrapper });
  const expected = new Date('2026-01-05T10:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0));
});

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    getData: (type: string) => data[type] || '',
    dropEffect: '',
    effectAllowed: '',
  };
}

function twoColumnBoard(props: { onUpdateNoteStatus: (note: unknown, status: string) => void; readOnly?: boolean; focusMode?: { onZoomNote: (note: unknown) => void; canDrag: (note: unknown) => boolean; }; }) {
  return createElement(KanbanView, { query: { notebookId: 'life' }, statuses: ['inbox', 'doing'], onOpenNote: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {}, ...props });
}

function mockTwoColumnFetch() {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    const u = String(url);
    const notes = u.includes('status=inbox') ? [noteOf('notes/life/a.md', 'inbox')] : [];
    return new Response(JSON.stringify({ revision: REVISION, total: notes.length, nextCursor: null, notes }), { headers: { 'Content-Type': 'application/json' } });
  });
}

it('still changes status by dragging a card into another column when focusMode is present', async () => {
  mockTwoColumnFetch();
  const onUpdateNoteStatus = vi.fn();
  render(twoColumnBoard({ onUpdateNoteStatus, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  const target = document.querySelector('[data-status-column="doing"]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(onUpdateNoteStatus).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/life/a.md' }), 'doing');
});

it('sets the note-drag payload on a card when focusMode is present', async () => {
  mockTwoColumnFetch();
  render(twoColumnBoard({ onUpdateNoteStatus: () => {}, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/life/a.md');
  expect(dataTransfer.getData('text/plain')).toBe('notes/life/a.md');
});

it('keeps a read-only board from changing status on drop even when focusMode allows dragging', async () => {
  mockTwoColumnFetch();
  const onUpdateNoteStatus = vi.fn();
  render(twoColumnBoard({ onUpdateNoteStatus, readOnly: true, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  expect(card).toHaveAttribute('draggable', 'true');
  const target = document.querySelector('[data-status-column="doing"]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(onUpdateNoteStatus).not.toHaveBeenCalled();
});

it("lists the notebook's metadata sort field on the board and asks for the columns in that order", async () => {
  render(createElement(KanbanView, { query: { notebookId: 'life' }, statuses: ['inbox'], onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {}, sortField: 'metadata.date', sortOrder: 'desc', onSortChange: () => {}, metadataSortFields: ['metadata.date'] }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent('date (descending)');
  expect(screen.getByRole('combobox', { name: /^Sort column/ })).toHaveTextContent('date (descending)');
  expect(requests.some(url => url.includes('status=inbox') && url.includes('sort=metadata.date'))).toBe(true);
});

it('marks the delete on a checked-out card disabled, with no hover that reads as enabled', async () => {
  const live = { ...noteOf('notes/life/live.md', 'inbox'), live: { since: '2026-11-15T00:00:00Z', activeEditors: 1 } };
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ revision: REVISION, total: 1, nextCursor: null, notes: [live] }), { headers: { 'Content-Type': 'application/json' } }) as never);
  render(createElement(I18nProvider, null, createElement(KanbanView, { query: { notebookId: 'life' }, statuses: ['inbox'], onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {}, canDelete: true })), { wrapper });
  const remove = await screen.findByRole('button', { name: 'Delete note' });
  expect(remove).toBeDisabled();
  expect(remove).toHaveClass('kanban-card-delete');
  // Hover feedback applies only to an enabled delete.
  expect(remove.className.split(' ').filter(name => name.startsWith('hover:'))).toEqual([]);
});

it('keeps a card whose frontmatter cannot be read out of the status columns, and still lets it drag into a Focus pane', async () => {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    const notes = String(url).includes('status=inbox') ? [{ ...noteOf('notes/life/a.md', 'inbox'), frontmatterInvalid: true }] : [];
    return new Response(JSON.stringify({ revision: REVISION, total: notes.length, nextCursor: null, notes }), { headers: { 'Content-Type': 'application/json' } });
  });
  const onUpdateNoteStatus = vi.fn();
  const { unmount } = render(twoColumnBoard({ onUpdateNoteStatus }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  expect(screen.getByText('notes/life/a.md').closest('[data-notepath]')).toHaveAttribute('draggable', 'false');
  unmount();
  render(twoColumnBoard({ onUpdateNoteStatus, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/life/a.md');
  fireEvent.drop(document.querySelector('[data-status-column="doing"]')!, { dataTransfer });
  expect(onUpdateNoteStatus).not.toHaveBeenCalled();
});

it('rests an empty column as a strip that still takes a dropped card, and opens it on click for this device', async () => {
  window.localStorage.removeItem('mygitnotes:kanban');
  mockTwoColumnFetch();
  const onUpdateNoteStatus = vi.fn();
  const { unmount } = render(twoColumnBoard({ onUpdateNoteStatus }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const strip = document.querySelector('[data-status-column="doing"]')!;
  await waitFor(() => expect(strip).toHaveAttribute('data-strip'));
  expect(strip).toHaveTextContent('doing0');
  expect(strip.querySelector('.status-dot')).not.toBeNull();
  expect(document.querySelector('[data-status-column="inbox"]')).not.toHaveAttribute('data-strip');

  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(screen.getByText('notes/life/a.md').closest('[data-notepath]')!, { dataTransfer });
  fireEvent.dragOver(strip, { dataTransfer });
  expect(strip).toHaveAttribute('data-over');
  fireEvent.drop(strip, { dataTransfer });
  expect(onUpdateNoteStatus).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/life/a.md' }), 'doing');

  fireEvent.click(screen.getByRole('button', { name: 'Expand doing' }));
  expect(document.querySelector('[data-status-column="doing"]')).not.toHaveAttribute('data-strip');
  unmount();
  render(twoColumnBoard({ onUpdateNoteStatus }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  expect(document.querySelector('[data-status-column="doing"]')).not.toHaveAttribute('data-strip');
  window.localStorage.removeItem('mygitnotes:kanban');
});

it('folds a column with notes to a strip by hand and keeps it folded on the next visit', async () => {
  window.localStorage.removeItem('mygitnotes:kanban');
  mockTwoColumnFetch();
  const { unmount } = render(twoColumnBoard({ onUpdateNoteStatus: () => {} }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Collapse inbox' }));
  const strip = document.querySelector('[data-status-column="inbox"]')!;
  expect(strip).toHaveAttribute('data-strip');
  expect(strip).toHaveTextContent('inbox1');
  expect(screen.queryByText('notes/life/a.md')).not.toBeInTheDocument();
  unmount();
  render(twoColumnBoard({ onUpdateNoteStatus: () => {} }), { wrapper });
  await waitFor(() => expect(document.querySelector('[data-status-column="inbox"]')).toHaveAttribute('data-strip'));
  window.localStorage.removeItem('mygitnotes:kanban');
});

it('switches the cards to compact, a title and one line, and keeps the density for this device', async () => {
  window.localStorage.removeItem('mygitnotes:kanban');
  const tagged = { ...noteOf('notes/life/a.md', 'inbox'), tags: ['draft', 'chapter'], metadata: { updated: '2026-01-05T10:00:00Z' } };
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    const notes = String(url).includes('status=inbox') ? [tagged] : [];
    return new Response(JSON.stringify({ revision: REVISION, total: notes.length, nextCursor: null, notes }), { headers: { 'Content-Type': 'application/json' } });
  });
  const { unmount } = render(twoColumnBoard({ onUpdateNoteStatus: () => {} }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  const normal = screen.getByRole('button', { name: 'Normal' });
  expect(normal).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('notes/life/a.md').closest('[data-notepath]')).not.toHaveAttribute('data-density');
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  expect(card).toHaveAttribute('data-density', 'compact');
  const date = new Date('2026-01-05T10:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  expect(card.querySelector('.kanban-card-meta > span')).toHaveTextContent(`#draft · ${date}`);
  unmount();
  render(twoColumnBoard({ onUpdateNoteStatus: () => {} }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md').closest('[data-notepath]')).toHaveAttribute('data-density', 'compact'));
  fireEvent.click(screen.getByRole('button', { name: 'Display' }));
  expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
  window.localStorage.removeItem('mygitnotes:kanban');
});
