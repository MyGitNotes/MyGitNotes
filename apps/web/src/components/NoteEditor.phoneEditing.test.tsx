// @vitest-environment jsdom
import { createElement, forwardRef, Fragment, useEffect, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { LiveCheckoutView, LiveNoteEditing } from '../lib/live-api.js';
import { PanelProvider } from '../lib/panel-context.js';
import type { NoteItem } from '../lib/types.js';
import { NoteEditor, type NoteEditorHandle, type NoteEditorProps } from './NoteEditor.js';
import type { RenderLiveToolbar } from './live/LiveToolbarControls.js';

const inserted: string[] = [];
/** Each `editAt` call: where, and whether the touch that asked for it was still being dispatched. */
const editedAt: { x: number; y: number; inGesture: boolean; }[] = [];
let dispatching = false;
vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditor: forwardRef<unknown, { content: string; readOnly: boolean; }>(({ content, readOnly }, ref) => {
    // The real editor drops an insert while it is read-only.
    useImperativeHandle(ref, () => ({ insert: (text: string) => !readOnly && inserted.push(text), editAt: (x: number, y: number) => editedAt.push({ x, y, inGesture: dispatching }) }), [readOnly]);
    return createElement('div', { 'data-markdown-editor': '' }, createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, onChange: () => {} }), createElement('div', { className: 'cm-content' }, createElement('a', { href: '#beta' }, 'Beta'), createElement('span', null, 'words')));
  }),
}));

// The live editors stand in as plain editable text; the collab one hands the note its live session as the real one does once synced.
vi.mock('./live/LiveCollabEditor.js', async original => ({
  ...await original<typeof import('./live/LiveCollabEditor.js')>(),
  LiveCollabEditor: ({ onLive, renderToolbar }: { onLive: (session: { text: Y.Text; online: boolean; people: number; }) => void; renderToolbar: RenderLiveToolbar; }) => {
    useEffect(() => onLive({ text: new Y.Doc().getText('content'), online: true, people: 1 }), [onLive]);
    return createElement(Fragment, null, renderToolbar({}), createElement('textarea', { 'aria-label': 'Live text', defaultValue: '' }));
  },
}));
vi.mock('./live/LiveEditorFrame.js', () => ({ LiveEditorFrame: ({ renderToolbar }: { renderToolbar: RenderLiveToolbar; }) => createElement(Fragment, null, renderToolbar({}), createElement('iframe', { title: 'Framed live editor' })) }));

const liveEdit = { current: null as { edit?: () => void; checkout?: LiveCheckoutView; } | null };
vi.mock('./live/useLiveEdit.js', async original => {
  const actual = await original<typeof import('./live/useLiveEdit.js')>();
  return {
    ...actual,
    useLiveEdit: (options: Parameters<typeof actual.useLiveEdit>[0]) => {
      const real = actual.useLiveEdit(options);
      // A checked-in live note: read-only here, with the toolbar's Edit checking it out; a checked-out one shows its live editor.
      return liveEdit.current ? { ...real, active: true, edit: liveEdit.current.edit, checkout: liveEdit.current.checkout } : real;
    },
  };
});

/** A touch on `target` at (x, y), dispatched as a phone's finger sends it. */
function touch(target: Element, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, target };
  Object.defineProperties(event, { touches: { value: type === 'touchstart' ? [point] : [] }, changedTouches: { value: [point] } });
  dispatching = true;
  act(() => void target.dispatchEvent(event));
  dispatching = false;
  return event;
}
const doubleTap = (target: Element, x = 40, y = 30) => {
  touch(target, 'touchstart', x, y);
  touch(target, 'touchend', x, y);
  touch(target, 'touchstart', x + 2, y + 1);
  return touch(target, 'touchend', x + 2, y + 1);
};

