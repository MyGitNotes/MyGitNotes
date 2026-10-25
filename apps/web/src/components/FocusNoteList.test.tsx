// @vitest-environment jsdom
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { I18nProvider } from '../lib/i18n/index.js';
import { HOVER_CARD_CLOSE_MS, HOVER_CARD_OPEN_MS } from '../lib/use-note-hover-card.js';
import { hoverCardPosition } from './NoteHoverCard.js';
import { NoteCollection } from './NoteCollection.js';
import { FocusNoteList } from './FocusNoteList.js';

beforeAll(() => {
  // Radix Select measures and captures the pointer, which jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  window.localStorage.setItem('github-notes:language', 'en');
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

const note = (name: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: name, path: `notes/life/projects/${name}.md`, notebookId: 'life', title: `Title of ${name}`, status: 'todo', tags: ['alpha', 'beta', 'gamma', 'delta'], metadata: { created: '2026-10-01T09:00:00Z', updated: '2026-10-20T10:30:00Z' }, ...extra });

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    notes: [note('a'), note('b', { status: 'done', tags: [] })],
    statuses: ['todo', 'working', 'done'],
    onOpenNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onMoveNote: vi.fn(),
    onUpdateNoteStatus: vi.fn(),
    onNewNote: vi.fn(),
    focusMode: { onZoomNote: vi.fn(), canDrag: () => true, compactRows: true, readNote: vi.fn(async () => ({ content: '# Title of a\n\nThe opening line says **what** the note is about, with a [link](x.md).\n\n```js\nignored()\n```\n' })) },
    ...overrides,
  };
  render(createElement(I18nProvider, null, createElement(FocusNoteList, props as never)));
  return props as typeof props & Record<string, never>;
}

const rowOf = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-focus-row]')].find(row => row.textContent?.includes(`Title of ${name}`))!;
const openCard = async (name: string) => {
  fireEvent.pointerEnter(rowOf(name));
  await act(async () => {
    vi.advanceTimersByTime(HOVER_CARD_OPEN_MS);
    await Promise.resolve();
  });
  return screen.getByRole('group', { name: `Details for Title of ${name}` });
};

it('lists each note as a status dot and a title that is clamped to two lines, with every row reserving both', () => {
  setup();
  const rows = document.querySelectorAll('[data-focus-row]');
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const title = row.querySelector('.focus-row-title') as HTMLElement;
    expect(title).toBeInTheDocument();
    expect(title.style.getPropertyValue('--title-lines')).toBe('2');
    expect(row.querySelector('.status-dot')).toBeInTheDocument();
    // Nothing else on the row: tags, date and actions live in the hover card.
    expect(row.querySelector('.note-tag-chip, time, .ui-icon-button')).toBeNull();
  }
  const css = readFileSync(resolve(process.cwd(), 'apps/web/src/components/focus-list.css'), 'utf8');
  expect(css).toMatch(/\.focus-row-title \{[^}]*-webkit-line-clamp: var\(--title-lines, 2\)/);
  expect(css).toMatch(/\.focus-row-title \{[^}]*min-height: calc\(var\(--title-lines, 2\) \* 1\.375em\)/);
});

it('opens a note on a click and on Enter, and marks the one the active pane shows as open', () => {
  const props = setup({ focusMode: { onZoomNote: vi.fn(), canDrag: () => false, compactRows: true, openPath: 'notes/life/projects/b.md' } });
  fireEvent.click(rowOf('a'));
  expect(props.onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title of a' }));
  fireEvent.keyDown(rowOf('b'), { key: 'Enter' });
  expect(props.onOpenNote).toHaveBeenCalledTimes(2);
  expect(rowOf('b')).toHaveAttribute('data-open', 'true');
  expect(rowOf('b')).toHaveAttribute('aria-current', 'true');
  expect(rowOf('a')).not.toHaveAttribute('data-open');
});

it('lets the status dot change the status through its menu without opening the note', async () => {
  const props = setup();
  const dot = screen.getAllByRole('combobox', { name: 'Status for Title of a' })[0];
  expect(dot).not.toBeDisabled();
  expect(dot).toHaveClass('status-cell-dot');
  fireEvent.keyDown(dot, { key: 'ArrowDown' });
  await act(async () => {
    await Promise.resolve();
  });
  const listbox = screen.getByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: 'working' }));
  expect(props.onUpdateNoteStatus).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title of a' }), 'working');
  expect(props.onOpenNote).not.toHaveBeenCalled();
});

