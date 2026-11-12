// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../../lib/panel-context.js';
import type { MarkdownEditorHandle } from '../MarkdownEditor.js';
import { NoteEditor, type NoteEditorProps } from '../NoteEditor.js';
import { SlideDeck } from './SlideDeck.js';

vi.mock('../MarkdownEditor.js', () => ({
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; slides?: boolean; onChange: (content: string) => void; }>(({ content, slides, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, insertAnnotated() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1, getSelection: () => null, ready: () => true, focus() {} }), []);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, 'data-slides': slides ? 'true' : 'false', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

const slideNote = { id: 'a', path: 'notes/a/deck.md', notebookId: 'a', title: 'Deck', tags: [], metadata: { title: 'Deck', type: 'slide' }, content: '## One\n\n::summary\n', lineNumberOffset: 4 };
const editor = (note: typeof slideNote | (Omit<typeof slideNote, 'metadata'> & { metadata: Record<string, unknown>; })) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'pane', active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' } as unknown as NoteEditorProps));

describe('a type: slide note in the editor', () => {
  it('offers Play and Notes, and tells its editor it is a slide note', () => {
    render(editor(slideNote));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('data-slides', 'true');
  });

  it('offers them whatever engine its slideOptions name', () => {
    render(editor({ ...slideNote, metadata: { type: 'slide', slideOptions: { engine: 'reveal' } } }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('offers neither for a note of another type', () => {
    render(editor({ ...slideNote, metadata: { title: 'Deck' } }));
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('data-slides', 'false');
  });

  it('shows what contour-deck refuses the note for, and the line as the editor numbers it, instead of a deck', async () => {
    render(editor(slideNote));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const refusal = await screen.findByRole('alertdialog', undefined, { timeout: 10_000 });
    expect(refusal).toHaveTextContent('These slides cannot be played');
    expect(refusal).toHaveTextContent('summary is a container directive: write :::summary … :::');
    // The directive is on line 3 of the text, under four lines of frontmatter.
    expect(refusal).toHaveTextContent('Line 7');
    expect(document.querySelector('.ct-app')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the note' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('the deck of a slide note', () => {
  const deck = (content: string, onClose = () => {}) => createElement(SlideDeck, { content, path: 'notes/a/deck.md', title: 'Deck', view: 'deck', onClose });

  it('says so when the note has no slide', async () => {
    render(deck('\n'));
    expect(await screen.findByRole('alertdialog', undefined, { timeout: 10_000 })).toHaveTextContent('This note has no slides yet.');
  });

  it('closes on Escape while a refusal stands in its place', async () => {
    const onClose = vi.fn();
    render(deck('::block{title="A"}\n', onClose));
    expect(await screen.findByRole('alertdialog', undefined, { timeout: 10_000 })).toHaveTextContent('::block "A" has no slide after it');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
