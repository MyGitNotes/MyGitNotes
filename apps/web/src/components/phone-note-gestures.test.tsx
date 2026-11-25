// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { PlacedCard } from '../lib/board/placement.js';
import { HOLD_MS } from '../lib/hold.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { ROW_ACTION_PX } from '../lib/row-swipe.js';
import { BoardCard } from './board/BoardCard.js';
import { FocusNoteList } from './FocusNoteList.js';
import { NoteActionSheetProvider, type NoteSheetActions } from './NoteActionSheet.js';

beforeAll(() => {
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
  document.body.innerHTML = "<div id='root'></div>";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

const note = (name: string, extra: Partial<NoteListItem> = {}): NoteListItem => ({ id: name, path: `notes/life/${name}.md`, notebookId: 'life', title: `Title of ${name}`, status: 'todo', tags: [], metadata: {}, ...extra });

function actions(): NoteSheetActions & { moved: ReturnType<typeof vi.fn>; } {
  const moved = vi.fn();
  return { statusesOf: () => ['todo', 'working', 'done'], writable: () => true, updateStatus: vi.fn(), move: () => moved, remove: vi.fn(), moved };
}

function app(children: ReactNode, sheetActions: NoteSheetActions | undefined = actions()) {
  return render(
    <I18nProvider>
      <NoteActionSheetProvider actions={sheetActions}>{children}</NoteActionSheetProvider>
    </I18nProvider>,
    { container: document.getElementById('root')! },
  );
}

function list(overrides: Record<string, unknown> = {}) {
  const props = { notes: [note('a'), note('b', { status: 'done' })], statuses: ['todo', 'working', 'done'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onMoveNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn(), onToggleSelect: vi.fn(), swipeActions: true, ...overrides };
  const sheet = actions();
  app(createElement(FocusNoteList, props as never), sheet);
  return { props, sheet };
}

const rowOf = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-row-swipe]')].find(row => row.textContent?.includes(`Title of ${name}`))!;
const titleOf = (name: string) => rowOf(name).querySelector<HTMLElement>('.focus-row-title')!;

/** Fires one native touch event with one finger at (x, y), or none for a lift. */
function touch(target: Element, type: string, x?: number, y = 300) {
  const touches = x === undefined ? [] : [{ clientX: x, clientY: y, identifier: 0 }];
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: [{ clientX: x ?? 0, clientY: y, identifier: 0 }] } });
  act(() => void target.dispatchEvent(event));
  return event;
}

/** A finger from x pushed dx across (and dy down) and lifted, then the click a browser sends after a touch. */
function swipe(target: Element, x: number, dx: number, dy = 0) {
  touch(target, 'touchstart', x);
  touch(target, 'touchmove', x + dx / 2, 300 + dy / 2);
  const move = touch(target, 'touchmove', x + dx, 300 + dy);
  touch(target, 'touchend');
  fireEvent.click(target);
  return move;
}

function hold(target: Element, x = 150) {
  touch(target, 'touchstart', x);
  act(() => void vi.advanceTimersByTime(HOLD_MS));
  touch(target, 'touchend');
  fireEvent.click(target);
}