it('leaves the status dot inert in a read-only notebook', () => {
  setup({ readOnly: true });
  for (const dot of screen.getAllByRole('combobox')) expect(dot).toBeDisabled();
});

it('shows the hover card after the pointer rests on a row: status, every tag, both dates, folder, excerpt and actions', async () => {
  const props = setup();
  fireEvent.pointerEnter(rowOf('a'));
  act(() => vi.advanceTimersByTime(HOVER_CARD_OPEN_MS - 1));
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1);
    await Promise.resolve();
  });
  const card = screen.getByRole('group', { name: 'Details for Title of a' });
  expect(within(card).getByRole('combobox', { name: 'Status for Title of a' })).toHaveTextContent('todo');
  expect([...card.querySelectorAll('.note-tag-chip')].map(chip => chip.textContent)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  expect(card.querySelectorAll('time')).toHaveLength(2);
  expect(within(card).getByText('notes/life/projects')).toBeInTheDocument();
  // The excerpt drops the repeated heading, the Markdown marks, the link target and the code fence.
  expect(within(card).getByText('The opening line says what the note is about, with a link.')).toBeInTheDocument();
  expect(props.focusMode.readNote).toHaveBeenCalledTimes(1);
  expect(within(card).getByRole('button', { name: 'Open in zoom' })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Move note' })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
});

it('closes the hover card on Escape and after the pointer leaves, but not while it is over the card', async () => {
  setup();
  let card = await openCard('a');
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();

  card = await openCard('a');
  fireEvent.pointerLeave(rowOf('a'));
  fireEvent.pointerEnter(card);
  act(() => vi.advanceTimersByTime(HOVER_CARD_CLOSE_MS * 3));
  expect(screen.getByRole('group', { name: /Details for/ })).toBeInTheDocument();
  fireEvent.pointerLeave(card);
  act(() => vi.advanceTimersByTime(HOVER_CARD_CLOSE_MS));
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();
});

it('opens the hover card from keyboard focus after a short delay, moves into it with the right arrow and returns on Escape', async () => {
  setup();
  const row = rowOf('a');
  row.focus();
  fireEvent.focus(row);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_CARD_OPEN_MS);
    await Promise.resolve();
  });
  const card = screen.getByRole('group', { name: 'Details for Title of a' });
  fireEvent.keyDown(row, { key: 'ArrowRight' });
  expect(card.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();
  expect(document.activeElement).toBe(row);
});

it('moves between rows with the arrow keys', () => {
  setup();
  rowOf('a').focus();
  fireEvent.keyDown(rowOf('a'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rowOf('b'));
  fireEvent.keyDown(rowOf('b'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(rowOf('a'));
});

it('runs the card actions: zoom and move close it, delete waits for a second click when deletes need confirming', async () => {
  const props = setup({ confirmDelete: true });
  let card = await openCard('a');
  fireEvent.click(within(card).getByRole('button', { name: 'Open in zoom' }));
  expect(props.focusMode.onZoomNote).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title of a' }));
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();

  card = await openCard('a');
  fireEvent.click(within(card).getByRole('button', { name: 'Move note' }));
  expect(props.onMoveNote).toHaveBeenCalledTimes(1);

  card = await openCard('a');
  fireEvent.click(within(card).getByRole('button', { name: 'Delete note' }));
  expect(props.onDeleteNote).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('group', { name: /Details for/ })).getByRole('button', { name: 'Click again to confirm deletion' }));
  expect(props.onDeleteNote).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('group', { name: /Details for/ })).toBeNull();
});

