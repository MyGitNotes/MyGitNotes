// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { I18nProvider } from '../lib/i18n/index.js';
import { FoldedNoteDots } from './FoldedNoteDots.js';

const note = (path: string, title: string, status?: string): NoteListItem => ({ notebookId: 'life', path, title, status, tags: [] }) as unknown as NoteListItem;
const notes = [note('a.md', 'Weekly meeting', 'todo'), note('b.md', 'Spec draft', 'done'), note('c.md', 'Loose idea')];

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem('github-notes:language', 'en');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

it('keeps one status dot per listed note beside the folded list, the open one marked, and opens the note pressed', () => {
  const onOpenNote = vi.fn();
  render(<I18nProvider><FoldedNoteDots notes={notes} openPath='b.md' onOpenNote={onOpenNote} /></I18nProvider>);
  const list = screen.getByRole('list', { name: 'Notes in the list' });
  const buttons = within(list).getAllByRole('button');
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['Weekly meeting', 'Spec draft', 'Loose idea']);
  expect(buttons[0].querySelector('.status-dot')).not.toHaveClass('status-dot-empty');
  expect(buttons[2].querySelector('.status-dot')).toHaveClass('status-dot-empty');
  expect(buttons[1]).toHaveAttribute('aria-current', 'true');
  expect(buttons[0]).not.toHaveAttribute('aria-current');
  fireEvent.click(buttons[0]);
  expect(onOpenNote).toHaveBeenCalledWith(notes[0]);
});

it('names a dot\'s note and its status in a tooltip on hover', () => {
  render(<I18nProvider><FoldedNoteDots notes={notes} openPath={null} onOpenNote={() => {}} /></I18nProvider>);
  const [first, , third] = screen.getAllByRole('button');
  fireEvent.pointerEnter(first, { pointerType: 'mouse' });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole('tooltip')).toHaveTextContent('Weekly meeting');
  expect(screen.getByRole('tooltip')).toHaveTextContent('todo');
  fireEvent.pointerLeave(first, { pointerType: 'mouse' });
  fireEvent.pointerEnter(third, { pointerType: 'mouse' });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByRole('tooltip')).toHaveTextContent('No status');
});

it('shows nothing for an empty list', () => {
  const { container } = render(<I18nProvider><FoldedNoteDots notes={[]} openPath={null} onOpenNote={() => {}} /></I18nProvider>);
  expect(container).toBeEmptyDOMElement();
});
