// @vitest-environment jsdom
import { createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import * as Y from 'yjs';
import type { LiveCheckoutView } from '../../lib/live-api.js';

/*
 * The built-in live editor's tab (docs/specs/2026-11-15-builtin-live-editor §8.2, slice N5) over a fake provider: the
 * provider is the one seam to the socket, so each test drives its events by hand and reads what the tab asked of it.
 */

interface FakeConfig {
  name: string;
  url: string;
  document: Y.Doc;
  awareness: import('y-protocols/awareness').Awareness;
  token: () => Promise<string>;
  onStatus?: (event: { status: string; }) => void;
  onSynced?: (event: { state: boolean; }) => void;
  onUnsyncedChanges?: (event: { number: number; }) => void;
  onDirty?: (event: { dirty: boolean; }) => void;
  onAwarenessChange?: (event: { states: { clientId: number; user?: { name?: string; }; }[]; }) => void;
  onStateless?: (event: { payload: string; }) => void;
  onAuthenticationFailed?: (event: { reason: string; }) => void;
  onAuthenticated?: (event: { scope: string; }) => void;
  onClose?: (event: { event: { code: number; reason: string; }; }) => void;
}
const fake = vi.hoisted(() => ({ providers: [] as { configuration: FakeConfig; destroyed: boolean; destroy: () => void; }[], order: [] as string[] }));
/** Lets the bar's 已儲存 settle: it shows only once nothing was unsaved for a moment. */
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 350)));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    configuration: FakeConfig;
    destroyed = false;
    constructor(configuration: FakeConfig) {
      this.configuration = configuration;
      fake.providers.push(this);
    }
    destroy() {
      this.destroyed = true;
      fake.order.push('destroy');
    }
    connect() {
      fake.order.push('connect');
    }
    disconnect() {
      fake.order.push('disconnect');
    }
    on() {}
  },
}));
vi.mock('../LiveMarkdownEditor.js', () => ({ LiveMarkdownEditor: forwardRef<unknown, { collab?: { text: string; }; content?: string; readOnly: boolean; }>(({ collab, content, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Live note content', value: collab?.text ?? content ?? '', readOnly, onChange: () => {} })) }));

const { LiveCollabEditor } = await import('./LiveCollabEditor.js');
const { unsyncedLiveStore } = await import('../../lib/live-unsynced.js');
type Props = Parameters<typeof LiveCollabEditor>[0];

const checkout: LiveCheckoutView = { id: 'live-1', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/notebooks/notes~life/a.md', since: '2026-11-15T01:00:00.000Z', activeEditors: 1, conflict: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ticket = (n: number, document = 'live-1.1') => json({ ticket: `t${n}`.padEnd(32, 'x'), document });

let fetchMock: ReturnType<typeof vi.fn>;
let tickets: number;
beforeEach(() => {
  fake.providers.length = 0;
  fake.order.length = 0;
  tickets = 0;
  fetchMock = vi.fn(async (url: string) => {
    fake.order.push(url);
    if (url === '/api/live/socket-ticket') return ticket(++tickets);
    return json({ id: 'live-1', path: checkout.path, committed: true, commit: 'c'.repeat(40), released: true, revision: 'c'.repeat(40) });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  // Typing a test left unsynced would be restored into the next test's document of the same note.
  const store = unsyncedLiveStore();
  for (const entry of await store.list()) await store.delete(entry.key);
});

const props = (overrides: Partial<Props> = {}): Props => ({ checkout, editor: { kind: 'builtin' }, onRefetch: vi.fn(), onClose: vi.fn(), onCheckedIn: vi.fn(), ...overrides });
const provider = () => fake.providers[fake.providers.length - 1];
const emit = (fn: (config: FakeConfig) => void) => act(() => fn(provider().configuration));
/** Mounts the tab and lets its first ticket arrive, which creates the provider. */
const open = async (overrides: Partial<Props> = {}) => {
  const view = render(createElement(LiveCollabEditor, props(overrides)));
  await act(async () => {});
  return view;
};
/** The provider connects and syncs a document holding `text`. */
const sync = (text = '# A\n') =>
  emit(config => {
    config.document.getText('content').insert(0, text);
    config.onStatus?.({ status: 'connected' });
    config.onSynced?.({ state: true });
  });
const checkInButton = () => screen.getByRole('button', { name: 'Check in now' });

describe('opening', () => {
  it('asks for a ticket, opens the ticket’s document over the app’s own socket, and mounts the editor only once synced', async () => {
    await open();
    expect(fetchMock).toHaveBeenCalledWith('/api/live/socket-ticket', expect.objectContaining({ method: 'POST', body: JSON.stringify({ notebookId: 'notes~life', path: 'notes/life/a.md' }) }));
    expect(provider().configuration.name).toBe('live-1.1');
    expect(provider().configuration.url).toBe(`ws://${location.host}/live/socket`);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Live note content')).toBeNull();
    // The first connect uses the ticket the tab already holds; every reconnect asks for a fresh one.
    await expect(provider().configuration.token()).resolves.toBe('t1'.padEnd(32, 'x'));
    await expect(provider().configuration.token()).resolves.toBe('t2'.padEnd(32, 'x'));
    sync('# A\nhello\n');
    expect(screen.getByLabelText('Live note content')).toHaveValue('# A\nhello\n');
  });
});

describe('the bar', () => {
  it('says saved, unsaved and offline from the provider, and counts the people in awareness by name', async () => {
    await open();
    sync();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(checkInButton()).toBeEnabled();
    emit(config => {
      config.onUnsyncedChanges?.({ number: 2 });
      config.onDirty?.({ dirty: true });
    });
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    emit(config => {
      config.onUnsyncedChanges?.({ number: 0 });
      config.onDirty?.({ dirty: false });
    });
    await settle();
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    emit(config => config.onStatus?.({ status: 'connected' }));
    // Connected again, the tab is saved only once its document synced again.
    emit(config => config.onSynced?.({ state: true }));
    expect(checkInButton()).toBeEnabled();
    expect(screen.getByText('1 editing')).toBeInTheDocument();
    emit(config => config.onAwarenessChange?.({ states: [{ clientId: config.document.clientID }, { clientId: 2, user: { name: 'Bo' } }, { clientId: 3, user: { name: 'Bo' } }, { clientId: 4, user: { name: 'Cy' } }] }));
    expect(screen.getByText('3 editing')).toBeInTheDocument();
    // No 「在新分頁開啟」: the note is edited here.
    expect(screen.queryByRole('link', { name: 'Open in a new tab' })).toBeNull();
  });

  it('announces the tab in awareness on every connect, so the others count it before it moves a cursor', async () => {
    await open();
    const { awareness, document } = provider().configuration;
    // A state at the clock the server last saw is dropped: the first state's clock is 0, a reconnect's is the one before.
    const clock = () => awareness.meta.get(document.clientID)?.clock ?? 0;
    const before = clock();
    emit(config => config.onAuthenticated?.({ scope: 'read-write' }));
    expect(clock()).toBeGreaterThan(before);
    expect(awareness.getLocalState()).not.toBeNull();
    const again = clock();
    emit(config => config.onAuthenticated?.({ scope: 'read-write' }));
    expect(clock()).toBeGreaterThan(again);
  });

  it('says 已儲存 only once nothing was unsaved for a moment, so typing does not flicker it or 立即簽回', async () => {
    await open();
    sync();
    emit(config => {
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
    });
    emit(config => {
      config.onUnsyncedChanges?.({ number: 0 });
      config.onDirty?.({ dirty: false });
    });
    expect(screen.queryByText('Saved')).toBeNull();
    expect(checkInButton()).toBeDisabled();
    await settle();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(checkInButton()).toBeEnabled();
  });

  it('never says 已儲存 while it reconnects: offline until the socket is back, connecting until the document synced again', async () => {
    await open();
    sync();
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    emit(config => config.onStatus?.({ status: 'connecting' }));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    emit(config => config.onStatus?.({ status: 'connected' }));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    emit(config => config.onSynced?.({ state: true }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('does not flash 未儲存 on a reconnect with nothing typed, and never says 已儲存 before the connect is acknowledged', async () => {
    vi.useFakeTimers();
    try {
      await open();
      sync();
      await act(async () => vi.advanceTimersByTimeAsync(400));
      expect(screen.getByText('Saved')).toBeInTheDocument();
      emit(config => config.onStatus?.({ status: 'disconnected' }));
      emit(config => {
        config.onStatus?.({ status: 'connected' });
        config.onSynced?.({ state: true });
        // The connect's own sync step, which the server has not acknowledged yet: no typing.
        config.onUnsyncedChanges?.({ number: 1 });
      });
      expect(screen.queryByText('Not saved')).toBeNull();
      expect(screen.queryByText('Saved')).toBeNull();
      emit(config => config.onUnsyncedChanges?.({ number: 0 }));
      expect(screen.queryByText('Not saved')).toBeNull();
      expect(screen.queryByText('Saved')).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(400));
      expect(screen.getByText('Saved')).toBeInTheDocument();
      // A step the server leaves unacknowledged says 未儲存 once it lasts.
      emit(config => config.onUnsyncedChanges?.({ number: 1 }));
      expect(screen.queryByText('Not saved')).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getByText('Not saved')).toBeInTheDocument();
      // Typing says 未儲存 at once.
      emit(config => config.onUnsyncedChanges?.({ number: 0 }));
      await act(async () => vi.advanceTimersByTimeAsync(400));
      emit(config => {
        config.onUnsyncedChanges?.({ number: 1 });
        config.onDirty?.({ dirty: true });
      });
      expect(screen.getByText('Not saved')).toBeInTheDocument();
      emit(config => {
        config.onUnsyncedChanges?.({ number: 0 });
        config.onDirty?.({ dirty: false });
      });
      expect(screen.getByText('Not saved')).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(400));
      expect(screen.getByText('Saved')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes offline the moment the browser does, and reconnects the moment it is back', async () => {
    await open();
    sync();
    fake.order.length = 0;
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    expect(fake.order).toEqual(['disconnect']);
    // The provider reports its socket closed, as it does once the close lands.
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    act(() => void window.dispatchEvent(new Event('online')));
    expect(fake.order).toEqual(['disconnect', 'connect']);
  });

  it('warns before the page is left while changes are not saved', async () => {
    await open();
    sync();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    emit(config => {
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
    });
    expect(leave()).toBe(true);
  });

  it('warns before the page is left with text typed offline, which the provider counts as unsaved', async () => {
    await open();
    sync();
    act(() => void window.dispatchEvent(new Event('offline')));
    emit(config => {
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
    });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('立即簽回', () => {
  it('destroys the provider before it posts the check-in, then takes the checked-in path', async () => {
    const onCheckedIn = vi.fn();
    await open({ onCheckedIn });
    sync();
    await act(async () => {
      fireEvent.click(checkInButton());
    });
    expect(fake.order.slice(-2)).toEqual(['destroy', '/api/live/checkin']);
    expect(onCheckedIn).toHaveBeenCalledWith(expect.objectContaining({ released: true }));
  });

  it('opens a new session when the note stayed open and the person goes back to the editor', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ id: 'live-1', path: checkout.path, committed: true, released: false, reason: 'active', activeEditors: 2, revision: 'c'.repeat(40) }));
    await open();
    sync();
    await act(async () => {
      fireEvent.click(checkInButton());
    });
    expect(screen.getByText(/2 people are still editing/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    expect(fake.providers).toHaveLength(2);
    expect(fake.providers[1].destroyed).toBe(false);
  });

  // cf16-F008, cf16-F009: not tonight but once people left; and what to do when no credential may commit.
  it('says why the note stayed open, uncommittable included, in the app’s words', async () => {
    fetchMock.mockImplementation(async (url: string) => (url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ id: 'live-1', path: checkout.path, committed: false, released: false, reason: 'uncommittable', revision: 'c'.repeat(40) })));
    await open();
    sync();
    await settle();
    await act(async () => {
      fireEvent.click(checkInButton());
    });
    expect(screen.getByRole('status')).toHaveTextContent('Not checked in yet: none of its editors can write to the repository; sign in again, or ask someone with write access to check it in.');
    expect(screen.getByRole('status')).not.toHaveTextContent('tonight');
  });

  it('says an empty draft was discarded', async () => {
    const onDiscarded = vi.fn();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ id: 'live-1', path: null, committed: false, released: true, discarded: true, reason: 'empty', revision: 'c'.repeat(40) }));
    await open({ checkout: { ...checkout, path: 'notes/life/.live/live-1.md', pending: true }, onDiscarded });
    sync();
    await act(async () => {
      fireEvent.click(checkInButton());
    });
    expect(screen.getByRole('status')).toHaveTextContent('The draft was empty and was discarded');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDiscarded).toHaveBeenCalled();
  });
});

describe('a released note', () => {
  it('with nothing unsaved, takes the checked-in path', async () => {
    const onCheckedIn = vi.fn(), onRefetch = vi.fn();
    await open({ onCheckedIn, onRefetch });
    sync();
    emit(config => config.onStateless?.({ payload: JSON.stringify({ type: 'released' }) }));
    expect(provider().destroyed).toBe(true);
    expect(onCheckedIn).toHaveBeenCalledWith();
    expect(onRefetch).toHaveBeenCalled();
  });

  it('with unsaved changes and a live editor that cannot merge, offers the tab’s text to copy or download, and never keeps the old document', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      fake.order.push(url);
      if (url === '/api/live/socket-ticket') return ticket(++tickets);
      return json({ error: "This repository's live editor cannot merge a text into a live note.", code: 'not-live' }, 400);
    });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const createObjectURL = vi.fn(() => 'blob:mine');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const onCheckedIn = vi.fn(), onReleased = vi.fn();
    await open({ onCheckedIn, onReleased, title: 'Alpha' });
    sync('# A\n');
    emit(config => {
      config.document.getText('content').insert(4, 'offline typing\n');
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
      config.onStatus?.({ status: 'disconnected' });
    });
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    expect(fake.providers[0].destroyed).toBe(true);
    expect(fake.order).toContain('/api/live/merge');
    expect(screen.getByRole('alert')).toHaveTextContent('This note was checked in; the changes you made offline were not saved.');
    expect(onCheckedIn).not.toHaveBeenCalled();
    // The note is no longer live: the lists read its live state again now, not only once the notice is left.
    expect(onReleased).toHaveBeenCalledOnce();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy my version' }));
    });
    expect(writeText).toHaveBeenCalledWith('# A\noffline typing\n');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onCheckedIn).toHaveBeenCalledWith();
  });

  it('when the first ticket answers 409 not-live', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'The note is not open in the live editor.', code: 'not-live' }, 409));
    const onCheckedIn = vi.fn();
    await open({ onCheckedIn });
    expect(fake.providers).toHaveLength(0);
    expect(onCheckedIn).toHaveBeenCalledWith();
  });

  it('when a reconnect’s ticket answers 409 not-live, or names another epoch’s document', async () => {
    for (const answer of [json({ error: 'Not live.', code: 'not-live' }, 409), ticket(9, 'live-1.2')]) {
      const onCheckedIn = vi.fn();
      const view = await open({ onCheckedIn });
      sync();
      await provider().configuration.token();
      fetchMock.mockImplementationOnce(async () => answer);
      await act(async () => {
        await provider().configuration.token().catch(() => '');
      });
      expect(provider().destroyed).toBe(true);
      expect(onCheckedIn).toHaveBeenCalledWith();
      view.unmount();
    }
  });
});

