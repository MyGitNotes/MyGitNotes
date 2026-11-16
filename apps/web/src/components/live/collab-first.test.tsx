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
 * 編輯; moving, renaming or deleting it from its own editor checks it in first.
 */

const fake = vi.hoisted(() => ({ order: [] as string[], config: null as null | { onDirty?: (event: { dirty: boolean; }) => void; } }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    constructor(configuration: { onDirty?: (event: { dirty: boolean; }) => void; }) {
      fake.config = configuration;
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
const collabShown = () => screen.queryByRole('toolbar', { name: 'Live editor' });

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

  it('keeps 編輯 in a graph card and a compilation section, where it opens zoom', async () => {
    for (const frame of ['compact', 'inline'] as const) {
      const openZoom = vi.fn();
      await mount({ frame, onClose: undefined, live: live({ openZoom }) });
      expect(calls('/api/live/checkout')).toHaveLength(0);
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(openZoom).toHaveBeenCalledTimes(1);
      cleanup();
      takeLiveEditRequest(noteRefKey(note));
    }
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

  it('opens in the direct editor the same way when the checkout cannot reach the server', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/live/checkout') throw new TypeError('Failed to fetch');
      return json({ error: 'unexpected' }, 500);
    });
    await mount({ frame: 'pane', onClose: undefined, live: live() });
    expect(screen.getByLabelText('Note content')).not.toHaveAttribute('readonly');
    expect(screen.getByText('Offline: changes are kept on this device and merged in once you are back online.')).toBeInTheDocument();
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
  it('Rename leaves the collab editor, checks the note in, and then opens the rename with the revision the check-in answered', async () => {
    const rename = vi.fn();
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { rename } }) });
    expect(collabShown()).toBeInTheDocument();
    await pick('Rename');
    expect(fake.order.indexOf('destroy')).toBeGreaterThan(-1);
    expect(fake.order.indexOf('destroy')).toBeLessThan(fake.order.indexOf('/api/live/checkin'));
    expect(calls('/api/live/checkin')[0]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(rename).toHaveBeenCalledWith('r2');
    expect(collabShown()).toBeNull();
  });

  it('Move does the same, and opens the folder picker once the note is released', async () => {
    const move = vi.fn();
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { move } }), onMove: vi.fn() });
    await pick('Move note');
    expect(calls('/api/live/checkin')).toHaveLength(1);
    expect(move).toHaveBeenCalledWith('r2');
  });

  it('refuses while someone else is editing, says how many, and goes back to the collab editor', async () => {
    const move = vi.fn();
    checkInAnswer = () => json({ id: 'abc', path: 'notes/life/a.md', committed: true, commit: 'c'.repeat(40), released: false, reason: 'active', activeEditors: 2, revision: 'r2' });
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { move } }), onMove: vi.fn() });
    await pick('Move note');
    expect(move).not.toHaveBeenCalled();
    expect(screen.getByText('2 people are editing this note, so it cannot be moved now.')).toBeInTheDocument();
    expect(calls('/api/live/checkout')).toHaveLength(2);
    expect(collabShown()).toBeInTheDocument();
  });

  it('keeps saying so in the editor the check-in’s workspace refresh mounts, when the check-in committed the text before it was refused', async () => {
    const move = vi.fn(), onCheckedIn = vi.fn();
    checkInAnswer = () => json({ id: 'abc', path: 'notes/life/a.md', committed: true, commit: 'c'.repeat(40), released: false, reason: 'active', activeEditors: 1, revision: 'r2' });
    const props = { note: { ...note, live: liveState }, live: live({ fileActions: { move }, onCheckedIn }), onMove: vi.fn() };
    await mount(props);
    await pick('Move note');
    expect(onCheckedIn).toHaveBeenCalledWith(expect.objectContaining({ committed: true, released: false }));
    cleanup();
    await mount(props);
    expect(screen.getByText('1 other person is editing this note, so it cannot be moved now.')).toBeInTheDocument();
    expect(collabShown()).toBeInTheDocument();
    expect(move).not.toHaveBeenCalled();
  });

  // cf16-F003: the editor's own typing would be left out of the commit and kept under the old path.
  it('refuses while the editor holds typing the server has not stored, says why, and keeps the editor open', async () => {
    const rename = vi.fn(), move = vi.fn();
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { rename, move } }), onMove: vi.fn() });
    expect(collabShown()).toBeInTheDocument();
    act(() => fake.config!.onDirty?.({ dirty: true }));
    await pick('Rename');
    await pick('Move note');
    expect([rename, move].map(action => action.mock.calls.length)).toEqual([0, 0]);
    expect(calls('/api/live/checkin')).toHaveLength(0);
    expect(fake.order).not.toContain('destroy');
    expect(screen.getByText('Some changes are not saved yet. Wait until the editor says Saved, then move, rename or delete the note.')).toBeInTheDocument();
    expect(collabShown()).toBeInTheDocument();
  });

  it('acts at once on a note that is no longer live', async () => {
    const rename = vi.fn();
    checkInAnswer = () => json({ error: 'Not live.', code: 'not-live' }, 409);
    await mount({ note: { ...note, live: liveState }, live: live({ fileActions: { rename } }) });
    await pick('Rename');
    expect(rename).toHaveBeenCalledWith(undefined);
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
