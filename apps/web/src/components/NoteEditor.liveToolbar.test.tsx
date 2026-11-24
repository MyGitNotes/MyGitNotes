// @vitest-environment jsdom
import { forwardRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { unsyncedLiveStore } from '../lib/live-unsynced.js';
import type { LiveCheckoutView } from '../lib/live-api.js';
import { NoteEditingProvider, useNoteEditorRegistry } from '../lib/note-editing.js';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';
import { stubModalDialog } from './live/live-leave-test-helpers.js';

interface ProviderEvents {
  document: Y.Doc;
  onStatus: (event: { status: string; }) => void;
  onSynced: (event: { state: boolean; }) => void;
  onUnsyncedChanges: (event: { number: number; }) => void;
  onDirty: (event: { dirty: boolean; }) => void;
  onStateless: (event: { payload: string; }) => void;
}
const stub = vi.hoisted(() => ({ events: null as ProviderEvents | null }));
vi.mock('./live/live-provider.js', () => ({
  LiveProvider: class {
    configuration = { websocketProvider: undefined };
    constructor(events: ProviderEvents) {
      stub.events = events;
    }
    destroy() {}
    on() {}
  },
}));
vi.mock('./LiveMarkdownEditor.js', () => ({ LiveMarkdownEditor: forwardRef<HTMLDivElement>((_, ref) => <div ref={ref}>Live text</div>) }));
vi.mock('./MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<HTMLDivElement>((_, ref) => <div ref={ref}>Direct text</div>) }));

const note: NoteItem = { id: 'live-toolbar', path: 'notes/live-toolbar.md', notebookId: 'test', title: 'Live test', tags: [], metadata: {}, content: '# Text\n', live: { pending: true, since: '2026-11-24T00:00:00Z', activeEditors: 1, editorUrl: '' } };
const checkout: LiveCheckoutView = { ...note, pending: true, editorUrl: '', since: '2026-11-24T00:00:00Z', activeEditors: 1, conflict: null };
const fetchMock = vi.fn(async (url: string) => {
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/live/checkout') return json({ checkout, outcome: 'joined' });
  if (url === '/api/live/socket-ticket') return json({ ticket: 'x'.repeat(32), document: 'live-toolbar.1' });
  if (url === '/api/live/checkin') return json({ released: true, committed: false });
  if (url === '/api/live/discard') return json({ discarded: true });
  throw new Error(`Unexpected request ${url}`);
});
const onClose = vi.fn();
const closeTab = vi.fn();
const editing = { editor: { kind: 'builtin' as const, discard: true as const }, onRefetch: () => {} };

function Fixture({ frame, actionsSlot }: { frame: 'zoom' | 'pane'; actionsSlot?: HTMLElement; }) {
  const registry = useNoteEditorRegistry();
  const props: NoteEditorProps = { note, frame, active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'toolbar:main', live: editing, onClose: frame === 'zoom' ? onClose : undefined, actionsSlot };
  return (
    <PanelProvider>
      <NoteEditingProvider {...registry} editorProps={() => props} refreshNotes={async () => {}} closeZoom={onClose} addToFocus={() => undefined}>
        {frame === 'pane' && <button onClick={() => void registry.flushEditors(['test:notes/live-toolbar.md']).then(allowed => allowed && closeTab())}>Close Focus tab</button>}
        <NoteEditor {...props} />
      </NoteEditingProvider>
    </PanelProvider>
  );
}

let phone = false;
beforeEach(() => {
  phone = false;
  stubModalDialog();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone && query.includes('max-width: 767px'), addEventListener: () => {}, removeEventListener: () => {} }));
  stub.events = null;
  fetchMock.mockClear();
  onClose.mockClear();
  closeTab.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  const store = unsyncedLiveStore();
  for (const entry of await store.list()) await store.delete(entry.key);
});

async function open(frame: 'zoom' | 'pane' = 'zoom') {
  render(<Fixture frame={frame} />);
  await act(async () => {});
  expect(stub.events).not.toBeNull();
  act(() => {
    const events = stub.events!;
    events.onStatus({ status: 'connected' });
    events.onSynced({ state: true });
    events.onStateless({ payload: JSON.stringify({ type: 'people', count: 2 }) });
  });
}

it('puts the Live badge and check-in in the note toolbar; Mod+S invokes that button', async () => {
  await open();
  const controls = document.querySelector('.note-controls') as HTMLElement;
  expect(within(controls).getByRole('button', { name: 'Check in now' })).toBeEnabled();
  expect(controls).toHaveTextContent('Live · 2 editing · Saved');
  expect(document.querySelector('.live-editor-bar')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  await act(async () => {
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
  });
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/live/checkin')).toBe(true);
});

it('offers discard in the note’s more-actions menu', async () => {
  await open();
  expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
  expect(screen.getByRole('menuitem', { name: 'Discard draft' })).toBeInTheDocument();
});

it.each(['zoom', 'pane'] as const)('asks before leaving unsaved Live typing in %s, but not when saved', async frame => {
  await open(frame);
  const close = screen.getByRole('button', { name: frame === 'zoom' ? 'Close note' : 'Close Focus tab' });
  const left = frame === 'zoom' ? onClose : closeTab;
  act(() => {
    stub.events!.document.getText('content').insert(0, '# Typed\n');
    stub.events!.onUnsyncedChanges({ number: 1 });
    stub.events!.onDirty({ dirty: true });
  });
  await act(async () => {
    fireEvent.click(close);
  });
  expect(left).not.toHaveBeenCalled();
  const warning = screen.getByRole('alertdialog');
  expect(warning).toHaveTextContent('Your latest changes are not saved yet');
  await act(async () => {
    fireEvent.click(within(warning).getByRole('button', { name: 'Back to the editor' }));
  });
  act(() => {
    stub.events!.onUnsyncedChanges({ number: 0 });
    stub.events!.onDirty({ dirty: false });
  });
  await act(async () => {
    fireEvent.click(close);
  });
  expect(left).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/live/checkin')).toBe(false);
});

it('keeps phone check-in in the title bar and routes draft discard through the sheet', async () => {
  phone = true;
  await open();
  const bar = document.querySelector('.phone-note-bar') as HTMLElement;
  expect(within(bar).getByRole('button', { name: 'Check in now' })).toBeEnabled();
  expect(bar).toHaveTextContent('Live · 2 editing · Saved');
  fireEvent.click(within(bar).getByRole('button', { name: 'More actions' }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
  });
  expect(fetchMock.mock.calls.some(([path]) => path === '/api/live/discard')).toBe(true);
});