/** The tab typed `typed` after its first sync, and the server has not acknowledged it. */
const typeUnsaved = (typed: string) =>
  emit(config => {
    config.document.getText('content').insert(config.document.getText('content').length, typed);
    config.onUnsyncedChanges?.({ number: 1 });
    config.onDirty?.({ dirty: true });
  });
/** Copy my version puts `text` on the clipboard, and Download saves a file. */
const offersMine = async (text: string) => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mine'), revokeObjectURL: vi.fn() });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy my version' }));
  });
  expect(writeText).toHaveBeenCalledWith(text);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  expect(click).toHaveBeenCalled();
  click.mockRestore();
};

describe('a refusal from the server', () => {
  it('reads a reason it does not know as a failure, not as busy', async () => {
    for (const reason of ['invalid', 'something-new', undefined]) {
      const view = await open();
      sync();
      emit(config => config.onStateless?.({ payload: JSON.stringify({ type: 'refused', reason }) }));
      expect(provider().destroyed).toBe(true);
      expect(screen.getByRole('alert')).toHaveTextContent('The live editor refused the connection');
      expect(screen.getByRole('alert')).not.toHaveTextContent('busy');
      view.unmount();
    }
  });

  it('with unsaved changes, says why and offers the tab’s text to copy or download, whatever the reason', async () => {
    for (const [reason, text] of [['too-large', 'over the live editor’s size limit'], ['busy', 'The live editor is busy'], ['invalid', 'The live editor refused the connection'], ['something-new', 'The live editor refused the connection']] as const) {
      const onClose = vi.fn(), onCheckedIn = vi.fn();
      const view = await open({ onClose, onCheckedIn });
      sync('# A\n');
      typeUnsaved(`typed before ${reason}\n`);
      emit(config => config.onStateless?.({ payload: JSON.stringify({ type: 'refused', reason }) }));
      expect(provider().destroyed).toBe(true);
      expect(screen.getByRole('alert'), reason).toHaveTextContent(text);
      expect(screen.getByRole('alert'), reason).toHaveTextContent('were not saved');
      await offersMine(`# A\ntyped before ${reason}\n`);
      // The note was not checked in: closing leaves the editor as 「關閉」 does.
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect([onClose.mock.calls.length, onCheckedIn.mock.calls.length], reason).toEqual([1, 0]);
      view.unmount();
    }
  });

  it('reads too-large and busy, and leaves the editor', async () => {
    for (const [reason, text] of [['too-large', 'over the live editor’s size limit'], ['busy', 'The live editor is busy']] as const) {
      const view = await open();
      sync();
      emit(config => config.onStateless?.({ payload: JSON.stringify({ type: 'refused', reason }) }));
      expect(provider().destroyed).toBe(true);
      expect(screen.getByRole('alert')).toHaveTextContent(text);
      expect(screen.queryByLabelText('Live note content')).toBeNull();
      view.unmount();
    }
  });
});

