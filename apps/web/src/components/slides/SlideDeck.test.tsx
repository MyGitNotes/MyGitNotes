// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../../lib/panel-context.js';
import type { MarkdownEditorHandle } from '../MarkdownEditor.js';
import { NoteEditor, type NoteEditorProps } from '../NoteEditor.js';
import { SlideDeck } from './SlideDeck.js';

vi.mock('../MarkdownEditor.js', () => ({
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; slides?: string; onChange: (content: string) => void; }>(({ content, slides, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, insertAnnotated() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1, getSelection: () => null, ready: () => true, focus() {} }), []);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, 'data-slides': slides ?? 'none', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

// jsdom has no modal dialogs.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const slideNote = { id: 'a', path: 'notes/a/deck.md', notebookId: 'a', title: 'Deck', tags: [], metadata: { title: 'Deck', type: 'slide' }, content: '## One\n\n::summary\n', lineNumberOffset: 4 };
const editor = (note: typeof slideNote | (Omit<typeof slideNote, 'metadata'> & { metadata: Record<string, unknown>; }), frame: 'pane' | 'zoom' = 'pane') => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame, active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' } as unknown as NoteEditorProps));

describe('a type: slide note in the editor', () => {
  it('offers Play and Notes, and tells its editor it is a slide note', () => {
    render(editor(slideNote));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('data-slides', 'slides');
  });

  it('offers them whatever engine its slideOptions name', () => {
    render(editor({ ...slideNote, metadata: { type: 'slide', slideOptions: { engine: 'reveal' } } }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('offers neither for a note of another type', () => {
    render(editor({ ...slideNote, metadata: { title: 'Deck' } }));
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('data-slides', 'none');
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

  it('reads a note with slideOptions.structure: headings by its headings, in the editor and in the deck', async () => {
    render(editor({ ...slideNote, metadata: { type: 'slide', slideOptions: { structure: 'headings' } }, content: '## One\n\ntext\n\n::vertical\n\n### Two\n' }));
    expect(screen.getByLabelText('Note content')).toHaveAttribute('data-slides', 'headings');
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // The same text plays in a note read by its separators; here contour-deck refuses its ::vertical.
    const refusal = await screen.findByRole('alertdialog', undefined, { timeout: 10_000 });
    expect(refusal).toHaveTextContent('::vertical has no meaning with structure: "headings": start the next page with a ### heading');
    expect(refusal).toHaveTextContent('Line 9');
  });
});

describe('a deck played over a note whose outline panel is open', () => {
  it('takes Enter, the arrows and Escape, which the panel behind it does not see', async () => {
    // What contour-deck asks of a browser that jsdom lacks.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    Element.prototype.getAnimations ??= () => [];
    Element.prototype.scrollIntoView ??= () => {};
    Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {} }) as unknown as Animation;
    render(editor({ ...slideNote, content: '## One\n\ntext\n\n::vertical\n\nmore\n\n---\n\n## Two\n\nlast\n' }, 'zoom'));
    // The leader, then / opens the outline.
    fireEvent.keyDown(document.body, { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' });
    expect(await screen.findByRole('navigation', { name: 'Outline' })).toBeInTheDocument();
    const play = screen.getByRole('button', { name: 'Play' });
    fireEvent.click(play);
    await waitFor(() => expect(document.querySelector('.ct-app')).not.toBeNull(), { timeout: 10_000 });
    const app = document.querySelector<HTMLElement>('.ct-app')!;
    expect(app.dataset.ctMode).toBe('overview');
    fireEvent.keyDown(app, { key: 'Enter' });
    await waitFor(() => expect(app.dataset.ctMode).toBe('stage'));
    // contour-deck takes the arrows (jsdom lays out no page to scroll to); the outline behind the deck stays where it was.
    const outlineAt = () => document.querySelector('.note-outline [aria-current="true"]')?.textContent;
    const before = outlineAt();
    for (const key of ['ArrowDown', 'ArrowUp', 'j']) expect(fireEvent.keyDown(app, { key })).toBe(key === 'j');
    expect(outlineAt()).toBe(before);
    // A chord of the app opens nothing under the deck.
    fireEvent.keyDown(app, { key: 'p', code: 'KeyP', ctrlKey: true });
    expect(document.querySelector('[data-key-scope="palette"]')).toBeNull();
    fireEvent.keyDown(app, { key: 'Escape' });
    await waitFor(() => expect(app.dataset.ctMode).toBe('overview'));
    // The outline is still open behind the deck: Escape went to the deck, not to the panel.
    expect(screen.getByRole('navigation', { name: 'Outline', hidden: true })).toBeInTheDocument();
    fireEvent.keyDown(app, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.ct-app')).toBeNull());
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