let phone = true;
beforeEach(() => {
  phone = true;
  inserted.length = 0;
  editedAt.length = 0;
  liveEdit.current = null;
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 767px') ? phone : false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const note: NoteItem = { id: 'a', path: 'notes/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps> = {}) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', onClose: () => {}, ...props } as NoteEditorProps));
const content = () => screen.getByLabelText('Note content') as HTMLTextAreaElement;

it('opens a note read-only on a phone until Edit is pressed, and Done returns to reading', () => {
  render(editor());
  expect(content().readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(content().readOnly).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(content().readOnly).toBe(true);
});

it('keeps tablets and desktops editable without the toggle', () => {
  phone = false;
  render(editor());
  expect(content().readOnly).toBe(false);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('offers no toggle when the note cannot be edited', () => {
  render(editor({ readOnly: true }));
  expect(content().readOnly).toBe(true);
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('switches to editing on a double tap while reading, with the caret placed and focused inside the tap', () => {
  render(editor());
  const second = doubleTap(content(), 40, 30);
  expect(content().readOnly).toBe(false);
  expect(editedAt).toEqual([{ x: 42, y: 31, inGesture: true }]);
  expect(second.defaultPrevented).toBe(true);
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
});

it('switches on a double tap on the live text, but not on a link in it', () => {
  render(editor());
  doubleTap(screen.getByRole('link', { name: 'Beta' }));
  expect(content().readOnly).toBe(true);
  expect(editedAt).toEqual([]);
  doubleTap(screen.getByText('words'));
  expect(content().readOnly).toBe(false);
  expect(editedAt).toHaveLength(1);
});

it('leaves a single tap reading', () => {
  render(editor());
  touch(content(), 'touchstart', 40, 30);
  touch(content(), 'touchend', 40, 30);
  expect(content().readOnly).toBe(true);
  expect(editedAt).toEqual([]);
});

it('does nothing on a double tap while editing, on a note that cannot be edited, or off a phone', () => {
  const { unmount } = render(editor());
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(doubleTap(content()).defaultPrevented).toBe(false);
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  unmount();
  const locked = render(editor({ readOnly: true }));
  expect(doubleTap(content()).defaultPrevented).toBe(false);
  expect(content().readOnly).toBe(true);
  locked.unmount();
  phone = false;
  render(editor());
  expect(doubleTap(content()).defaultPrevented).toBe(false);
  expect(editedAt).toEqual([]);
});

it('does what Edit does for a checked-in live note: checks it out', () => {
  const edit = vi.fn();
  liveEdit.current = { edit };
  render(editor());
  expect(content().readOnly).toBe(true);
  doubleTap(content());
  expect(edit).toHaveBeenCalledOnce();
  expect(editedAt).toEqual([]);
  phone = false;
  cleanup();
  render(editor());
  doubleTap(content());
  expect(edit).toHaveBeenCalledOnce();
});

const checkout: LiveCheckoutView = { id: 'c1', notebookId: 'a', path: 'notes/a.md', pending: false, editorUrl: '', since: '2026-11-18T00:00:00Z', activeEditors: 1, conflict: null };
const live = (kind: 'builtin' | 'framed'): LiveNoteEditing => ({ editor: kind === 'builtin' ? { kind } : { origin: 'https://live.example', messageType: 'live-status' }, onRefetch: () => {} });

it('offers Edit on a phone for a checked-in live note, and it checks the note out', () => {
  const edit = vi.fn();
  liveEdit.current = { edit };
  render(editor({ live: live('builtin') }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(edit).toHaveBeenCalledOnce();
  expect(content().readOnly).toBe(true);
});

it('shows no Edit or Done in the toolbar while the built-in collab editor is open on a phone, so nothing flips the hidden direct editor', async () => {
  liveEdit.current = { checkout };
  render(editor({ live: live('builtin') }));
  await act(async () => {});
  expect(screen.getByLabelText('Live text')).toBeTruthy();
  expect(screen.queryByLabelText('Note content')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(doubleTap(screen.getByLabelText('Live text')).defaultPrevented).toBe(false);
});

it('shows no Edit or Done in the toolbar while the framed live editor is open on a phone', () => {
  liveEdit.current = { checkout: { ...checkout, embedUrl: 'https://live.example/embed' } };
  render(editor({ live: live('framed') }));
  expect(screen.getByTitle('Framed live editor')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
});

it('switches to editing for an insert made while reading, instead of dropping it', async () => {
  const ref = { current: null as NoteEditorHandle | null };
  render(createElement(PanelProvider, null, createElement(NoteEditor, { ref, note, frame: 'zoom', active: true, statuses: [], autoSave: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', onClose: () => {} } as NoteEditorProps)));
  await act(async () => {
    ref.current?.insert('[[Beta]]');
  });
  expect(content().readOnly).toBe(false);
  expect(inserted).toEqual(['[[Beta]]']);
});
