// @vitest-environment jsdom
import { createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { PanelProvider } from '../../lib/panel-context.js';
import { PhoneNotesProvider } from '../../lib/phone-notes.js';
import type { NoteItem } from '../../lib/types.js';
import { forgetCheckedIn, type LiveNoteEditing, markCheckedIn, takeLiveEditRequest } from '../../lib/live-api.js';
import { NoteEditor, type NoteEditorProps } from '../NoteEditor.js';
import { LiveBadge } from './LiveBadge.js';

/*
 * Collab-first opening (docs/specs/2026-11-16-collab-first-self-host A1, A7): where the repository's editor is the built-in
 * one, a writer's note opens straight into the collab editor in zoom, a Focus pane and the phone's note screen, with no
 * 編輯; deleting it from its own editor checks it in first, while moving or renaming it records where it goes (§20.4).
 */

interface FakeConfig {
  document: import('yjs').Doc;
  token?: () => Promise<string>;
  onDirty?: (event: { dirty: boolean; }) => void;
  onStatus?: (event: { status: string; }) => void;
  onSynced?: (event: { state: boolean; }) => void;
}
/** `socket`: the browser socket a provider is on, when a test follows its close; none by default. */
const fake = vi.hoisted(() => ({ order: [] as string[], config: null as null | FakeConfig, socket: null as null | (EventTarget & { readyState: number; }) }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    configuration: FakeConfig & { websocketProvider: { webSocket: EventTarget | null; }; };
    constructor(configuration: FakeConfig) {
      fake.config = configuration;
      this.configuration = { ...configuration, websocketProvider: { webSocket: fake.socket } };
    }
    destroy() {
      fake.order.push('destroy');
    }
    connect() {}
    disconnect() {}
    on() {}
  },
}));
vi.mock('../MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} })) }));
// The synced collab editor, which only the check-in tests reach.
vi.mock('../LiveMarkdownEditor.js', () => ({ LiveMarkdownEditor: forwardRef<unknown, { collab?: { text: string; }; }>(({ collab }, _ref) => createElement('textarea', { 'aria-label': 'Live note content', value: collab?.text ?? '', readOnly: true, onChange: () => {} })) }));

const builtin = { kind: 'builtin' as const };
const frameEditor = { origin: 'https://live.example.test', messageType: 'live-status', themeParam: 'theme' };
const note: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'Alpha', tags: [], metadata: { title: 'Alpha', status: 'inbox' }, content: '# Alpha\n', revision: 'r1' };
const liveState = { since: '2026-11-16T01:00:00.000Z', activeEditors: 1, editorUrl: 'http://localhost/notebooks/notes~life/a.md' };
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: liveState.editorUrl, since: liveState.since, activeEditors: 1, conflict: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const checkedIn = { id: 'abc', path: 'notes/life/a.md', committed: true, commit: 'c'.repeat(40), released: true, revision: 'r2' };

