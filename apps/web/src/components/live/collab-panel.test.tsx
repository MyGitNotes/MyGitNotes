// @vitest-environment jsdom
import { createElement, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type * as Y from 'yjs';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { PanelProvider } from '../../lib/panel-context.js';
import { PhoneNotesProvider } from '../../lib/phone-notes.js';
import type { NoteItem } from '../../lib/types.js';
import { forgetCheckedIn, type LiveNoteEditing, takeLiveEditRequest } from '../../lib/live-api.js';
import { NoteEditor, type NoteEditorProps } from '../NoteEditor.js';

/*
 * The document panel and the note row of a note in the collab editor (docs/specs/2026-11-16-collab-frontmatter): every
 * panel tab works, reading and writing the live text, and the row follows it.
 */

interface FakeConfig {
  document: Y.Doc;
  onStatus?: (event: { status: string; }) => void;
  onSynced?: (event: { state: boolean; }) => void;
}
const fake = vi.hoisted(() => ({ providers: [] as { configuration: FakeConfig; }[], handle: { goToLine: [] as number[], reveal: [] as [number, number][] } }));
vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: class {
    configuration: FakeConfig;
    constructor(configuration: FakeConfig) {
      this.configuration = configuration;
      fake.providers.push(this);
    }
    destroy() {}
    connect() {}
    disconnect() {}
    on() {}
  },
}));
vi.mock('../MarkdownEditor.js', () => ({ MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, _ref) => createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} })) }));
vi.mock('../LiveMarkdownEditor.js', () => ({
  LiveMarkdownEditor: forwardRef<unknown, { collab?: { text: string; }; content?: string; }>(({ collab, content }, ref) => {
    useImperativeHandle(ref, () => ({ goToLine: (line: number) => fake.handle.goToLine.push(line), revealRange: (from: number, to: number) => fake.handle.reveal.push([from, to]), getCurrentLine: () => 1, getSelection: () => null, ready: () => true, focus: () => {}, insert: () => {}, insertBlock: () => {}, format: () => {}, outline: () => {} }));
    return createElement('textarea', { 'aria-label': 'Live note content', value: collab?.text ?? content ?? '', readOnly: true, onChange: () => {} });
  }),
}));

const TEXT = '---\n# kept\ntitle: Alpha\nstatus: inbox\ntags: [one]\n---\n\n# Alpha\n\n## Second\nneedle\n';
const note: NoteItem = { id: 'a', path: 'notes/life/a.md', notebookId: 'notes~life', title: 'Alpha', tags: ['old'], metadata: { title: 'Alpha', status: 'inbox', tags: ['old'] }, content: '# Alpha\n', revision: 'r1' };
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/x', since: '2026-11-16T01:00:00.000Z', activeEditors: 1, conflict: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pending = false;
beforeEach(() => {
  pending = false;
  localStorage.clear();
  fake.providers.length = 0;
  fake.handle.goToLine.length = 0;
  fake.handle.reveal.length = 0;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/live/checkout') return json({ checkout: { ...view, pending }, outcome: 'created' });
    if (url === '/api/live/checkin') return json({ id: 'abc', path: view.path, committed: true, commit: 'c'.repeat(40), released: true, revision: 'r2' });
    if (url === '/api/live/socket-ticket') return json({ ticket: 't'.padEnd(32, 'x'), document: 'abc.1' });
    return json({ error: 'unexpected' }, 500);
  }));
});
afterEach(async () => {
  cleanup();
  const { unsyncedLiveStore } = await import('../../lib/live-unsynced.js');
  for (const entry of await unsyncedLiveStore().list()) await unsyncedLiveStore().delete(entry.key);
  forgetCheckedIn(noteRefKey(note));
  takeLiveEditRequest(noteRefKey(note));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const live = (overrides: Partial<LiveNoteEditing> = {}): LiveNoteEditing => ({ editor: { kind: 'builtin' }, onRefetch: vi.fn(), ...overrides });
const tree = (props: Partial<NoteEditorProps>) => createElement(PhoneNotesProvider, { value: { back: () => {}, changesCount: 0 } }, createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: ['inbox', 'done'], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, onCommitFile: async () => {}, branch: 'main', draftScope: 'src:main', onClose: () => {}, live: live(), ...props } as NoteEditorProps)));
const text = () => fake.providers[fake.providers.length - 1]!.configuration.document.getText('content');
/** Mounts the note, then syncs its live document with `seed`, connected. */
const open = async (props: Partial<NoteEditorProps> = {}, seed = TEXT) => {
  const result = render(tree(props));
  await act(async () => {});
  const config = fake.providers[fake.providers.length - 1]!.configuration;
  act(() => {
    config.document.getText('content').insert(0, seed);
    config.onStatus?.({ status: 'connected' });
    config.onSynced?.({ state: true });
  });
  return result;
};
const row = () => screen.getByRole('group', { name: 'Note properties' });
const openTab = (name: string) => fireEvent.click(within(screen.getByRole('tablist', { name: 'Document tools' })).getByRole('tab', { name }));
const panel = () => screen.getByRole('complementary', { name: 'Document tools' });

