// @vitest-environment jsdom
import { tooltipText } from '../tooltip-test-helpers.js';
import { createElement } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { FocusNoteList } from '../FocusNoteList.js';
import { LiveBadge } from './LiveBadge.js';
import { liveActionLocked, type LiveDrafts, LiveDraftsProvider } from './live-drafts.js';
import { zhTW } from '../../lib/i18n/zh-TW.js';
import { parseWorkspaceRoute } from '../../lib/routes.js';

/*
 * Moving a filed live note (編輯中) while it is edited (docs/specs/2026-11-15-builtin-live-editor §20.4): the lists show it
 * at the path it goes to, marked 「簽回後移到這裡」 with where it lies now; move and rename are open where the live editor
 * can retarget; a check-in that found the target taken says so on the row; the old path leads to the note.
 */

const lookup = vi.hoisted(() => ({ current: { notes: [] as unknown[], committed: [] as unknown[], loading: false, paused: false, error: '' } }));
const api = vi.hoisted(() => ({ readNote: vi.fn() }));
vi.mock('../../lib/use-note-queries.js', async original => ({ ...(await original<object>()), useNoteLookup: () => lookup.current }));
vi.mock('../../lib/api.js', async original => {
  const actual = await original<typeof import('../../lib/api.js')>();
  return { ...actual, readNote: api.readNote };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const builtin: LiveDrafts = { discards: () => true, retargets: () => true, releasesUntouched: () => true };
const framed: LiveDrafts = { discards: () => false, retargets: () => false, releasesUntouched: () => false };
const since = '2026-11-17T01:00:00.000Z';
const moving = { since, activeEditors: 2, editorUrl: '', movingFrom: 'notes/life/會議/2026-11-17 公司週會.md' };
const row = (path: string, live?: NoteListItem['live']): NoteListItem => ({ id: path, path, notebookId: 'notes~life', title: 'Weekly', tags: [], metadata: {}, status: 'inbox', ...(live ? { live } : {}) });

describe('a filed live note others edit', () => {
  it('may be moved or renamed where the live editor can retarget, never deleted, and stays locked for a framed editor', () => {
    const note = { notebookId: 'notes~life', live: { since, activeEditors: 2, editorUrl: '' } };
    expect(liveActionLocked(note, 'move', builtin)).toBe(false);
    expect(liveActionLocked(note, 'delete', builtin)).toBe(true);
    expect(liveActionLocked(note, 'other', builtin)).toBe(true);
    expect(liveActionLocked(note, 'move', framed)).toBe(true);
  });

  it('shows in a list at its target, marked as moving there at the check-in, with where it lies now, and its Move open', async () => {
    const note = row('notes/life/archive/2026-11-17 公司週會.md', moving);
    render(createElement(LiveDraftsProvider, { value: builtin }, createElement(FocusNoteList, { statuses: ['inbox'], notes: [note], onOpenNote: vi.fn(), onDeleteNote: vi.fn(), onMoveNote: vi.fn(), onUpdateNoteStatus: vi.fn(), onNewNote: vi.fn() })));
    const line = screen.getByText('Weekly').closest<HTMLElement>('[data-focus-row]')!;
    const marker = within(line).getByText('Moves here at check-in');
    expect(tooltipText(marker.closest('[data-t1-trigger]'))).toEqual(expect.stringContaining('notes/life/會議/2026-11-17 公司週會.md'));
    fireEvent.focus(line);
    const details = within(await screen.findByRole('group', { name: 'Details for Weekly' }));
    expect(details.getByRole('button', { name: 'Move note' })).toBeEnabled();
    expect(details.getByRole('button', { name: 'Delete note' })).toBeDisabled();
  });

  it('says on its row when the check-in kept it in place because its target exists', () => {
    render(createElement(LiveBadge, { live: { since, activeEditors: 1, editorUrl: '', unmoved: 'notes/life/archive/2026-11-17 公司週會.md' } }));
    const warning = screen.getByText('Not moved: the destination exists');
    expect(tooltipText(warning.closest('[data-t1-trigger]'))).toEqual(expect.stringContaining('notes/life/archive/2026-11-17 公司週會.md'));
  });

  it('says on its row when the check-in kept it in place because the move would change too much', () => {
    render(createElement(LiveBadge, { live: { since, activeEditors: 1, editorUrl: '', unmoved: 'notes/life/archive/2026-11-17 公司週會.md', unmovedReason: 'too-large' } }));
    const warning = screen.getByText('Not moved: too many files to change');
    expect(tooltipText(warning.closest('[data-t1-trigger]'))).toEqual(expect.stringContaining('more files than one commit takes'));
    expect(zhTW['live.unmovedTooLarge']).toBe('沒有移動：牽動的檔案太多');
  });

  it('reads 簽回後移到這裡 and 沒有移動：目標已存在 in Traditional Chinese', () => {
    expect(zhTW['live.movingHere']).toBe('簽回後移到這裡');
    expect(zhTW['live.unmoved']).toBe('沒有移動：目標已存在');
  });
});

describe('opening the path a live note is moving away from', () => {
  it('goes to the path it moves to, as a filed pending note does', async () => {
    const { ApiError } = await import('../../lib/api.js');
    api.readNote.mockRejectedValue(new ApiError('Moved.', 404, undefined, undefined, false, { movedTo: 'notes/archive/weekly.md' }));
    lookup.current = { notes: [], committed: [], loading: false, paused: false, error: '' };
    const { useRoutedNote } = await import('../../app/useRoutedNote.js');
    const onFiled = vi.fn();
    const config = { notebooks: [{ id: 'nb', root: 'notes', name: 'Notes' }] } as unknown as Parameters<typeof useRoutedNote>[0]['config'];
    renderHook(() => useRoutedNote({ config, editorRoute: parseWorkspaceRoute('/notebooks/nb/notes/meetings/weekly.md', ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn(), onFiled }));
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith('nb', 'notes/archive/weekly.md', 'notes/meetings/weekly.md'));
    expect(api.readNote).toHaveBeenCalledWith('notes/meetings/weekly.md', 'nb');
  });
});