let fetchMock: ReturnType<typeof vi.fn>;
let checkInAnswer: Response | (() => Response);
let phone = false;
let online = true;
beforeEach(() => {
  localStorage.clear();
  fake.order.length = 0;
  fake.socket = null;
  phone = false;
  online = true;
  checkInAnswer = () => json(checkedIn);
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  fetchMock = vi.fn(async (url: string) => {
    fake.order.push(url);
    if (url === '/api/live/checkout') return json({ checkout: view, outcome: 'created' });
    if (url === '/api/live/socket-ticket') return json({ ticket: 't'.padEnd(32, 'x'), document: 'abc.1' });
    if (url === '/api/live/checkin') return typeof checkInAnswer === 'function' ? checkInAnswer() : checkInAnswer;
    return json({ error: 'unexpected' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  cleanup();
  // Typing a test left unsynced would be taken up by the next test's editor of the same note.
  const { unsyncedLiveStore } = await import('../../lib/live-unsynced.js');
  for (const entry of await unsyncedLiveStore().list()) await unsyncedLiveStore().delete(entry.key);
  forgetCheckedIn(noteRefKey(note));
  takeLiveEditRequest(noteRefKey(note));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const calls = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url);
const live = (overrides: Partial<LiveNoteEditing> = {}): LiveNoteEditing => ({ editor: builtin, onRefetch: vi.fn(), ...overrides });
const noteEditor = (props: Partial<NoteEditorProps>, deleteNote?: (note: NoteItem) => void) => createElement(PhoneNotesProvider, { value: { back: () => {}, changesCount: 0, deleteNote } }, createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: ['inbox', 'done'], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, onCommitFile: async () => {}, branch: 'main', draftScope: 'src:main', onClose: () => {}, ...props } as NoteEditorProps)));
const mount = async (props: Partial<NoteEditorProps>, deleteNote?: (note: NoteItem) => void) => {
  const view = render(noteEditor(props, deleteNote));
  await act(async () => {});
  return view;
};
const collabShown = () => document.querySelector('.live-toolbar-badge');

describe('a writer’s note of a repository with the built-in editor', () => {
  it('opens in zoom straight into the collab editor, with no Edit', async () => {
    await mount({ live: live() });
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(calls('/api/live/checkout')[0]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(calls('/api/live/socket-ticket')).toHaveLength(1);
    expect(collabShown()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByLabelText('Note content')).toBeNull();
  });

  it('opens in a Focus pane straight into the collab editor, without opening zoom', async () => {
    const openZoom = vi.fn();
    await mount({ frame: 'pane', onClose: undefined, live: live({ openZoom }) });
    expect(openZoom).not.toHaveBeenCalled();
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(collabShown()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('opens on the phone’s note screen straight into the collab editor', async () => {
    phone = true;
    const openZoom = vi.fn();
    await mount({ frame: 'pane', onClose: undefined, live: live({ openZoom }) });
    expect(openZoom).not.toHaveBeenCalled();
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(collabShown()).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Note' })).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps the collab editor when zoom hands the note back to its pane', async () => {
    const { rerender } = await mount({ live: live() });
    rerender(noteEditor({ frame: 'pane', onClose: undefined, live: live() }));
    await act(async () => {});
    expect(collabShown()).toBeInTheDocument();
    expect(calls('/api/live/checkout')).toHaveLength(1);
  });

  it('keeps 編輯 in a compilation section, where it opens zoom', async () => {
    const openZoom = vi.fn();
    await mount({ frame: 'inline', onClose: undefined, live: live({ openZoom }) });
    expect(calls('/api/live/checkout')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(openZoom).toHaveBeenCalledTimes(1);
    cleanup();
    takeLiveEditRequest(noteRefKey(note));
  });

  it('says 已簽回 and offers Edit, without checking out again, in an editor mounted just after this page checked it in', async () => {
    markCheckedIn([noteRefKey(note)]);
    await mount({ frame: 'pane', onClose: undefined, live: live({ openZoom: vi.fn() }) });
    expect(calls('/api/live/checkout')).toHaveLength(0);
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    });
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(collabShown()).toBeInTheDocument();
  });

  it('opens offline in the direct editor on a browser draft, with the offline bar, and checks out once back online with nothing typed', async () => {
    online = false;
    await mount({ live: live() });
    expect(calls('/api/live/checkout')).toHaveLength(0);
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    expect(screen.getByText('Offline: changes are kept on this device and merged in once you are back online.')).toBeInTheDocument();
    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(collabShown()).toBeInTheDocument();
  });

  it('back online with a draft typed offline, hands the draft over to the live note first, then opens the collab editor', async () => {
    online = false;
    const order: string[] = [];
    const handOver = vi.fn(async () => {
      order.push('handOver');
      return true;
    });
    fetchMock.mockImplementation(async (url: string) => {
      order.push(url);
      if (url === '/api/live/checkout') return json({ checkout: view, outcome: 'joined' });
      if (url === '/api/live/socket-ticket') return json({ ticket: 't'.padEnd(32, 'x'), document: 'abc.1' });
      return json({ error: 'unexpected' }, 500);
    });
    await mount({ live: live({ handOver }), isDirty: true });
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {});
    expect(order.slice(0, 2)).toEqual(['handOver', '/api/live/checkout']);
    expect(collabShown()).toBeInTheDocument();
  });

  it('holds the direct editor read-only while its draft is handed over, so that it writes nothing over the draft meanwhile', async () => {
    online = false;
    let finish: (handed: boolean) => void = () => {};
    const handOver = vi.fn(() => new Promise<boolean>(resolve => void (finish = resolve)));
    await mount({ live: live({ handOver }), isDirty: true });
    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(handOver).toHaveBeenCalled();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    await act(async () => finish(true));
    await act(async () => {});
    expect(collabShown()).toBeInTheDocument();
  });

  it('stays in the direct editor on its draft when the handover could not finish', async () => {
    online = false;
    const handOver = vi.fn(async () => false);
    await mount({ live: live({ handOver }), isDirty: true });
    online = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(handOver).toHaveBeenCalled();
    expect(calls('/api/live/checkout')).toHaveLength(0);
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
  });

  it('says a merge that conflicted kept the person’s version as a draft, and offers to compare, copy or discard it', async () => {
    const discard = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount({ note: { ...note, content: '# Alpha\nTheirs.\n' }, live: live({ mergeConflict: { mine: '# Alpha\nMine.\n', discard } }) });
    expect(collabShown()).toBeInTheDocument();
    expect(screen.getByText('Your offline changes conflict with changes made since, so they were kept as a draft. Compare, copy or discard them.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(screen.getByLabelText('Your version against the note')).toHaveTextContent('+Mine.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy my version' }));
    });
    expect(writeText).toHaveBeenCalledWith('# Alpha\nMine.\n');
    fireEvent.click(screen.getByRole('button', { name: 'Discard my version' }));
    expect(discard).toHaveBeenCalled();
  });

  // cf16-F002: typing in the direct editor would be written over the conflict draft, the note's one draft slot.
  it('holds the direct editor read-only offline while the note has a conflict draft, and says to deal with it first', async () => {
    online = false;
    await mount({ live: live({ mergeConflict: { mine: '# Alpha\nMine.\n', discard: vi.fn() } }) });
    expect(calls('/api/live/checkout')).toHaveLength(0);
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    expect(screen.getByText(/Deal with the conflict draft first/)).toBeInTheDocument();
  });

  it('opens in the direct editor the same way when the checkout cannot reach the server', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/live/checkout') throw new TypeError('Failed to fetch');
      return json({ error: 'unexpected' }, 500);
    });
    await mount({ frame: 'pane', onClose: undefined, live: live() });
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    expect(screen.getByText('Offline: changes are kept on this device and merged in once you are back online.')).toBeInTheDocument();
  });

  // cf16-F007: a request can fail while the browser counts itself online (a weak signal, a captive portal), and no `online` follows.
  it('leaves the direct editor once a later checkout gets through, without any online event: retried on a timer and when the page shows again', async () => {
    let reachable = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (!reachable) throw new TypeError('Failed to fetch');
      if (url === '/api/live/checkout') return json({ checkout: view, outcome: 'joined' });
      if (url === '/api/live/socket-ticket') return json({ ticket: 't'.padEnd(32, 'x'), document: 'abc.1' });
      return json({ error: 'unexpected' }, 500);
    });
    vi.useFakeTimers();
    try {
      await mount({ live: live() });
      expect(screen.getByText('Offline: changes are kept on this device and merged in once you are back online.')).toBeInTheDocument();
      expect(calls('/api/live/checkout')).toHaveLength(1);
      // Still out of reach: the next try fails too, and the editor stays.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(calls('/api/live/checkout')).toHaveLength(2);
      expect(collabShown()).toBeNull();
      reachable = true;
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(calls('/api/live/checkout')).toHaveLength(3);
      expect(collabShown()).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a reader the read view, and a framed editor keeps Edit as in 0.19', async () => {
    await mount({ readOnly: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    cleanup();
    await mount({ live: live({ editor: frameEditor }) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

/** Opens the note editor's "⋯" menu, as a keyboard does. */
const openMenu = async () => {
  const trigger = screen.getByRole('button', { name: 'More actions' });
  trigger.focus();
  await act(async () => {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  });
};
const pick = async (name: string) => {
  await openMenu();
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name }));
  });
  await act(async () => {});
};

describe('moving, renaming or deleting a note one has open in the collab editor', () => {
  // A move or rename records where the note goes (docs/specs/2026-11-15-builtin-live-editor §20.4): the editor stays open
  // and nothing is checked in here; the server checks the note in at once when nobody else is editing it.
  it('Rename keeps the collab editor open, checks nothing in, and opens the rename at once', async () => {
    const rename = vi.fn();
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { rename } }) });
    expect(collabShown()).toBeInTheDocument();
    await pick('Rename');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename.mock.calls[0]![0]).toBeUndefined();
    expect(calls('/api/live/checkin')).toHaveLength(0);
    expect(fake.order).not.toContain('destroy');
    expect(collabShown()).toBeInTheDocument();
  });

  it('checks the note in from Check in now only once the editor’s socket has closed', async () => {
    const socket = Object.assign(new EventTarget(), { readyState: 1 });
    fake.socket = socket;
    await mount({ note: { ...note, live: liveState }, live: live() });
    act(() => {
      fake.config!.document.getText('content').insert(0, '# Alpha\n');
      fake.config!.onStatus?.({ status: 'connected' });
      fake.config!.onSynced?.({ state: true });
    });
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Check in now' })));
    expect(fake.order).toContain('destroy');
    expect(calls('/api/live/checkin')).toHaveLength(0);
    socket.readyState = 3;
    await act(async () => void socket.dispatchEvent(new Event('close')));
    await act(async () => {});
    expect(calls('/api/live/checkin')).toHaveLength(1);
  });

  it('Move opens the folder picker at once while others edit, and the collab editor stays', async () => {
    const move = vi.fn();
    await mount({ note: { ...note, live: { ...liveState, activeEditors: 3 } }, live: live({ fileActions: { move } }), onMove: vi.fn() });
    await pick('Move note');
    expect(move).toHaveBeenCalledTimes(1);
    expect(calls('/api/live/checkin')).toHaveLength(0);
    expect(screen.queryByText(/cannot be moved now/)).toBeNull();
    expect(collabShown()).toBeInTheDocument();
  });

  it('still refuses a deletion while someone else is editing, says how many, and goes back to the collab editor', async () => {
    phone = true;
    const remove = vi.fn(async () => {});
    checkInAnswer = () => json({ id: 'abc', path: 'notes/life/a.md', committed: true, commit: 'c'.repeat(40), released: false, reason: 'active', activeEditors: 2, revision: 'r2' });
    await mount({ frame: 'pane', onClose: undefined, note: { ...note, live: liveState }, live: live({ fileActions: { remove } }) }, vi.fn());
    fireEvent.click(within(screen.getByRole('group', { name: 'Note' })).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Click again to confirm deletion' }));
    });
    await act(async () => {});
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByText('2 people are editing this note, so it cannot be deleted now.')).toBeInTheDocument();
  });

  // cf16-F003: the editor's own typing would be left out of the commit and kept under the old path.
  it('moves and renames while the editor holds typing the server has not stored: the live note follows, and the typing lands there', async () => {
    const rename = vi.fn(), move = vi.fn();
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { rename, move } }), onMove: vi.fn() });
    act(() => fake.config!.onDirty?.({ dirty: true }));
    await pick('Rename');
    await pick('Move note');
    expect([rename, move].map(action => action.mock.calls.length)).toEqual([1, 1]);
    expect(calls('/api/live/checkin')).toHaveLength(0);
    expect(fake.order).not.toContain('destroy');
    expect(collabShown()).toBeInTheDocument();
  });

  it('deletes at once a note that is no longer live', async () => {
    phone = true;
    const remove = vi.fn(async () => {});
    checkInAnswer = () => json({ error: 'Not live.', code: 'not-live' }, 409);
    await mount({ frame: 'pane', onClose: undefined, note: { ...note, live: liveState }, live: live({ fileActions: { remove } }) }, vi.fn());
    fireEvent.click(within(screen.getByRole('group', { name: 'Note' })).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Click again to confirm deletion' }));
    });
    await act(async () => {});
    expect(remove).toHaveBeenCalledWith(undefined);
  });

  it('deletes from the phone’s sheet after the check-in, with the revision it answered', async () => {
    phone = true;
    const remove = vi.fn(async () => {});
    await mount({ frame: 'pane', onClose: undefined, note: { ...note, live: liveState }, live: live({ fileActions: { remove } }) }, vi.fn());
    fireEvent.click(within(screen.getByRole('group', { name: 'Note' })).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Click again to confirm deletion' }));
    });
    await act(async () => {});
    expect(calls('/api/live/checkin')).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('r2');
  });
});