describe('a reconnect whose ticket fails', () => {
  const failTickets = () => fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? json({ error: 'The server is restarting.' }, 503) : json({}));
  /** The provider connects again: its ticket request fails, and it reports the authentication failed. */
  const reconnect = async () => {
    await act(async () => {
      await expect(provider().configuration.token()).rejects.toThrow('The server is restarting.');
      provider().configuration.onAuthenticationFailed?.({ reason: 'Failed to get token' });
    });
  };

  it('with nothing unsaved, says so and offers to go back to the editor', async () => {
    await open();
    sync();
    await provider().configuration.token();
    failTickets();
    await reconnect();
    expect(provider().destroyed).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('The server is restarting.');
    expect(screen.queryByRole('button', { name: 'Copy my version' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to the editor' })).toBeInTheDocument();
  });

  it('with unsaved changes, offers the tab’s text to copy or download before going back to the editor', async () => {
    await open();
    sync('# A\n');
    await provider().configuration.token();
    typeUnsaved('typed during the restart\n');
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    failTickets();
    await reconnect();
    expect(provider().destroyed).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('The server is restarting.');
    expect(screen.getByRole('alert')).toHaveTextContent('were not saved');
    await offersMine('# A\ntyped during the restart\n');
    // Back to the editor starts a new session, from the server's text.
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({}));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    expect(fake.providers).toHaveLength(2);
    expect(provider().destroyed).toBe(false);
  });
});

describe('a socket the server closed for a new ticket (4000)', () => {
  /** The server closed the socket after its time: the provider reports it gone, then the close, in one task. */
  const renew = () =>
    emit(config => {
      config.onStatus?.({ status: 'disconnected' });
      config.onClose?.({ event: { code: 4000, reason: 'Live ticket renewal' } });
    });

  it('reconnects with a fresh ticket without saying offline or showing an error', async () => {
    await open();
    sync();
    await provider().configuration.token();
    typeUnsaved('typed across the renewal\n');
    renew();
    expect(screen.queryByText('Offline')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    emit(config => config.onStatus?.({ status: 'connecting' }));
    expect(screen.queryByText('Offline')).toBeNull();
    await expect(provider().configuration.token()).resolves.toBe('t2'.padEnd(32, 'x'));
    emit(config => {
      config.onStatus?.({ status: 'connected' });
      config.onSynced?.({ state: true });
      config.onUnsyncedChanges?.({ number: 0 });
      config.onDirty?.({ dirty: false });
    });
    await settle();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(fake.providers).toHaveLength(1);
    expect(provider().destroyed).toBe(false);
    // A socket that then drops for any other reason is offline again.
    emit(config => {
      config.onStatus?.({ status: 'disconnected' });
      config.onClose?.({ event: { code: 1006, reason: '' } });
    });
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('says offline once a retry after it fails too', async () => {
    await open();
    sync();
    renew();
    emit(config => config.onClose?.({ event: { code: 1006, reason: '' } }));
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('ends in the failed ending, offering unsaved text, when the session ended and the new ticket is refused', async () => {
    await open();
    sync('# A\n');
    await provider().configuration.token();
    typeUnsaved('typed before signing out\n');
    renew();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? json({ error: 'Sign in to edit.' }, 403) : json({}));
    await act(async () => {
      await expect(provider().configuration.token()).rejects.toThrow('Sign in to edit.');
      provider().configuration.onAuthenticationFailed?.({ reason: 'Failed to get token' });
    });
    expect(provider().destroyed).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to edit.');
    expect(screen.getByRole('alert')).toHaveTextContent('were not saved');
    await offersMine('# A\ntyped before signing out\n');
  });
});

describe('捨棄草稿', () => {
  const pending = { ...checkout, path: 'notes/life/.live/live-1.md', pending: true };
  it('is offered on a pending note only where the editor can discard', async () => {
    await open({ checkout: pending });
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
    cleanup();
    await open({ checkout, editor: { kind: 'builtin', discard: true } });
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
    cleanup();
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true } });
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  });

  it('closes the editor first and discards an untyped draft at once', async () => {
    const onDiscarded = vi.fn();
    fetchMock.mockImplementation(async (url: string) => {
      fake.order.push(url);
      return url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ discarded: true });
    });
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true }, onDiscarded });
    sync();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(fake.order.slice(-2)).toEqual(['destroy', '/api/live/discard']);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: pending.path }) }));
    expect(onDiscarded).toHaveBeenCalled();
  });

  it('asks in the editor, not with the browser’s confirm, before discarding a typed draft, and reposts with confirm', async () => {
    const onDiscarded = vi.fn();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    let discards = 0;
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : ++discards === 1 ? json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409) : json({ discarded: true }));
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true }, onDiscarded });
    sync();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('Discard this draft? Its text will not be saved to Git.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: pending.path, confirm: true }) }));
    expect(onDiscarded).toHaveBeenCalled();
  });

  it('goes back to the editor when the person keeps a typed draft', async () => {
    const onDiscarded = vi.fn();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409));
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true }, onDiscarded });
    sync();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(fake.providers).toHaveLength(2);
    expect(provider().destroyed).toBe(false);
  });
});

