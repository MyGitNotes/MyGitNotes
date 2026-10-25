// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotesEmptyState } from './NotesEmptyState.js';

const renderEmpty = (kind?: 'note' | 'outline' | 'compilation') => {
  const onNewNote = vi.fn();
  render(<NotesEmptyState readOnly={false} kind={kind} onNewNote={onNewNote} />);
  return onNewNote;
};

describe('NotesEmptyState', () => {
  afterEach(cleanup);

  it('offers a plain note by default', () => {
    const onNewNote = renderEmpty();
    fireEvent.click(screen.getByRole('button', { name: 'Create Note' }));
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it('offers what the list shows: an outline note, or a compilation note', () => {
    renderEmpty('outline');
    expect(screen.getByRole('button', { name: 'Create Outline Note' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create Note' })).toBeNull();
  });

  it("leaves a phone's plain note list to the navigation's New Note, and keeps the outline and compilation buttons", () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
    try {
      renderEmpty();
      expect(screen.queryByRole('button', { name: 'Create Note' })).toBeNull();
      cleanup();
      renderEmpty('outline');
      expect(screen.getByRole('button', { name: 'Create Outline Note' })).toBeTruthy();
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('offers a compilation note in the compilation list', () => {
    renderEmpty('compilation');
    expect(screen.getByRole('button', { name: 'Create Compilation Note' })).toBeTruthy();
  });
});
