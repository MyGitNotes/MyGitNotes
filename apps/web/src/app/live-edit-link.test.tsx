// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement, forwardRef, useContext, useLayoutEffect, useState } from 'react';
import { MemoryRouter, UNSAFE_NavigationContext, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { NoteEditor, type NoteEditorProps } from '../components/NoteEditor.js';
import { forgetCheckedIn, type LiveNoteEditing, takeLiveEditRequest } from '../lib/live-api.js';
import { PanelProvider } from '../lib/panel-context.js';
import { FOCUS_NOTE_STATE } from '../lib/routes.js';
import type { NoteItem } from '../lib/types.js';
import { LiveEditLinkProvider, liveEditLinkTarget } from './live-edit-link.js';

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    destroy() {}
    on() {}
  },
}));
vi.mock('../components/MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} })) }));

const editor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const note: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'Alpha', tags: [], metadata: { title: 'Alpha', status: 'inbox' }, content: '# Alpha\n' };
const other: NoteItem = { ...note, id: 'b', path: 'notes/life/b.md', title: 'Beta', metadata: { title: 'Beta', status: 'inbox' }, content: '# Beta\n' };
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'https://live.example.test/abc', embedUrl: 'https://live.example.test/embed/abc', since: '2026-11-15T01:00:00.000Z', activeEditors: 0, conflict: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const NOTE = '/notebooks/notes~life/notes/a.md';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async () => json({ checkout: view, outcome: 'created' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  forgetCheckedIn(noteRefKey(note));
  takeLiveEditRequest(noteRefKey(note));
  vi.unstubAllGlobals();
});

const checkouts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/live/checkout');

interface Probe {
  url: string;
  state: unknown;
  index: number;
}

type Frame = 'zoom' | 'pane' | 'inline';

/**
 * The page around the routed note's editor as the app wires it: the address names `note`; in zoom its editor shows it,
 * in the Focus the active pane does (the entry carries the mark of a Focus address). `live` is what the app hands a
 * writer of a repository with a live editor; a reader, or a deployment without one, gets none. `openZoom` lends the
 * editor to zoom, as zoom does with a note a pane shows.
 */
function Page({ frame: initial, shown = note, live = true, collab = false, report, zoomOpened }: { frame: Frame; shown?: NoteItem; live?: boolean; collab?: boolean; report: (probe: Probe) => void; zoomOpened: () => void; }) {
  const location = useLocation();
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [frame, setFrame] = useState<Frame>(initial);
  const [openZoom] = useState(() => () => {
    zoomOpened();
    setFrame('zoom');
  });
  useLayoutEffect(() => report({ url: location.pathname + location.search + location.hash, state: location.state, index: (navigator as unknown as { index: number; }).index }));
  const target = liveEditLinkTarget({ search: location.search, state: location.state, routedNote: note, zoomOpen: initial === 'zoom', inFocus: initial !== 'zoom', focusPending: false, activeNotePath: note.path });
  const editing: LiveNoteEditing | undefined = live ? { editor: collab ? { kind: 'builtin' } : editor, onRefetch: () => {}, openZoom } : undefined;
  const props = { note: shown, frame, active: true, statuses: ['inbox', 'done'], autoSave: true, onSave: async () => shown, onRestoreFile: async () => null, onCommitFile: async () => {}, branch: 'main', draftScope: 'src:main', onClose: frame === 'zoom' ? () => {} : undefined, live: editing } as NoteEditorProps;
  return (
    <LiveEditLinkProvider target={target}>
      <PanelProvider>
        <NoteEditor {...props} />
      </PanelProvider>
    </LiveEditLinkProvider>
  );
}

async function open(entry: { pathname: string; search?: string; hash?: string; state?: unknown; }, page: Omit<Parameters<typeof Page>[0], 'report' | 'zoomOpened'>) {
  const probe = { current: undefined as unknown as Probe };
  const opened = vi.fn();
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/notebooks/notes~life', entry]} initialIndex={1}>
        <Page {...page} report={value => void (probe.current = value)} zoomOpened={opened} />
      </MemoryRouter>,
    );
  });
  return { probe, opened };
}

