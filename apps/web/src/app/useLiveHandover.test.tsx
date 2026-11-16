// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { LIVE_MERGE_CONFLICT } from '../lib/live-handover.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';
import { type LiveHandoverParams, useLiveHandover } from './useLiveHandover.js';

/*
 * Offline handover at the workspace (docs/specs/2026-11-16-collab-first-self-host A3.2): when the browser is back online,
 * every draft of a covered note is merged into its live note, cleared once the merge is stored, and kept blocked when it
 * conflicts; deletions and notes the live editor does not cover stay for a manual commit.
 */

const note = (path: string, content: string): NoteItem => ({ id: path, path, notebookId: 'notes~life', title: path, tags: [], metadata: { title: path }, content, revision: 'r1' });
const edited = { note: note('notes/life/a.md', '# A\nmore\n'), base: note('notes/life/a.md', '# A\n') };
const deleted: WorkingNote = { note: note('notes/life/d.md', '# D\n'), base: note('notes/life/d.md', '# D\n'), deleted: true };
const plain = { note: note('notes/life/p.md', '# P\nmore\n'), base: note('notes/life/p.md', '# P\n') };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const view = { id: 'abc', notebookId: 'notes~life', path: 'notes/life/a.md', pending: false, editorUrl: 'http://localhost/a', since: '2026-11-16T02:00:00.000Z', activeEditors: 0, conflict: null };

let fetchMock: ReturnType<typeof vi.fn>;
let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  fetchMock = vi.fn(async () => json({ applied: true, contentHash: 'h'.repeat(64), checkout: view, outcome: 'joined' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const params = (overrides: Partial<LiveHandoverParams> = {}): LiveHandoverParams => ({ ready: true, drafts: Object.fromEntries([edited, deleted, plain].map(entry => [noteRefKey(entry.note), entry])), covered: draft => draft.path === 'notes/life/p.md' ? null : { scope: 'edition:hosted:p1/notes@main', notebookRoot: 'notes/life' }, updateDraft: vi.fn(), stageWorkingNote: vi.fn(draft => draft), invalidateNotes: vi.fn(), ...overrides });
const merged = () => fetchMock.mock.calls.filter(([url]) => url === '/api/live/merge').map(([, init]) => JSON.parse(String((init as RequestInit).body)).path);

it('hands each draft of a covered note over once the browser is back online, and clears it once the merge is stored', async () => {
  online = false;
  const input = params();
  renderHook(useLiveHandover, { initialProps: input });
  await act(async () => {});
  expect(fetchMock).not.toHaveBeenCalled();
  online = true;
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  // The merge id is a digest, which the browser computes off the main thread.
  await vi.waitFor(() => expect(input.updateDraft).toHaveBeenCalled());
  expect(merged()).toEqual(['notes/life/a.md']);
  expect(input.updateDraft).toHaveBeenCalledWith('notes~life', 'notes/life/a.md', null);
  expect(input.updateDraft).toHaveBeenCalledTimes(1);
  expect(input.invalidateNotes).toHaveBeenCalled();
});

it('hands the drafts over when the workspace loads online, as after a reload', async () => {
  const input = params({ ready: false });
  const hook = renderHook(useLiveHandover, { initialProps: input });
  await act(async () => {});
  expect(fetchMock).not.toHaveBeenCalled();
  hook.rerender({ ...input, ready: true });
  await vi.waitFor(() => expect(merged()).toEqual(['notes/life/a.md']));
});

it('keeps a draft whose merge conflicted, blocked, and one the server could not take, as it is', async () => {
  fetchMock.mockImplementation(async () => json({ error: 'conflict', code: 'merge-conflict', checkout: view }, 409));
  const input = params();
  renderHook(useLiveHandover, { initialProps: input });
  await vi.waitFor(() => expect(input.stageWorkingNote).toHaveBeenCalledWith(edited.note, edited.base, LIVE_MERGE_CONFLICT));
  expect(input.updateDraft).not.toHaveBeenCalled();
});

it('hands one note over for its open editor, sharing a handover already running', async () => {
  const input = params();
  const hook = renderHook(useLiveHandover, { initialProps: input });
  const result = await act(async () => hook.result.current.handOver(edited.note));
  expect(result).toBe(true);
  expect(merged()).toEqual(['notes/life/a.md']);
});
