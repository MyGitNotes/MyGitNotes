// @vitest-environment jsdom
import { createElement, forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type * as Y from 'yjs';
import type { LiveCheckoutView } from '../../lib/live-api.js';

/*
 * The built-in live editor's tab (docs/specs/2026-11-15-builtin-live-editor §8.2, slice N5) over a fake provider: the
 * provider is the one seam to the socket, so each test drives its events by hand and reads what the tab asked of it.
 */

interface FakeConfig {
  name: string;
  url: string;
  document: Y.Doc;
  awareness: { clientID: number; };
  token: () => Promise<string>;
  onStatus?: (event: { status: string; }) => void;
  onSynced?: (event: { state: boolean; }) => void;
  onUnsyncedChanges?: (event: { number: number; }) => void;
  onAwarenessChange?: (event: { states: { clientId: number; user?: { name?: string; }; }[]; }) => void;
  onStateless?: (event: { payload: string; }) => void;
  onAuthenticationFailed?: (event: { reason: string; }) => void;
}
const fake = vi.hoisted(() => ({ providers: [] as { configuration: FakeConfig; destroyed: boolean; destroy: () => void; }[], order: [] as string[] }));
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
  },
}));
vi.mock('../LiveMarkdownEditor.js', () => ({ LiveMarkdownEditor: forwardRef<unknown, { collab?: { text: string; }; readOnly: boolean; }>(({ collab, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Live note content', value: collab?.text ?? '', readOnly, onChange: () => {} })) }));

const { LiveCollabEditor } = await import('./LiveCollabEditor.js');
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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    emit(config => config.onUnsyncedChanges?.({ number: 2 }));
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    emit(config => config.onUnsyncedChanges?.({ number: 0 }));
    emit(config => config.onStatus?.({ status: 'disconnected' }));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(checkInButton()).toBeDisabled();
    emit(config => config.onStatus?.({ status: 'connected' }));
    expect(checkInButton()).toBeEnabled();
    expect(screen.getByText('1 editing')).toBeInTheDocument();
    emit(config => config.onAwarenessChange?.({ states: [{ clientId: config.document.clientID }, { clientId: 2, user: { name: 'Bo' } }, { clientId: 3, user: { name: 'Bo' } }, { clientId: 4, user: { name: 'Cy' } }] }));
    expect(screen.getByText('3 editing')).toBeInTheDocument();
    // No 「在新分頁開啟」: the note is edited here.
    expect(screen.queryByRole('link', { name: 'Open in a new tab' })).toBeNull();
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
    emit(config => config.onUnsyncedChanges?.({ number: 1 }));
    expect(leave()).toBe(true);
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

  it('with unsaved changes, offers the tab’s text to copy or download, and never keeps the old document', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const createObjectURL = vi.fn(() => 'blob:mine');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const onCheckedIn = vi.fn();
    await open({ onCheckedIn, title: 'Alpha' });
    sync('# A\n');
    emit(config => {
      config.document.getText('content').insert(4, 'offline typing\n');
      config.onUnsyncedChanges?.({ number: 1 });
      config.onStatus?.({ status: 'disconnected' });
    });
    emit(config => config.onStateless?.({ payload: JSON.stringify({ type: 'released' }) }));
    expect(provider().destroyed).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('This note was checked in; the changes you made offline were not saved.');
    expect(onCheckedIn).not.toHaveBeenCalled();
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

describe('a refusal from the server', () => {
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

  it('asks before discarding a typed draft, and reposts with confirm', async () => {
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
    expect(confirm).toHaveBeenCalledWith('Discard this draft? Its text will not be saved to Git.');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/discard', expect.objectContaining({ body: JSON.stringify({ notebookId: 'notes~life', path: pending.path, confirm: true }) }));
    expect(onDiscarded).toHaveBeenCalled();
  });

  it('goes back to the editor when the person keeps a typed draft', async () => {
    const onDiscarded = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => false));
    fetchMock.mockImplementation(async (url: string) => url === '/api/live/socket-ticket' ? ticket(++tickets) : json({ error: 'Someone typed in this draft.', code: 'has-edits' }, 409));
    await open({ checkout: pending, editor: { kind: 'builtin', discard: true }, onDiscarded });
    sync();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    });
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(fake.providers).toHaveLength(2);
    expect(provider().destroyed).toBe(false);
  });
});