describe('an ending the person chooses while typing is unsaved', () => {
  const pending = { ...checkout, path: 'notes/life/.live/live-1.md', pending: true };
  /** The tab syncs `# A\n`, then types offline: one change the server never acknowledged. */
  const typeOffline = () =>
    emit(config => {
      config.document.getText('content').insert(4, 'offline typing\n');
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
      config.onStatus?.({ status: 'disconnected' });
    });
  /** The tab, still connected, types a change the server has not acknowledged yet. */
  const typeUnacked = () =>
    emit(config => {
      config.document.getText('content').insert(4, 'offline typing\n');
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
    });
  const clipboard = () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    return writeText;
  };

  it('「關閉」 asks in the editor first, offers the text to copy or download, and going back keeps the session', async () => {
    const writeText = clipboard();
    const onClose = vi.fn();
    await open({ onClose });
    sync('# A\n');
    typeOffline();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(provider().destroyed).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Your latest changes are not saved yet; copy or download your version before you close.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy my version' }));
    });
    expect(writeText).toHaveBeenCalledWith('# A\noffline typing\n');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fake.providers).toHaveLength(1);
    expect(provider().destroyed).toBe(false);
    expect(screen.getByLabelText('Live note content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    expect(provider().destroyed).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('「關閉」 with nothing unsaved closes at once', async () => {
    const onClose = vi.fn();
    await open({ onClose });
    sync('# A\n');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(provider().destroyed).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('「捨棄草稿」 answered 返回編輯 offers the unsaved text before the editor reopens from the server’s', async () => {
    const writeText = clipboard();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409));
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true } });
    sync('# A\n');
    typeUnacked();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    expect(fake.providers).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Your latest changes were not saved; copy or download your version.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy my version' }));
    });
    expect(writeText).toHaveBeenCalledWith('# A\noffline typing\n');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    expect(fake.providers).toHaveLength(2);
  });

  it('「捨棄草稿」 is disabled, with its reason, while the tab is offline or its document not synced', async () => {
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true } });
    const discardButton = () => screen.getByRole('button', { name: 'Discard draft' });
    expect(discardButton()).toBeDisabled();
    sync('# A\n');
    expect(discardButton()).toBeEnabled();
    typeOffline();
    expect(discardButton()).toBeDisabled();
    expect(discardButton()).toHaveAttribute('title', 'Discarding the draft needs the connection to the server; it is possible again once the editor is back online.');
    // Nothing typed is left behind for the next test's editor of the same note to offer.
    emit(config => config.onDirty?.({ dirty: false }));
  });

  it('a 「捨棄草稿」 that cannot reach the server says so in the app’s words, and 回到編輯器 goes back to the editor at once', async () => {
    clipboard();
    const network = { up: true };
    fetchMock.mockImplementation(async (url: string) => {
      if (!network.up) throw new TypeError('Failed to fetch');
      return url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ discarded: true });
    });
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true } });
    sync('# A\n');
    typeUnacked();
    network.up = false;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('The server could not be reached, so the draft was not discarded; try again once you are back online.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Failed to fetch');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Back to the editor' }));
    });
    // Still offline: the editor waits for the connection instead of ending again with the browser's words.
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    const providers = fake.providers.length;
    network.up = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(fake.providers).toHaveLength(providers + 1);
  });

  it('leaving the note inside the app keeps the unsaved text, which the note’s editor syncs when it opens it again on the same document', async () => {
    const view = await open();
    sync('# A\n');
    typeOffline();
    view.unmount();
    expect(provider().destroyed).toBe(true);
    await open();
    expect(screen.queryByRole('alert')).toBeNull();
    // The kept typing is in the document before the provider connects: Yjs sync sends the server what it lacks.
    expect(provider().configuration.document.getText('content').toString()).toBe('# A\noffline typing\n');
  });
});