it('leaves move and delete out of the card in a read-only notebook, and delete out when deleting is not allowed', async () => {
  setup({ readOnly: true });
  const card = await openCard('a');
  expect(within(card).getByRole('button', { name: 'Open in zoom' })).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Move note' })).toBeNull();
  expect(within(card).queryByRole('button', { name: 'Delete note' })).toBeNull();
  expect(within(card).getByRole('combobox', { name: 'Status for Title of a' })).toBeDisabled();
});

it('omits delete when the notebook does not allow it', async () => {
  setup({ canDelete: false });
  const card = await openCard('a');
  expect(within(card).getByRole('button', { name: 'Move note' })).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Delete note' })).toBeNull();
});

it('keeps group headings, bulk selection and the leading entry working in rows', () => {
  const onToggleSelect = vi.fn();
  const onToggleGroup = vi.fn();
  setup({ leading: createElement('button', null, 'Index entry'), groupOf: (n: NoteListItem) => ({ key: n.title === 'Title of a' ? 'x' : 'y', label: n.title === 'Title of a' ? 'Folder X' : 'Folder Y' }), onToggleGroup, collapsedGroups: new Set(['y']), onToggleSelect, selectedKeys: new Set(['life:notes/life/projects/a.md']) });
  expect(screen.getByRole('button', { name: 'Index entry' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Folder X/ }));
  expect(onToggleGroup).toHaveBeenCalledWith('x');
  // The collapsed folder keeps its heading and hides its note.
  expect(screen.getByRole('button', { name: /Folder Y/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Title of b')).toBeNull();
  expect(rowOf('a')).toHaveAttribute('data-selected', 'true');
  fireEvent.click(rowOf('a'), { shiftKey: true });
  expect(onToggleSelect).toHaveBeenCalledTimes(1);
});

it('starts a drag into the Focus from a row', () => {
  setup();
  const data: Record<string, string> = {};
  fireEvent.dragStart(rowOf('a'), { dataTransfer: { setData: (type: string, value: string) => (data[type] = value), effectAllowed: '' } });
  expect(data['application/x-mygitnotes-note']).toBe('notes/life/projects/a.md');
});

it('is what NoteCollection lists in the docked Focus, in place of the table and the cards', () => {
  const props = { notes: [note('a')], statuses: ['todo'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn() };
  const { container, rerender } = render(createElement(I18nProvider, null, createElement(NoteCollection, { ...props, focusMode: { onZoomNote: vi.fn(), canDrag: () => false, compactRows: true } })));
  expect(container.querySelector('.focus-note-list')).toBeInTheDocument();
  expect(container.querySelector('table, .note-card')).toBeNull();
  // On a phone the Focus list stays cards, as does the list with no Focus.
  rerender(createElement(I18nProvider, null, createElement(NoteCollection, { ...props, focusMode: { onZoomNote: vi.fn(), canDrag: () => false, compactRows: false } })));
  expect(container.querySelector('.focus-note-list')).toBeNull();
});

it('places the hover card beside the dock at the row height, never over the list, and keeps it in the window', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const dock = rect(44, 98, 240, 800);
  expect(hoverCardPosition({ rowRect: rect(50, 200, 228, 56), dockRect: dock }, { width: 320, height: 300 }, { width: 1440, height: 900 })).toEqual({ left: 292, top: 200 });
  // Near the bottom it slides up instead of running off the window.
  expect(hoverCardPosition({ rowRect: rect(50, 800, 228, 56), dockRect: dock }, { width: 320, height: 300 }, { width: 1440, height: 900 }).top).toBe(592);
  // With no room on the right it stays inside the window.
  expect(hoverCardPosition({ rowRect: rect(50, 200, 228, 56), dockRect: dock }, { width: 320, height: 300 }, { width: 500, height: 900 }).left).toBe(172);
});