describe('a note address with ?edit', () => {
  it('checks the note out once in zoom and takes edit out of the address, keeping the rest, the hash and the entry', async () => {
    const { probe } = await open({ pathname: NOTE, search: '?zoom&edit&q=x&live=editing', hash: '#part', state: { from: 'link' } }, { frame: 'zoom' });
    expect(checkouts()).toHaveLength(1);
    expect(checkouts()[0]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(document.querySelector('iframe')).not.toBeNull();
    expect(probe.current.url).toBe(`${NOTE}?zoom&q=x&live=editing#part`);
    expect(probe.current.state).toEqual({ from: 'link' });
    expect(probe.current.index).toBe(1);
    await act(async () => {});
    expect(checkouts()).toHaveLength(1);
  });

  it('does not check out again after a reload of the address it left', async () => {
    const { probe } = await open({ pathname: NOTE, search: '?zoom&edit' }, { frame: 'zoom' });
    expect(checkouts()).toHaveLength(1);
    const left = probe.current.url;
    cleanup();
    fetchMock.mockClear();
    const [pathname, search] = left.split('?');
    await open({ pathname: pathname!, search: search ? `?${search}` : '' }, { frame: 'zoom' });
    expect(checkouts()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('opens zoom from a Focus pane, as Edit does there, and checks the note out on arrival', async () => {
    const { probe, opened } = await open({ pathname: NOTE, search: '?edit&mode=split', state: FOCUS_NOTE_STATE }, { frame: 'pane' });
    expect(opened).toHaveBeenCalledTimes(1);
    // The pane's entry leaves edit before zoom opens over it, so Back returns to it without asking again.
    expect(probe.current.url).toBe(`${NOTE}?mode=split`);
    expect(probe.current.state).toEqual(FOCUS_NOTE_STATE);
    expect(checkouts()).toHaveLength(1);
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('waits until the Focus marked the address as its own before acting in a pane', async () => {
    const { probe, opened } = await open({ pathname: NOTE, search: '?edit' }, { frame: 'pane' });
    expect(opened).not.toHaveBeenCalled();
    expect(checkouts()).toHaveLength(0);
    expect(probe.current.url).toBe(`${NOTE}?edit`);
  });

  it('is ignored, and left in the address, where the note has no live editor for this person (no live editor, or a reader)', async () => {
    const { probe } = await open({ pathname: NOTE, search: '?zoom&edit' }, { frame: 'zoom', live: false });
    expect(checkouts()).toHaveLength(0);
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    expect(probe.current.url).toBe(`${NOTE}?zoom&edit`);
    cleanup();
    const pane = await open({ pathname: NOTE, search: '?edit', state: FOCUS_NOTE_STATE }, { frame: 'pane', live: false });
    expect(checkouts()).toHaveLength(0);
    expect(pane.probe.current.url).toBe(`${NOTE}?edit`);
  });

  it('is left to the routed note: the editor of another note, or a compilation section of this one, takes nothing', async () => {
    const { probe, opened } = await open({ pathname: NOTE, search: '?edit', state: FOCUS_NOTE_STATE }, { frame: 'pane', shown: other });
    expect(opened).not.toHaveBeenCalled();
    expect(probe.current.url).toBe(`${NOTE}?edit`);
    cleanup();
    const inline = await open({ pathname: NOTE, search: '?edit', state: FOCUS_NOTE_STATE }, { frame: 'inline' });
    expect(inline.opened).not.toHaveBeenCalled();
    expect(checkouts()).toHaveLength(0);
    expect(inline.probe.current.url).toBe(`${NOTE}?edit`);
  });
});

describe('a note address with ?edit, where the repository opens notes collab-first', () => {
  it('in zoom, checks the note out once and takes edit out of the address', async () => {
    const { probe } = await open({ pathname: NOTE, search: '?zoom&edit&q=x', hash: '#part' }, { frame: 'zoom', collab: true });
    expect(checkouts()).toHaveLength(1);
    expect(probe.current.url).toBe(`${NOTE}?zoom&q=x#part`);
    expect(screen.getByRole('toolbar', { name: 'Live editor' })).toBeInTheDocument();
  });

  it('in a Focus pane, opens the collab editor there, without zoom, and takes edit out of the address', async () => {
    const { probe, opened } = await open({ pathname: NOTE, search: '?edit&mode=split', state: FOCUS_NOTE_STATE }, { frame: 'pane', collab: true });
    expect(opened).not.toHaveBeenCalled();
    expect(checkouts()).toHaveLength(1);
    expect(probe.current.url).toBe(`${NOTE}?mode=split`);
    expect(probe.current.state).toEqual(FOCUS_NOTE_STATE);
    expect(screen.getByRole('toolbar', { name: 'Live editor' })).toBeInTheDocument();
  });
});

describe('the note an ?edit address asks to edit', () => {
  const arrival = { search: '?edit', state: null, routedNote: note, zoomOpen: false, inFocus: false, focusPending: false, activeNotePath: undefined };
  it('is the routed note once zoom shows it', () => {
    expect(liveEditLinkTarget({ ...arrival, zoomOpen: true })).toBe(noteRefKey(note));
  });
  it('is the routed note once the Focus settled on it in the active pane and marked the address', () => {
    const settled = { ...arrival, inFocus: true, activeNotePath: note.path, state: FOCUS_NOTE_STATE };
    expect(liveEditLinkTarget(settled)).toBe(noteRefKey(note));
    expect(liveEditLinkTarget({ ...settled, focusPending: true })).toBeNull();
    expect(liveEditLinkTarget({ ...settled, state: null })).toBeNull();
    expect(liveEditLinkTarget({ ...settled, activeNotePath: other.path })).toBeNull();
  });
  it('is none without edit, or before the note was read', () => {
    expect(liveEditLinkTarget({ ...arrival, zoomOpen: true, search: '?live=editing&mode=split' })).toBeNull();
    expect(liveEditLinkTarget({ ...arrival, zoomOpen: true, routedNote: null })).toBeNull();
  });
});
