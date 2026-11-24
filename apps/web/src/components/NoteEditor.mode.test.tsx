// @vitest-environment jsdom
import { createElement, forwardRef, useContext, useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, UNSAFE_NavigationContext, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { EditorModeRouteProvider } from '../app/editor-mode-route.js';
import { PanelProvider } from '../lib/panel-context.js';
import { PhoneNotesProvider } from '../lib/phone-notes.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';

/** The mode the editor body was last given. */
let shown: string | undefined;
vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditor: forwardRef<unknown, { content: string; mode: string; }>(({ content, mode }, _ref) => {
    shown = mode;
    return createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly: true });
  }),
}));

let phone = false;
beforeEach(() => {
  phone = false;
  shown = undefined;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const NOTE = '/notebooks/a/notes/a.md';

function Address({ report }: { report: (address: { url: string; index: number; }) => void; }) {
  const location = useLocation();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  useLayoutEffect(() => report({ url: location.pathname + location.search + location.hash, index: (navigator as unknown as { index: number; }).index }));
  return null;
}

function open(url: string, props: Partial<NoteEditorProps> = {}) {
  const address = { current: { url: '', index: 0 } };
  render(
    <MemoryRouter initialEntries={['/notebooks/a', url]} initialIndex={1}>
      <EditorModeRouteProvider>
        <PhoneNotesProvider value={{ back: () => {}, changesCount: 0 }}>
          <PanelProvider>
            <NoteEditor {...{ note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps} />
          </PanelProvider>
        </PhoneNotesProvider>
        <Address report={value => void (address.current = value)} />
      </EditorModeRouteProvider>
    </MemoryRouter>,
  );
  return address;
}
const modes = () => screen.getByRole('group', { name: 'Editor mode' });

describe('the editor mode of a zoomed note', () => {
  it('opens in the mode the URL names', () => {
    open(`${NOTE}?mode=source&returnTo=%2Fnotebooks%2Fa`);
    expect(shown).toBe('raw');
    expect(within(modes()).getByRole('button', { name: /^Source/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens live when the URL names no mode', () => {
    open(`${NOTE}?returnTo=%2Fnotebooks%2Fa`);
    expect(shown).toBe('live');
    expect(within(modes()).getByRole('button', { name: /^Live Preview/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches among live, source and split from three buttons in the head toolbar, replacing the history entry', () => {
    const address = open(`${NOTE}?returnTo=%2Fnotebooks%2Fa#part`);
    const index = address.current.index;
    const toolbar = document.querySelector('.note-toolbar')!;
    expect(toolbar.contains(modes())).toBe(true);
    expect(within(modes()).getAllByRole('button').map(button => button.getAttribute('aria-label')?.split(' (')[0])).toEqual(['Live Preview', 'Source', 'Split view']);
    act(() => fireEvent.click(within(modes()).getByRole('button', { name: 'Split view' })));
    expect(shown).toBe('split');
    expect(address.current.url).toBe(`${NOTE}?returnTo=%2Fnotebooks%2Fa&mode=split#part`);
    expect(address.current.index).toBe(index);
    act(() => fireEvent.click(within(modes()).getByRole('button', { name: /^Live Preview/ })));
    expect(shown).toBe('live');
    expect(address.current.url).toBe(`${NOTE}?returnTo=%2Fnotebooks%2Fa#part`);
    expect(address.current.index).toBe(index);
  });

  it('opens live on a phone for a split link, without rewriting the URL, and offers no split there', () => {
    phone = true;
    const address = open(`${NOTE}?mode=split&returnTo=%2Fnotebooks%2Fa`);
    expect(shown).toBe('live');
    expect(address.current.url).toBe(`${NOTE}?mode=split&returnTo=%2Fnotebooks%2Fa`);
    expect(screen.queryByRole('button', { name: 'Split view' })).toBeNull();
    // The phone sheet keeps its one switch, which writes the mode it chose.
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Switch to source' })));
    expect(shown).toBe('raw');
    expect(address.current.url).toBe(`${NOTE}?mode=source&returnTo=%2Fnotebooks%2Fa`);
  });
});

describe('the editor mode of a Focus pane', () => {
  it('shows split for a split link, without rewriting the URL', () => {
    const address = open(`${NOTE}?mode=split`, { frame: 'pane' });
    expect(shown).toBe('split');
    expect(address.current.url).toBe(`${NOTE}?mode=split`);
  });

  it('shows source where the URL names it', () => {
    open(`${NOTE}?mode=source`, { frame: 'pane' });
    expect(shown).toBe('raw');
  });

  it('changes mode in place; only the frame toggle requests zoom', () => {
    const toggleFrame = vi.fn(async () => true);
    const address = open(NOTE, { frame: 'pane', zoomNavigation: { open: toggleFrame, selection: { get: () => null, set: vi.fn() } } });
    const zoom = screen.getByRole('button', { name: 'Zoom note' });
    expect(zoom).toHaveAttribute('aria-pressed', 'false');
    act(() => fireEvent.click(within(modes()).getByRole('button', { name: 'Split view' })));
    expect(shown).toBe('split');
    expect(document.querySelector('.note-editor')?.getAttribute('data-frame')).toBe('pane');
    expect(address.current.url).toBe(`${NOTE}?mode=split`);
    expect(toggleFrame).not.toHaveBeenCalled();
    fireEvent.click(zoom);
    expect(toggleFrame).toHaveBeenCalledWith('split');
  });
});
