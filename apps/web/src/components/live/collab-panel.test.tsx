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
// The YAML view loads its editor lazily; loaded here once, it is there before a test's 1 s wait for it runs out on a
// busy machine (a full run once timed out waiting).
import '../FileSourceEditor.js';

/*
 * The document panel and the note row of a note in the collab editor (docs/specs/2026-11-16-collab-frontmatter): every
 * panel tab works, reading and writing the live text, and the row follows it.
 */

interface FakeConfig {
  document: Y.Doc;
  onStatus?: (event: { status: string; }) => void;
  onSynced?: (event: { state: boolean; }) => void;
}
const fake = vi.hoisted(() => ({ providers: [] as { configuration: FakeConfig; }[], handle: { goToLine: [] as number[], reveal: [] as [number, number][] }, lineNumbers: [] as (boolean | undefined)[] }));
// The history section as its own tests leave it: a version's Restore hands its text to `onRestore` (NoteHistoryPanel.test).
vi.mock('../NoteHistoryPanel.js', () => ({ NoteHistoryPanel: ({ onRestore }: { onRestore?: (text: string) => void; }) => createElement('button', { type: 'button', disabled: !onRestore, onClick: () => onRestore?.('# Old\n') }, 'Restore this version') }));
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
  LiveMarkdownEditor: forwardRef<unknown, { collab?: { text: string; }; content?: string; showLineNumbers?: boolean; }>(({ collab, content, showLineNumbers }, ref) => {
    fake.lineNumbers.push(showLineNumbers);
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
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  fake.providers.length = 0;
  fake.handle.goToLine.length = 0;
  fake.handle.reveal.length = 0;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/live/checkout') return json({ checkout: { ...view, pending }, outcome: 'created' });
      if (url === '/api/live/checkin') return json({ id: 'abc', path: view.path, committed: true, commit: 'c'.repeat(40), released: true, revision: 'r2' });
      if (url === '/api/live/socket-ticket') return json({ ticket: 't'.padEnd(32, 'x'), document: 'abc.1' });
      return json({ error: 'unexpected' }, 500);
    }),
  );
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
    // The YAML view stays writable, to fix it there.
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    expect((await within(panel()).findByRole('textbox', { name: 'YAML Metadata' })).getAttribute('contenteditable')).toBe('true');
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

  // VQ P2: the row said 「無狀態」 with no tags, as if the note had none.
  it('warns in the note row, in place of its status and tags, while the frontmatter does not parse', async () => {
    await open({}, '---\ntitle: [Alpha\ntags: [one]\n---\nBody\n');
    expect(within(row()).getByText('Frontmatter cannot be read')).toBeInTheDocument();
    expect(within(row()).queryByText('No status')).toBeNull();
    expect(within(row()).queryByRole('button', { name: /status/i })).toBeNull();
  });

  it('disables every control of the form under the notice while the frontmatter does not parse', async () => {
    await open({}, '---\ntitle: [Alpha\n---\nBody\n');
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    const form = within(panel());
    for (const control of [form.getByRole('textbox', { name: 'Title' }), form.getByRole('checkbox', { name: 'Hide note' }), form.getByPlaceholderText('Add tag (e.g. project)...'), form.getByPlaceholderText('New field name...')]) expect(control).toBeDisabled();
  });

  // VQ P1-b: the browse list and its counts read the note from the server, which parses the live text.
  it('has the lists read the note again once a frontmatter change is in, and not for typing in the body', async () => {
    const onRefetch = vi.fn();
    await open({ live: live({ onRefetch }) });
    onRefetch.mockClear();
    act(() => text().insert(TEXT.indexOf(']'), ', two'));
    await act(() => new Promise(resolve => setTimeout(resolve, 700)));
    expect(onRefetch).toHaveBeenCalledTimes(1);
    act(() => text().insert(text().length, 'more body\n'));
    await act(() => new Promise(resolve => setTimeout(resolve, 700)));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  // CFR-F002: the view's text is what it opened on; a value someone else set since must not be written back.
  it('writes a YAML view edit key by key over the live text, keeping a change another person made since the view opened', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    act(() => {
      const at = text().toString().indexOf('inbox');
      text().delete(at, 'inbox'.length);
      text().insert(at, 'done');
    });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    act(() => yaml.dispatch({ changes: { from: yaml.state.doc.toString().indexOf('[one]') + 4, insert: ', two' } }));
    expect(text().toString()).toBe(TEXT.replace('inbox', 'done').replace('[one]', '[one, two]'));
  });

  it('writes a YAML view edit that changes no value, such as a comment, as written', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    act(() => yaml.dispatch({ changes: { from: 0, insert: '# added\n' } }));
    expect(text().toString()).toBe(TEXT.replace('# kept', '# added\n# kept'));
  });

  // VQ P2-1: the YAML view kept the text it opened on after a Restore took the block away, and typing there wrote every
  // key it showed back in front of the restored text.
  it('writes no key back from the YAML view that a Restore took away', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    act(() => {
      text().delete(0, text().length);
      text().insert(0, '# Old\n');
    });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    act(() => yaml.dispatch({ changes: { from: yaml.state.doc.length, insert: `${yaml.state.doc.length ? '\n' : ''}x: 1` } }));
    expect(text().toString()).toBe('---\nx: 1\n---\n\n# Old\n');
  });

  it('shows the live block in the YAML view as it changes, writing nothing back for it, comments and trailing spaces kept', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    const restored = "---\n# kept\ntitle: Alpha\nstatus: done\nodd:   'q'   # c1  \n---\n\n# Alpha\n";
    act(() => {
      text().delete(0, text().length);
      text().insert(0, restored);
    });
    const { EditorView } = await import('@codemirror/view');
    expect(EditorView.findFromDOM(source)!.state.doc.toString()).toBe("# kept\ntitle: Alpha\nstatus: done\nodd:   'q'   # c1  ");
    expect(text().toString()).toBe(restored);
  });

  it('keeps what is typed in the YAML view and does not parse yet when the block changes, then writes only its own change', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    const at = yaml.state.doc.toString().indexOf(']');
    act(() => yaml.dispatch({ changes: { from: at, to: at + 1, insert: ', tw' } }));
    act(() => {
      const status = text().toString().indexOf('inbox');
      text().delete(status, 'inbox'.length);
      text().insert(status, 'done');
    });
    expect(yaml.state.doc.toString()).toContain('status: inbox\ntags: [one, tw');
    act(() => yaml.dispatch({ changes: { from: at + 4, insert: 'o]' } }));
    expect(text().toString()).toBe(TEXT.replace('inbox', 'done').replace('[one]', '[one, two]'));
    expect(yaml.state.doc.toString()).toContain('status: done');
  });

  // VQ P2-2: a closing fence with text after it read as no frontmatter: the row said 「No status」, the form stayed
  // editable, and a status set there put a second block in front of the note.
  it('warns and locks the form while the closing fence has text after it, and the YAML view fixes it', async () => {
    const broken = '---\ntitle: Alpha\nstatus: inbox\n---x\n\n# Alpha\n';
    await open({}, broken);
    expect(within(row()).getByText('Frontmatter cannot be read')).toBeInTheDocument();
    expect(within(row()).queryByText('No status')).toBeNull();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    expect(within(panel()).getByRole('checkbox', { name: 'Hide note' })).toBeDisabled();
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    expect(yaml.state.doc.toString()).toBe('title: Alpha\nstatus: inbox');
    expect(within(panel()).getByText(/---x/)).toBeInTheDocument();
    expect(text().toString()).toBe(broken);
    // VQ P2-4: a long line ran past the panel's edge, the view scrolled sideways and cut the start of every line.
    expect(yaml.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    act(() => yaml.dispatch({ changes: { from: yaml.state.doc.length, insert: '\ntags: [one]' } }));
    expect(text().toString()).toBe('---\ntitle: Alpha\nstatus: inbox\ntags: [one]\n---\n\n# Alpha\n');
    expect(within(row()).getByText('one')).toBeInTheDocument();
  });

  // VQ P3: the list row lost 「編輯中 · 1」 after a rename: its checkout was read before this tab's socket joined, which
  // is what the server counts, and nothing read it again.
  it('has the lists read the note again once this tab has joined the live document', async () => {
    const onRefetch = vi.fn();
    render(tree({ live: live({ onRefetch }) }));
    await act(async () => {});
    const config = fake.providers[fake.providers.length - 1]!.configuration;
    const before = onRefetch.mock.calls.length;
    act(() => {
      config.document.getText('content').insert(0, TEXT);
      config.onStatus?.({ status: 'connected' });
      config.onSynced?.({ state: true });
    });
    expect(onRefetch).toHaveBeenCalledTimes(before + 1);
    act(() => config.onSynced?.({ state: true }));
    expect(onRefetch).toHaveBeenCalledTimes(before + 1);
  });

  // CFR-F003: an empty block reads as invalid, so the note would show its fences raw.
  it('takes the block out when the YAML view is cleared, leaving the body', async () => {
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    fireEvent.click(within(panel()).getByRole('button', { name: /YAML/ }));
    const source = await within(panel()).findByRole('textbox', { name: 'YAML Metadata' });
    const { EditorView } = await import('@codemirror/view');
    const yaml = EditorView.findFromDOM(source)!;
    act(() => yaml.dispatch({ changes: { from: 0, to: yaml.state.doc.length } }));
    expect(text().toString()).toBe('# Alpha\n\n## Second\nneedle\n');
  });

  // CFR-F004: the row's title went to the direct rename, which a live note refuses without a word.
  it('runs the check-in-first rename from the note row’s title too', async () => {
    const rename = vi.fn(), onRename = vi.fn();
    await open({ live: live({ fileActions: { rename } }), onRename });
    fireEvent.click(within(row()).getByRole('button', { name: 'Edit title: Alpha' }));
    const input = within(row()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    await act(async () => {});
    expect(rename).toHaveBeenCalledWith('r2', 'Beta');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('writes `title:` from the note row’s title for a pending note', async () => {
    pending = true;
    const onRename = vi.fn();
    await open({ onRename });
    fireEvent.click(within(row()).getByRole('button', { name: 'Edit title: Alpha' }));
    const input = within(row()).getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    expect(text().toString()).toBe(TEXT.replace('title: Alpha', 'title: Beta'));
    expect(onRename).not.toHaveBeenCalled();
  });

  // VQ P2: the browser's own confirm looked unlike the app and is a browser dialog to automation.
  it('asks in the app’s own dialog before a history version replaces the live text', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await open();
    fireEvent.click(within(row()).getByRole('button', { name: 'Frontmatter' }));
    openTab('History');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Restore this version' }));
    const ask = await screen.findByRole('dialog', { name: 'Replace the live text?' });
    expect(confirm).not.toHaveBeenCalled();
    expect(text().toString()).toBe(TEXT);
    expect(within(ask).getByText(/for everyone editing the note/)).toBeInTheDocument();
    fireEvent.click(within(ask).getByRole('button', { name: 'Replace' }));
    expect(text().toString()).toBe('# Old\n');
    expect(screen.queryByRole('dialog', { name: 'Replace the live text?' })).toBeNull();
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

describe('a note in the collab editor on a phone', () => {
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  const sheet = () => screen.getByRole('dialog', { name: 'Alpha' });

  // VQ P3: the sheet listed the title rename and the rename dialog as two items named Rename.
  it('offers one Rename in the more sheet', async () => {
    await open({ live: live({ fileActions: { rename: vi.fn() } }), onRename: vi.fn(), onMove: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(within(sheet()).getAllByRole('button', { name: 'Rename' })).toHaveLength(1);
  });

  // VQ P3: the sheet's title said Frontmatter, and the section's heading said it again under it.
  it('names the frontmatter sheet once', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Frontmatter' }));
    const frontmatter = screen.getByRole('dialog', { name: 'Frontmatter' });
    expect(within(frontmatter).getAllByText('Frontmatter')).toHaveLength(1);
    expect(within(frontmatter).getByRole('checkbox', { name: 'Hide note' })).toBeInTheDocument();
  });
});

describe('the editor modes of a note in the collab editor', () => {
  const button = (name: RegExp) => screen.getAllByRole('button', { name }).find(element => element.closest('.note-mode-group, .note-editor-toolbar, [role="toolbar"]')) ?? screen.getAllByRole('button', { name })[0]!;

  it('shows Source as the raw live text, frontmatter included, edits it, and goes back to Live', async () => {
    await open();
    fireEvent.click(button(/^Source/));
    const source = await screen.findByRole('textbox', { name: 'Live note source' });
    expect(source.textContent).toContain('title: Alpha');
    expect(screen.queryByRole('textbox', { name: 'Live note content' })).toBeNull();
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(source)!;
    act(() => view.dispatch({ changes: { from: 0, to: 3, insert: '---' } }));
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: 'more\n' }, userEvent: 'input' }));
    expect(text().toString()).toBe(TEXT + 'more\n');
    fireEvent.click(button(/^Live Preview/));
    expect(screen.getByRole('textbox', { name: 'Live note content' })).toBeInTheDocument();
  });

  it('turns line numbers on and off in the collab editor', async () => {
    await open();
    const before = fake.lineNumbers.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Line Numbers' }));
    expect(fake.lineNumbers.at(-1)).toBe(!before);
    fireEvent.click(screen.getByRole('button', { name: 'Line Numbers' }));
    expect(fake.lineNumbers.at(-1)).toBe(Boolean(before));
  });
});
