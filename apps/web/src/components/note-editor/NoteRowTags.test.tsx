// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NoteRowTags } from './NoteRowTags.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Renders the tags in a row the given width wide, as the row's ResizeObserver would measure it. */
const tagsIn = (width: number) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.classList.contains('note-tags') ? width : 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) };
  });
  const setMetadata = vi.fn();
  render(createElement(NoteRowTags, { metadata: { tags: ['planning'] }, setMetadata, availableTags: ['planning', 'review'], locked: false }));
  return setMetadata;
};

it('keeps the add-tag field in a row with room for it', () => {
  tagsIn(400);
  expect(screen.getByRole('textbox', { name: 'Add tag' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add tag' })).toBeNull();
});

it('folds the add-tag field into a + button in a narrow row, and the button opens the field and adds a tag', () => {
  const setMetadata = tagsIn(120);
  expect(screen.queryByRole('textbox', { name: 'Add tag' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  const field = screen.getByRole('textbox', { name: 'Add tag' });
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: 'review' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(setMetadata).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Add tag' })).toBeInTheDocument();
});

it('closes the opened field on Escape', () => {
  tagsIn(120);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tag' }), { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Add tag' })).toBeNull();
});