// Another person moved or renamed the note this editor has open (§20.4): the page follows it there, and the person goes on
// typing in the same editor, whose session, caret and focus stay.
describe('a note one has open in the collab editor, followed to where it moved', () => {
  const MOVED = 'notes/life/archive/alpha.md';

  it('keeps the collab editor and the focus in it: no new checkout or session, and its next ticket asks where the note lies now', async () => {
    const pane = { frame: 'pane' as const, onClose: undefined, live: live() };
    const view = await mount({ ...pane, note: { ...note, live: liveState } });
    act(() => {
      fake.config!.document.getText('content').insert(0, '# Alpha\n');
      fake.config!.onStatus?.({ status: 'connected' });
      fake.config!.onSynced?.({ state: true });
    });
    const typing = screen.getByLabelText('Live note content');
    act(() => typing.focus());
    view.rerender(noteEditor({ ...pane, note: { ...note, id: MOVED, path: MOVED, live: liveState } }));
    await act(async () => {});
    expect(screen.getByLabelText('Live note content')).toBe(typing);
    expect(document.activeElement).toBe(typing);
    expect(calls('/api/live/checkout')).toHaveLength(1);
    expect(fake.order).not.toContain('destroy');
    // The connect it holds a ticket for is the first; the next, a reconnect, asks for one where the note lies now.
    await act(async () => void await fake.config!.token!());
    await act(async () => void await fake.config!.token!());
    expect(calls('/api/live/socket-ticket').at(-1)![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: MOVED }) }));
  });
});