describe('a note in the collab editor', () => {
  it('shows the document panel beside the collab editor in zoom, with every tab', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    for (const tab of ['Find in note', 'Outline', 'Frontmatter', 'View settings']) expect(within(panel()).getByRole('tab', { name: tab })).toBeInTheDocument();
  });

  it('reads the row and the frontmatter form from the live text, following each change', async () => {
    await open();
    expect(within(row()).getByText('one')).toBeInTheDocument();
    expect(within(row()).queryByText('old')).toBeNull();
    act(() => text().insert(TEXT.indexOf(']'), ', two'));
    expect(within(row()).getByText('two')).toBeInTheDocument();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    expect(within(panel()).getByText('two')).toBeInTheDocument();
  });

  it('writes a status change from the form into the live text, changing only that key', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Hide note' }));
    expect(text().toString()).toBe(TEXT.replace('tags: [one]\n', 'tags: [one]\nhiden: true\n'));
  });

  it('lists the outline from the live body and goes to a heading at its file line', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    openTab('Outline');
    const second = within(panel()).getByRole('button', { name: /Second/ });
    // `## Second` is file line 10.
    expect(second).toHaveTextContent('10');
    fireEvent.click(second);
    expect(fake.handle.goToLine).toContain(10);
  });

  it('finds in the live body and reveals the match at its place in the whole text', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    openTab('Find in note');
    fireEvent.change(within(panel()).getByRole('searchbox', { name: 'Find in note' }), { target: { value: 'needle' } });
    await act(async () => {});
    expect(fake.handle.reveal).toContainEqual([TEXT.indexOf('needle'), TEXT.indexOf('needle') + 6]);
  });

  it('disables metadata edits while offline', async () => {
    await open();
    act(() => fake.providers[0]!.configuration.onStatus?.({ status: 'disconnected' }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    expect(within(panel()).getByRole('checkbox', { name: 'Hide note' })).toBeDisabled();
  });

  it('says the frontmatter cannot be read and disables the form while it does not parse', async () => {
    await open({}, '---\ntitle: [Alpha\n---\nBody\n');
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    expect(within(panel()).getByText(/cannot be read/i)).toBeInTheDocument();
    expect(within(panel()).getByRole('checkbox', { name: 'Hide note' })).toBeDisabled();
  });

  it('renders the panel into a Focus pane’s rail', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    await open({ frame: 'pane', onClose: undefined, documentPanel: { target, mode: 'frontmatter', onChange: () => {} } });
    expect(within(target).getByRole('checkbox', { name: 'Hide note' })).toBeInTheDocument();
    target.remove();
  });

  it('writes `title:` for a pending note', async () => {
    pending = true;
    await open({ onRename: vi.fn() });
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    const title = within(panel()).getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Beta' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(text().toString()).toBe(TEXT.replace('title: Alpha', 'title: Beta'));
  });

  it('runs the check-in-first rename for a filed note', async () => {
    const rename = vi.fn();
    await open({ live: live({ fileActions: { rename } }), onRename: vi.fn() });
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    const title = within(panel()).getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Beta' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await act(async () => {});
    await act(async () => {});
    expect(rename).toHaveBeenCalledWith('r2', 'Beta');
  });
});