/*
 * BG-F003: a connect counts its own sync step as unsynced until the server acknowledged it. That is no typing: the
 * endings, 關閉 and leaving the note offer or ask about unsaved text only when the tab typed some.
 */
describe('a connect with nothing typed', () => {
  /** The socket opened and sent its step 2, which the server has not acknowledged yet. */
  const midConnect = () => emit(config => config.onUnsyncedChanges?.({ number: 1 }));

  it('ends without offering unsaved text when the new ticket is refused mid-connect', async () => {
    await open();
    sync('# A\n');
    await provider().configuration.token();
    midConnect();
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? json({ error: 'Sign in to edit.' }, 403) : json({}));
    await act(async () => {
      await expect(provider().configuration.token()).rejects.toThrow('Sign in to edit.');
      provider().configuration.onAuthenticationFailed?.({ reason: 'Failed to get token' });
    });
    expect(provider().destroyed).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in to edit.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('were not saved');
  });

  it('「關閉」 closes at once, and leaving the note keeps nothing to offer', async () => {
    const onClose = vi.fn();
    const view = await open({ onClose });
    sync('# A\n');
    midConnect();
    // Still truthful: not saved until the step 2 is acknowledged, though nothing typed says 未儲存 only once it lasts.
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.queryByText('Not saved')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    await open();
    sync('# A\n');
    midConnect();
    cleanup();
    await open();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/*
 * Offline handover, live → offline (docs/specs/2026-11-16-collab-first-self-host A3.1): typing the server has not
 * stored is kept in the browser, synced again on the same document, and merged into the note when its document ended.
 */
describe('typing the server has not stored', () => {
  /** The tab syncs `# A\n`, then types offline. */
  const typeOffline = (typed = 'offline typing\n') =>
    emit(config => {
      config.document.getText('content').insert(4, typed);
      config.onUnsyncedChanges?.({ number: 1 });
      config.onDirty?.({ dirty: true });
      config.onStatus?.({ status: 'disconnected' });
    });
  /** The server: tickets name `documents` in turn (the last one after), and a merge answers `merge`. */
  const server = ({ documents = ['live-1.1'], merge = () => json({ applied: true, contentHash: 'h'.repeat(64), checkout: { ...checkout, since: '2026-11-16T02:00:00.000Z' }, outcome: 'reopened' }), first }: { documents?: string[]; merge?: () => Response; first?: () => Response; } = {}) => {
    let asked = 0;
    fetchMock.mockImplementation(async (url: string) => {
      fake.order.push(url);
      if (url === '/api/live/socket-ticket') {
        if (first && asked === 0) {
          asked++;
          return first();
        }
        return ticket(++tickets, documents[Math.min(asked++, documents.length - 1)]);
      }
      if (url === '/api/live/merge') return merge();
      return json({ id: 'live-1', path: checkout.path, committed: true, released: true, revision: 'c'.repeat(40) });
    });
  };
  const mergeBody = () => JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === '/api/live/merge')![1].body));

  it('connects again once the socket’s close lands, when the browser was back online before it', async () => {
    await open();
    sync();
    act(() => void window.dispatchEvent(new Event('offline')));
    // Back online before the socket's close event: the provider still counts itself connected, and a connect now does nothing.
    act(() => void window.dispatchEvent(new Event('online')));
    fake.order.push('closed');
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    expect(fake.order.slice(fake.order.indexOf('closed'))).toContain('connect');
  });

  it('is merged into the note with no copy or download when the note was checked in meanwhile, and the editor opens on its new document', async () => {
    const onMergeConflict = vi.fn(), onReleased = vi.fn();
    server({ documents: ['live-1.1', 'live-1.2'] });
    await open({ onMergeConflict, onReleased });
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    expect(mergeBody()).toEqual({ notebookId: 'notes~life', path: 'notes/life/a.md', base: '# A\n', text: '# A\noffline typing\n', mergeId: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/), typedIn: { document: 'live-1.1', update: expect.any(String) } });
    // The tab's whole document goes with it: the server takes as base what the ended document held, so typing it stored lands once (cf16-F001).
    const typed = new Y.Doc();
    Y.applyUpdate(typed, Uint8Array.from(atob(mergeBody().typedIn.update), char => char.charCodeAt(0)));
    expect(typed.getText('content').toString()).toBe('# A\noffline typing\n');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onMergeConflict).not.toHaveBeenCalled();
    expect(fake.providers).toHaveLength(2);
    expect(fake.providers[0].destroyed).toBe(true);
    expect(provider().configuration.name).toBe('live-1.2');
    // The merged text arrives with the new document: the old one is never merged across epochs.
    expect(provider().configuration.document.getText('content').toString()).toBe('');
  });

  // cf16-F002: a note has one conflict draft, which waits for the person; a second conflict never takes its place.
  it('offers a conflicting merge to copy or download, and keeps it, when the note already has a conflict draft', async () => {
    const onMergeConflict = vi.fn(() => false);
    server({ documents: ['live-1.1', 'live-1.2'], merge: () => json({ error: 'The text changed the same lines as the live note did since. Nothing was merged.', code: 'merge-conflict', checkout }, 409) });
    await open({ onMergeConflict });
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    expect(onMergeConflict).toHaveBeenCalledWith('# A\noffline typing\n');
    expect(screen.getByRole('alert')).toHaveTextContent('An earlier conflict draft of this note is waiting');
    expect(screen.getByRole('button', { name: 'Copy my version' })).toBeInTheDocument();
    expect((await unsyncedLiveStore().list()).map(entry => entry.text)).toEqual(['# A\noffline typing\n']);
  });

  // cfx-F004: without a handler to stage it, a conflicting merge is not staged anywhere, so the typing is kept, never deleted as if saved.
  it('keeps a conflicting merge, and offers it to copy or download, when nothing stages conflict drafts', async () => {
    server({ documents: ['live-1.1', 'live-1.2'], merge: () => json({ error: 'The text changed the same lines as the live note did since. Nothing was merged.', code: 'merge-conflict', checkout }, 409) });
    await open();
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Copy my version' })).toBeInTheDocument();
    expect((await unsyncedLiveStore().list()).map(entry => entry.text)).toEqual(['# A\noffline typing\n']);
  });

  it('takes the text of its first sync as the merge base, also when that sync waited on the connect’s own step', async () => {
    server({ documents: ['live-1.1', 'live-1.2'] });
    await open();
    emit(config => {
      config.document.getText('content').insert(0, '# A\n');
      config.onStatus?.({ status: 'connected' });
      // The connect's own step 2 is counted before the document synced, and its acknowledgement never comes.
      config.onUnsyncedChanges?.({ number: 1 });
      config.onSynced?.({ state: true });
    });
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    expect(mergeBody()).toMatchObject({ base: '# A\n', text: '# A\noffline typing\n' });
  });

  it('keeps a conflicting merge as a conflict draft and opens the editor on the current note', async () => {
    const onMergeConflict = vi.fn(() => true);
    server({ documents: ['live-1.1', 'live-1.2'], merge: () => json({ error: 'The text changed the same lines as the live note did since. Nothing was merged.', code: 'merge-conflict', checkout }, 409) });
    await open({ onMergeConflict });
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    expect(onMergeConflict).toHaveBeenCalledWith('# A\noffline typing\n');
    expect(screen.queryByRole('button', { name: 'Copy my version' })).toBeNull();
    expect(provider().configuration.name).toBe('live-1.2');
  });

  // S6 (c) at e3ceb70b: the release remounts the editor while the merge is under way; its answer must still be acted on.
  it('keeps a conflicting merge as a conflict draft, and lets the typing go, when the editor closed while the merge was under way', async () => {
    const onMergeConflict = vi.fn(() => true);
    let answer: (response: Response) => void = () => {};
    server({ documents: ['live-1.1', 'live-1.2'], merge: () => new Promise<Response>(resolve => void (answer = resolve)) as never });
    const view = await open({ onMergeConflict });
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    view.unmount();
    await act(async () => answer(json({ error: 'The text changed the same lines as the live note did since. Nothing was merged.', code: 'merge-conflict', checkout }, 409)));
    await act(async () => {});
    expect(onMergeConflict).toHaveBeenCalledWith('# A\noffline typing\n');
    expect(await unsyncedLiveStore().list()).toEqual([]);
  });

  it('lets typing it merged go when the editor closed while the merge was under way', async () => {
    let answer: (response: Response) => void = () => {};
    server({ documents: ['live-1.1', 'live-1.2'], merge: () => new Promise<Response>(resolve => void (answer = resolve)) as never });
    const view = await open();
    sync('# A\n');
    typeOffline();
    await act(async () => {
      provider().configuration.onStateless?.({ payload: JSON.stringify({ type: 'released' }) });
    });
    await act(async () => {});
    view.unmount();
    await act(async () => answer(json({ applied: true, contentHash: 'h'.repeat(64), checkout, outcome: 'reopened' })));
    await act(async () => {});
    expect(await unsyncedLiveStore().list()).toEqual([]);
  });

  it('after a reload, is synced again on the same document, and merged when the note was checked in meanwhile', async () => {
    const view = await open();
    sync('# A\n');
    typeOffline();
    // The page goes away with the typing unsynced; its editor opens again on a later load.
    view.unmount();
    server({ first: () => json({ error: 'The note is not open in the live editor.', code: 'not-live' }, 409), documents: ['live-1.2'] });
    await open();
    await act(async () => {});
    expect(mergeBody()).toEqual(expect.objectContaining({ base: '# A\n', text: '# A\noffline typing\n' }));
    expect(provider().configuration.name).toBe('live-1.2');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('after a reload with the server out of reach, shows the kept text read-only and offline, and syncs it once back online', async () => {
    const view = await open();
    sync('# A\n');
    typeOffline();
    view.unmount();
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const providers = fake.providers.length;
    await open();
    expect(fake.providers).toHaveLength(providers);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByLabelText('Live note content')).toHaveValue('# A\noffline typing\n');
    expect(screen.getByLabelText('Live note content')).toHaveAttribute('readonly');
    server();
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(fake.providers).toHaveLength(providers + 1);
    expect(provider().configuration.document.getText('content').toString()).toBe('# A\noffline typing\n');
  });

  /*
   * cf16-F004: every editor of a note (two tabs, or zoom over its Focus pane) keeps its own entry, and a session never
   * merges the entry of an editor that is still open.
   */
  it('keeps the typing of two editors of one note apart, and merges both once the note was checked in meanwhile', async () => {
    const first = await open();
    const one = provider();
    sync('# A\n');
    typeOffline('from one\n');
    const second = await open();
    sync('# A\n');
    typeOffline('from two\n');
    expect(one).not.toBe(provider());
    first.unmount();
    second.unmount();
    const kept = await unsyncedLiveStore().list();
    expect(kept.map(entry => entry.text).sort()).toEqual(['# A\nfrom one\n', '# A\nfrom two\n']);
    server({ first: () => json({ error: 'The note is not open in the live editor.', code: 'not-live' }, 409), documents: ['live-1.2'] });
    await open();
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/merge')).toHaveLength(2));
    const texts = fetchMock.mock.calls.filter(([url]) => url === '/api/live/merge').map(([, init]) => JSON.parse(String((init as RequestInit).body)).text);
    expect(texts.sort()).toEqual(['# A\nfrom one\n', '# A\nfrom two\n']);
    await vi.waitFor(async () => expect(await unsyncedLiveStore().list()).toEqual([]));
  });

  it('never merges the typing an editor still open keeps, though the note was checked in meanwhile', async () => {
    await open();
    sync('# A\n');
    typeOffline('still open\n');
    await act(() => new Promise(resolve => setTimeout(resolve, 600)));
    server({ first: () => json({ error: 'The note is not open in the live editor.', code: 'not-live' }, 409), documents: ['live-1.2'] });
    await open();
    await act(async () => {});
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/merge')).toEqual([]);
    expect((await unsyncedLiveStore().list()).map(entry => entry.text)).toEqual(['# A\nstill open\n']);
  });

  it('is forgotten once the server stored it', async () => {
    const view = await open();
    sync('# A\n');
    typeOffline();
    emit(config => {
      config.onStatus?.({ status: 'connected' });
      config.onSynced?.({ state: true });
      config.onUnsyncedChanges?.({ number: 0 });
      config.onDirty?.({ dirty: false });
    });
    view.unmount();
    await open();
    expect(provider().configuration.document.getText('content').toString()).toBe('');
  });
});

describe('split mode', () => {
  it('shows the live text in a source editor beside its preview', async () => {
    await open({ mode: 'split', body: '# Shared heading\n' });
    emit(config => {
      config.document.getText('content').insert(0, '---\ntitle: A\n---\n\n# Shared heading\n');
      config.onStatus?.({ status: 'connected' });
      config.onSynced?.({ state: true });
    });
    expect((await screen.findByRole('textbox', { name: 'Live note source' })).textContent).toContain('title: A');
    expect(screen.getByRole('heading', { name: 'Shared heading' })).toBeInTheDocument();
  });
});
