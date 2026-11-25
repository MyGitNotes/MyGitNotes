import { FocusError } from '@mygitnotes/core/focus-page';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardPanelActions } from './board-panel-actions.js';

const note = { id: 'notes/thesis/a.md', path: 'notes/thesis/a.md', notebookId: 'thesis', title: 'A', tags: [], metadata: {} } as NoteListItem;
const place = vi.fn<(target: string, tab: { kind: 'note'; path: string; }, pane: string) => Promise<boolean>>();
const navigate = vi.fn(), flushEditors = vi.fn<() => Promise<boolean>>(), setActionError = vi.fn(), closeZoomState = vi.fn(), showFocus = vi.fn(), handleOpenNote = vi.fn();
const actions = (focus: { shown: string | null; last: string | null; focuses?: { id: string; }[]; }) => boardPanelActions({ noteFocus: { shown: focus.shown, view: { last: focus.last } as never, focuses: (focus.focuses ?? []) as never, entryOf: (() => ({ activePane: 'p2' })) as never, place: place as never }, selectedNotebookId: 'thesis', flushEditors, navigate, handleOpenNote, closeZoomState, showFocus, setActionError, t: ((key: string) => key) as never });

beforeEach(() => {
  vi.clearAllMocks();
  place.mockResolvedValue(true);
  flushEditors.mockResolvedValue(true);
});

it("adds the note to the active pane of the notebook's current Focus, then goes to the Notes page there", async () => {
  actions({ shown: null, last: 'reading-list', focuses: [{ id: 'reading-list' }] }).openInFocus(note);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/thesis?focus=reading-list'));
  expect(flushEditors).toHaveBeenCalled();
  expect(place).toHaveBeenCalledWith('reading-list', { kind: 'note', path: 'notes/thesis/a.md' }, 'p2');
  expect(closeZoomState).toHaveBeenCalled();
  expect(showFocus).toHaveBeenCalled();
});

it('uses the default Focus when the one shown last is gone, and reports a Focus that cannot take the note', async () => {
  actions({ shown: null, last: 'removed' }).openInFocus(note);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/notebooks/thesis?focus=current'));
  place.mockRejectedValueOnce(new FocusError('tab-limit', 'full'));
  actions({ shown: 'current', last: null }).openInFocus(note);
  await vi.waitFor(() => expect(setActionError).toHaveBeenCalledWith('focus.limit'));
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('leaves a note of another notebook where it is, and opens full screen in zoom', async () => {
  const panel = actions({ shown: null, last: null });
  panel.openInFocus({ ...note, notebookId: 'reading' });
  panel.fullscreen(note);
  // Zoom replaces what the panel sat in, so its note is saved first.
  await vi.waitFor(() => expect(handleOpenNote).toHaveBeenCalledWith(note));
  expect(flushEditors).toHaveBeenCalledTimes(1);
  expect(place).not.toHaveBeenCalled();
  flushEditors.mockResolvedValueOnce(false);
  panel.fullscreen(note);
  await vi.waitFor(() => expect(flushEditors).toHaveBeenCalledTimes(2));
  expect(handleOpenNote).toHaveBeenCalledTimes(1);
  expect(panel.focusNotebook).toBe('thesis');
});
