// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { takeClaim } from '../lib/live-claims.js';
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

// cfx-F005: the open editor waits while another tab hands the draft over, or while the draft changed after it listed it.
it('answers false for the open editor while another tab holds the handover, or the draft changed since it was listed', async () => {
  const release = await takeClaim(`mygitnotes-live-handover:edition:hosted:p1/notes@main\nnotes~life\nnotes/life/a.md`);
  const held = renderHook(useLiveHandover, { initialProps: params({ ready: false }) });
  try {
    expect(await act(async () => held.result.current.handOver(edited.note))).toBe(false);
  } finally {
    release!();
  }
  const newer = { ...edited, note: { ...edited.note, content: '# A\nmore and more\n' } };
  const changed = renderHook(useLiveHandover, { initialProps: params({ ready: false, readDraft: () => newer }) });
  expect(await act(async () => changed.result.current.handOver(edited.note))).toBe(false);
  expect(merged()).toEqual([]);
});

/*
 * cf16-F005: every tab hears `online` and sweeps the same drafts, which reach every tab. A note made offline is created
 * once: one tab at a time hands a draft over, and a tab reads the draft again before it does, so one another tab
 * already handed over is left alone.
 */
it('files a note made offline once when two tabs sweep it together', async () => {
  const made = { note: note('notes/life/trip.md', '# Trip\nPack the tent.\n'), base: null };
  const stored = new Map<string, WorkingNote>([[noteRefKey(made.note), made]]);
  const shared = { readDraft: (notebookId: string, path: string) => stored.get(noteRefKey({ notebookId, path })), updateDraft: vi.fn((notebookId: string, path: string, entry: WorkingNote | null) => void (entry ? stored.set(noteRefKey({ notebookId, path }), entry) : stored.delete(noteRefKey({ notebookId, path })))) };
  fetchMock.mockImplementation(async (url: string) => (url === '/api/live/new' ? json({ checkout: { ...view, id: 'new1', path: 'notes/life/.live/new1.md', pending: true } }) : json({ applied: true, contentHash: 'h'.repeat(64), checkout: view, outcome: 'joined' })));
  const tab = () => renderHook(useLiveHandover, { initialProps: params({ drafts: { [noteRefKey(made.note)]: made }, ...shared }) });
  tab();
  tab();
  await vi.waitFor(() => expect(stored.size).toBe(0));
  await act(() => new Promise(resolve => setTimeout(resolve, 50)));
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/live/new')).toHaveLength(1);
});

// cf16-F007: no `online` event comes when a request failed while the browser counted itself online.
it('hands the drafts over again once a later live request gets through, without any online event', async () => {
  let reachable = false;
  fetchMock.mockImplementation(async () => {
    if (!reachable) throw new TypeError('Failed to fetch');
    return json({ applied: true, contentHash: 'h'.repeat(64), checkout: view, outcome: 'joined' });
  });
  const input = params();
  renderHook(useLiveHandover, { initialProps: input });
  await vi.waitFor(() => expect(merged()).toEqual(['notes/life/a.md']));
  expect(input.updateDraft).not.toHaveBeenCalled();
  reachable = true;
  const { checkOutLive } = await import('../lib/live-api.js');
  await act(async () => void await checkOutLive('notes~life', 'notes/life/other.md'));
  await vi.waitFor(() => expect(input.updateDraft).toHaveBeenCalledWith('notes~life', 'notes/life/a.md', null));
});
