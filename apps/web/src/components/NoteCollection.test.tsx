// @vitest-environment jsdom
import { act, createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NOTE_CARDS_BELOW, NoteCollection, noteCollectionLayout } from './NoteCollection.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';

const observers: { callback: ResizeObserverCallback; }[] = [];
globalThis.ResizeObserver = class {
  constructor(callback: ResizeObserverCallback) {
    observers.push({ callback });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  observers.length = 0;
});

const noteOf = (path: string): NoteListItem => ({ id: path, path, notebookId: 'life', title: `Title: ${path}`, tags: [], metadata: {} });
const baseProps = { statuses: ['inbox'], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn(), notes: [noteOf('notes/a.md')] };

function resize(width: number) {
  act(() => observers.at(-1)!.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver));
}

it('picks cards only for a measured region narrower than the threshold', () => {
  expect(noteCollectionLayout(0)).toBe('list');
  expect(noteCollectionLayout(NOTE_CARDS_BELOW - 1)).toBe('card');
  expect(noteCollectionLayout(NOTE_CARDS_BELOW)).toBe('list');
});

it('switches between the table and cards as its region resizes', () => {
  const { container } = render(createElement(NoteCollection, baseProps));
  expect(container.querySelector('table')).toBeInTheDocument();
  resize(480);
  expect(container.querySelector('table')).not.toBeInTheDocument();
  expect(container.querySelector('.note-card')).toBeInTheDocument();
  expect(screen.getByText('Title: notes/a.md')).toBeInTheDocument();
  resize(960);
  expect(container.querySelector('table')).toBeInTheDocument();
});

it('keeps the leading entry above the cards', () => {
  render(createElement(NoteCollection, { ...baseProps, leading: createElement('span', null, 'Folder index') }));
  resize(400);
  expect(screen.getByText('Folder index')).toBeInTheDocument();
});