describe('holding a phone list row', () => {
  it("opens the note's menu, titled with the note, and the lift opens nothing", () => {
    const { props } = list();
    hold(titleOf('a'));
    const sheet = screen.getByRole('dialog', { name: 'Title of a' });
    expect(within(sheet).getAllByRole('button').map(button => button.textContent)).toEqual(['', 'Open', 'Change status', 'Move note', 'Select', 'Delete note']);
    expect(props.onOpenNote).not.toHaveBeenCalled();
  });

  it("runs the page's own actions: open, a status from the notebook's list, move, select, and delete after a confirmation", () => {
    const { props, sheet } = list();
    hold(titleOf('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.onOpenNote).toHaveBeenCalledWith(props.notes[0]);
    expect(screen.queryByRole('dialog')).toBeNull();

    hold(titleOf('a'));
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
    const statuses = within(screen.getByRole('group', { name: 'Change status' })).getAllByRole('button').map(button => button.textContent);
    expect(statuses).toEqual(['No status', 'todo', 'working', 'done', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    expect(sheet.updateStatus).toHaveBeenCalledWith(props.notes[0], 'done');

    hold(titleOf('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
    expect(sheet.moved).toHaveBeenCalledTimes(1);

    hold(titleOf('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(props.onToggleSelect).toHaveBeenCalledWith(props.notes[1]);

    hold(titleOf('b'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByText('Delete “Title of b”?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(sheet.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(sheet.remove).toHaveBeenCalledWith(props.notes[1]);
  });

  it('opens nothing when the finger moves 8 px first, so a scroll or a swipe stays one', () => {
    const { props } = list();
    const title = titleOf('a');
    touch(title, 'touchstart', 150);
    touch(title, 'touchmove', 150, 309);
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    touch(title, 'touchend');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onOpenNote).not.toHaveBeenCalled();
  });

  it('keeps a plain tap opening the note', () => {
    const { props } = list();
    fireEvent.click(titleOf('a'));
    expect(props.onOpenNote).toHaveBeenCalledWith(props.notes[0]);
  });
});

describe('swiping a phone list row', () => {
  it('pushed right, reveals 變更狀態 and changes nothing until it is tapped, which opens the status picker', () => {
    const { props, sheet } = list();
    const move = swipe(titleOf('a'), 100, ROW_ACTION_PX + 20);
    expect(move.defaultPrevented).toBe(true);
    expect(rowOf('a')).toHaveAttribute('data-revealed', 'start');
    expect(sheet.updateStatus).not.toHaveBeenCalled();
    expect(props.onOpenNote).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf('a')).getByRole('button', { name: 'Change status' }));
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
    expect(screen.getByRole('group', { name: 'Change status' })).toBeInTheDocument();
  });

  it('pushed left, reveals 刪除, which asks before it deletes', () => {
    const { props, sheet } = list();
    swipe(titleOf('b'), 300, -(ROW_ACTION_PX + 20));
    expect(rowOf('b')).toHaveAttribute('data-revealed', 'end');
    fireEvent.click(within(rowOf('b')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete “Title of b”?')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(sheet.remove).toHaveBeenCalledWith(props.notes[1]);
  });

  it("springs back when let go short of half its actions, and leaves a scroll or the drawer's left edge alone", () => {
    list();
    swipe(titleOf('a'), 100, ROW_ACTION_PX / 2 - 10);
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
    const scroll = swipe(titleOf('a'), 100, 30, 120);
    expect(scroll.defaultPrevented).toBe(false);
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
    swipe(titleOf('a'), 10, 200);
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
  });

  it('closes revealed actions on the next tap, on the row or elsewhere, which opens nothing', () => {
    const { props } = list();
    swipe(titleOf('a'), 100, ROW_ACTION_PX + 20);
    touch(titleOf('a'), 'touchstart', 200);
    touch(titleOf('a'), 'touchend');
    fireEvent.click(titleOf('a'));
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
    expect(props.onOpenNote).not.toHaveBeenCalled();

    swipe(titleOf('a'), 100, ROW_ACTION_PX + 20);
    expect(rowOf('a')).toHaveAttribute('data-revealed', 'start');
    // The touch reaches nothing under it: no other row's swipe or hold, no drawer, no assistant.
    const heard = vi.fn();
    titleOf('b').addEventListener('touchstart', heard);
    touch(titleOf('b'), 'touchstart', 200);
    touch(titleOf('b'), 'touchend');
    fireEvent.click(titleOf('b'));
    expect(heard).not.toHaveBeenCalled();
    expect(rowOf('a')).not.toHaveAttribute('data-revealed');
    expect(props.onOpenNote).not.toHaveBeenCalled();
  });

  it("leaves rows as they were without the page's note menu", () => {
    list({ swipeActions: false });
    expect(document.querySelector('[data-row-swipe]')).toBeNull();
    expect(document.querySelectorAll('[role="listitem"][data-focus-row]')).toHaveLength(2);
  });
});

describe('holding a whiteboard card on a phone', () => {
  const item: CompilationItem = { kind: 'note', notebookId: 'life', path: 'notes/life/a.md' } as CompilationItem;
  const card = { key: 'c1', item, ref: { item: 'c1' }, rect: { x: 0, y: 0, w: 240, h: 128 }, placed: true } as unknown as PlacedCard;

  it('opens the same menu, whose delete deletes the note itself, and a tap still opens the card', () => {
    const onOpen = vi.fn();
    const sheet = actions();
    const shown = note('a');
    const onHold = vi.fn();
    const view = { title: 'Title of a', note: shown, missing: false, loading: false };
    const { rerender } = app(createElement(BoardCard, { card, view, originX: 0, originY: 0, onOpen, onHold }), sheet);
    const button = screen.getByRole('button', { name: /Title of a/ });
    fireEvent.touchStart(button, { touches: [{ clientX: 50, clientY: 50 }] });
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    fireEvent.touchEnd(button, { touches: [] });
    fireEvent.click(button);
    expect(onHold).toHaveBeenCalledWith(item, shown);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // A move past 8 px is the board's pan, not a hold.
    fireEvent.touchStart(button, { touches: [{ clientX: 50, clientY: 50 }] });
    fireEvent.touchMove(button, { touches: [{ clientX: 70, clientY: 50 }] });
    act(() => void vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
    rerender(
      <I18nProvider>
        <NoteActionSheetProvider actions={sheet}>
          <BoardCard card={card} view={view} originX={0} originY={0} onOpen={onOpen} />
        </NoteActionSheetProvider>
      </I18nProvider>,
    );
    expect(button).not.toHaveAttribute('data-holdable');
  });
});
