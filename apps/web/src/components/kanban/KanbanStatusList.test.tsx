// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { setNoteQueryScope } from '../../lib/use-note-queries.js';
import { NOTE_DRAG_TYPE } from '../../lib/note-drag.js';
import { GROUP_ROWS, KanbanStatusList, type KanbanStatusListProps } from './KanbanStatusList.js';

const REVISION = 'd'.repeat(40);
let client: QueryClient;

const noteOf = (path: string, status?: string, extra: Partial<NoteListItem> = {}) => ({ id: path, path, notebookId: 'life', title: path.replace('notes/life/', ''), status, tags: [], metadata: {}, ...extra });
/** Seven inbox notes, one draft that is edited live, one doing note whose frontmatter cannot be read, and two with no status. */
const byStatus: Record<string, ReturnType<typeof noteOf>[]> = { inbox: Array.from({ length: 7 }, (_, index) => noteOf(`notes/life/inbox-${index + 1}.md`, 'inbox')), draft: [noteOf('notes/life/live.md', 'draft', { live: { since: '2026-11-15T00:00:00Z', activeEditors: 1 } } as Partial<NoteListItem>)], doing: [noteOf('notes/life/broken.md', 'doing', { frontmatterInvalid: true })], '': [noteOf('notes/life/loose-1.md'), noteOf('notes/life/loose-2.md')] };

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const params = new URL(url, 'http://local').searchParams;
      const notes = params.get('noStatus') === '1' ? byStatus[''] : byStatus[params.get('status') ?? ''] ?? [];
      return new Response(JSON.stringify({ revision: REVISION, total: notes.length, nextCursor: null, notes }), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
const list = (props: Partial<KanbanStatusListProps> = {}) => createElement(KanbanStatusList, { query: { notebookId: 'life' }, statuses: ['inbox', 'draft', 'doing', 'done'], onOpenNote: () => {}, onUpdateNoteStatus: () => {}, focusMode: { onZoomNote: () => {}, canDrag: () => true, openPath: 'notes/life/live.md' }, ...props });
const group = (name: string) => screen.getByRole('region', { name });
const header = (name: string) => within(group(name)).getAllByRole('button')[0]!;

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return { setData: (type: string, value: string) => void (data[type] = value), getData: (type: string) => data[type] || '', dropEffect: '', effectAllowed: '' };
}

it('lists one group per column in the board order, with its count, and the notes with no status last', async () => {
  render(list(), { wrapper });
  await waitFor(() => expect(screen.getByText('loose-1.md')).toBeInTheDocument());
  const groups = [...document.querySelectorAll('[data-status-group]')].map(node => node.getAttribute('data-status-group'));
  expect(groups).toEqual(['inbox', 'draft', 'doing', 'done', '']);
  expect(within(group('inbox')).getByRole('button', { expanded: true })).toHaveTextContent('inbox7');
  expect(within(group('No status')).getByRole('button', { expanded: true })).toHaveTextContent('No status2');
  // The note the active pane shows is marked.
  expect(screen.getByText('live.md').closest('[data-notepath]')).toHaveAttribute('aria-current', 'true');
});

it('shows a group’s first rows and the rest a page at a time behind 「N more」', async () => {
  render(list(), { wrapper });
  await waitFor(() => expect(screen.getByText('inbox-1.md')).toBeInTheDocument());
  expect(within(group('inbox')).getAllByRole('listitem')).toHaveLength(GROUP_ROWS);
  fireEvent.click(within(group('inbox')).getByRole('button', { name: '2 more' }));
  expect(within(group('inbox')).getAllByRole('listitem')).toHaveLength(7);
  expect(within(group('inbox')).queryByRole('button', { name: /more$/ })).not.toBeInTheDocument();
});

it('folds a group on its header and keeps it folded on this device', async () => {
  const { unmount } = render(list(), { wrapper });
  await waitFor(() => expect(screen.getByText('inbox-1.md')).toBeInTheDocument());
  fireEvent.click(header('inbox'));
  expect(within(group('inbox')).getByRole('button', { expanded: false })).toHaveTextContent('inbox7');
  expect(screen.queryByText('inbox-1.md')).not.toBeInTheDocument();
  unmount();
  render(list(), { wrapper });
  await waitFor(() => expect(screen.getByText('loose-1.md')).toBeInTheDocument());
  expect(screen.queryByText('inbox-1.md')).not.toBeInTheDocument();
  fireEvent.click(within(group('inbox')).getByRole('button', { expanded: false }));
  expect(screen.getByText('inbox-1.md')).toBeInTheDocument();
});

it('changes a row’s status when it is dropped onto another group, folded or not, and drags it into a Focus pane', async () => {
  const onUpdateNoteStatus = vi.fn();
  render(list({ onUpdateNoteStatus }), { wrapper });
  await waitFor(() => expect(screen.getByText('inbox-1.md')).toBeInTheDocument());
  fireEvent.click(header('done'));
  const row = screen.getByText('inbox-1.md').closest('[data-notepath]')!;
  expect(row).toHaveAttribute('draggable', 'true');
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(row, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/life/inbox-1.md');
  const done = group('done');
  fireEvent.dragOver(done, { dataTransfer });
  expect(done).toHaveAttribute('data-over');
  fireEvent.drop(done, { dataTransfer });
  expect(onUpdateNoteStatus).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/life/inbox-1.md' }), 'done');
  expect(done).not.toHaveAttribute('data-over');

  // Onto the notes with no status, as onto the board's own column.
  const second = makeDataTransfer();
  fireEvent.dragStart(screen.getByText('inbox-2.md').closest('[data-notepath]')!, { dataTransfer: second });
  fireEvent.drop(group('No status'), { dataTransfer: second });
  expect(onUpdateNoteStatus).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'notes/life/inbox-2.md' }), '');
});

it('keeps a note edited live, or one whose frontmatter cannot be read, in its group', async () => {
  const onUpdateNoteStatus = vi.fn();
  render(list({ onUpdateNoteStatus }), { wrapper });
  await waitFor(() => expect(screen.getByText('broken.md')).toBeInTheDocument());
  for (const title of ['live.md', 'broken.md']) {
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(screen.getByText(title).closest('[data-notepath]')!, { dataTransfer });
    fireEvent.drop(group('inbox'), { dataTransfer });
  }
  expect(onUpdateNoteStatus).not.toHaveBeenCalled();
});

it('opens a row on click and from the keyboard', async () => {
  const onOpenNote = vi.fn();
  render(list({ onOpenNote }), { wrapper });
  await waitFor(() => expect(screen.getByText('inbox-1.md')).toBeInTheDocument());
  const row = screen.getByText('inbox-1.md').closest('[data-notepath]')!;
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(onOpenNote).toHaveBeenCalledTimes(2);
  expect(onOpenNote).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'notes/life/inbox-1.md' }));
});