describe('the 編輯中 badge', () => {
  it('shows only while someone is in the note or its text differs from Git, so a note only viewed does not read as edited', () => {
    const { rerender } = render(createElement(LiveBadge, { live: { ...liveState, activeEditors: 0 } }));
    expect(screen.queryByText(/Editing/)).toBeNull();
    rerender(createElement(LiveBadge, { live: { ...liveState, activeEditors: 0, changed: true } }));
    expect(screen.getByText('Editing')).toBeInTheDocument();
    rerender(createElement(LiveBadge, { live: { ...liveState, activeEditors: 2 } }));
    expect(screen.getByText('Editing · 2')).toBeInTheDocument();
  });
});

describe('a note open in the collab editor while this browser still holds an older draft of it', () => {
  // The draft was staged before the note went live, and a read of the note once failed: the stored draft says so.
  const stale: NoteItem = { ...note, title: 'Weekly', metadata: { title: 'Weekly', status: 'inbox' }, content: '# Weekly\n\nOld agenda.\n' };
  const older = (staleDraft: NonNullable<LiveNoteEditing['staleDraft']>) => ({ note: stale, remoteBase: note, isDirty: true, draftMode: true, conflictReason: 'editor.remoteNoteMovedOrDeleted', onReadRemote: async () => note, onMarkConflict: vi.fn(), live: live({ staleDraft }) });

  it('shows none of the direct editor’s notices, and one notice that offers the draft to download or discard', async () => {
    const discard = vi.fn();
    await mount(older({ text: '---\ntitle: Weekly\n---\n# Weekly\n\nOld agenda.\n', savedAt: new Date(2026, 10, 24, 17).getTime(), differs: true, discard }));
    expect(collabShown()).toBeInTheDocument();
    expect(screen.queryByText(/moved or deleted|deleted remotely|local changes are preserved|conflict/i)).toBeNull();
    const notices = document.querySelectorAll('.editor-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('This note has an older draft from 11/24 in this browser.');
    expect(within(notices[0] as HTMLElement).getAllByRole('button').map(button => button.textContent)).toEqual(['Download', 'Discard']);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(discard).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledOnce();
  });

  it('drops, without asking, a draft that holds nothing but the note it was made from', async () => {
    const discard = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    await mount(older({ text: '# Alpha\n', differs: false, discard }));
    expect(discard).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText(/older draft/)).toBeNull();
  });
});
