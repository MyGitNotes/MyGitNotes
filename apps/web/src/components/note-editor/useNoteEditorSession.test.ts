// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteItem } from '../../lib/types.js';
import { useNoteEditorSession, type UseNoteEditorSessionParams } from './useNoteEditorSession.js';

const registry = vi.hoisted(() => ({ flushes: [] as (() => Promise<boolean>)[] }));
vi.mock('../../lib/note-editing.js', () => ({
  useEditorRegistry: () => (_key: string, flush: () => Promise<boolean>) => {
    registry.flushes.push(flush);
    return () => {};
  },
}));

const note = (title: string, content = `# ${title}\n\nBody.\n`): NoteItem => ({ id: 'idea', path: 'notes/idea.md', notebookId: 'nb', title, tags: [], metadata: { title }, content });

function setup(draftMode: boolean) {
  const onSave = vi.fn(async (params: { path: string; content: string; metadata?: Record<string, unknown>; }) => ({ ...note('saved'), content: params.content, metadata: params.metadata ?? {} }));
  const base = { readOnly: false, autoSave: true, draftMode, propIsDirty: false, branch: 'main', draftScope: draftMode ? 'repo' : '', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote: undefined, onRestoreFile: vi.fn(), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
  const hook = renderHook(({ current }: { current: NoteItem; }) => useNoteEditorSession({ ...base, note: current }), { initialProps: { current: note('Old name') } });
  return { hook, onSave };
}

beforeEach(() => {
  registry.flushes.length = 0;
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('useNoteEditorSession and a note that changes under it', () => {
  it.each([true, false])('adopts a retitled note while nothing is unsaved, and never writes the old title back (draft mode: %s)', async draftMode => {
    const { hook, onSave } = setup(draftMode);
    expect(hook.result.current.title).toBe('Old name');
    hook.rerender({ current: note('New name') });
    expect(hook.result.current.title).toBe('New name');
    expect(hook.result.current.metadata.title).toBe('New name');
    expect(hook.result.current.content).toBe('# New name\n\nBody.\n');
    expect(hook.result.current.hasUnsavedChanges).toBe(false);
    // The editor going away (navigation, hiding, closing) saves nothing: it has no edit of its own.
    for (const flush of registry.flushes) expect(await act(() => flush())).toBe(true);
    await act(() => hook.result.current.close());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps typing it has not saved, and saves that, when the note changes under it', async () => {
    const { hook, onSave } = setup(true);
    act(() => hook.result.current.setContent('# Old name\n\nTyped.\n'));
    hook.rerender({ current: note('New name') });
    expect(hook.result.current.content).toBe('# Old name\n\nTyped.\n');
    await act(() => hook.result.current.close());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ content: '# Old name\n\nTyped.\n' }));
  });

  it('does not take the editor back to a state it already saved when a lagging read echoes it', async () => {
    const { hook, onSave } = setup(true);
    act(() => hook.result.current.setContent('# Old name\n\nTyped.\n'));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(hook.result.current.hasUnsavedChanges).toBe(false));
    hook.rerender({ current: note('Old name') });
    expect(hook.result.current.content).toBe('# Old name\n\nTyped.\n');
  });
});

describe('useNoteEditorSession after the committed note moved under a clean session', () => {
  const server = note('Contract', '# Contract\n\nClause 1.\n');
  // A commit stamps `updated` on the note it keeps, which the session's own copy does not have.
  const committed = { ...server, content: '# Contract\n\nClause 1.\nLOCAL line.\n', metadata: { ...server.metadata, updated: '2026-10-25T14:14:24.845Z' } };

  /** A draft-mode session whose reads answer `latest` (a demo reads the notes committed in this browser). */
  function open() {
    const onSave = vi.fn(async (params: { path: string; content: string; metadata?: Record<string, unknown>; }) => ({ ...server, content: params.content, metadata: params.metadata ?? server.metadata }));
    const latest = { current: server };
    const onReadRemote = vi.fn(async () => latest.current);
    const base = { readOnly: false, autoSave: true, draftMode: true, propIsDirty: false, branch: 'main', draftScope: 'repo', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(), onCommitFile: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note' | 'remoteBase'>;
    const hook = renderHook(({ current, remoteBase }: { current: NoteItem; remoteBase: NoteItem; }) => useNoteEditorSession({ ...base, note: current, remoteBase }), { initialProps: { current: server, remoteBase: server } });
    return { hook, latest };
  }

  it('takes the committed note as its base, so a restore afterwards replaces the text instead of merging the commit back in', async () => {
    const { hook, latest } = open();
    act(() => hook.result.current.setContent(committed.content));
    await vi.waitFor(() => expect(hook.result.current.hasUnsavedChanges).toBe(false));
    // The text was committed elsewhere (the Changes dialog): the committed note is now what the session holds.
    latest.current = committed;
    hook.rerender({ current: committed, remoteBase: committed });
    expect(hook.result.current.baseNote.content).toBe(committed.content);
    // Restoring an earlier version puts the older text back; a read of the committed note must not undo that.
    act(() => hook.result.current.setContent(server.content));
    await vi.waitFor(() => expect(hook.result.current.hasUnsavedChanges).toBe(false));
    await act(() => hook.result.current.pullLatest());
    expect(hook.result.current.content).toBe(server.content);
    expect(hook.result.current.remoteNotice).toBe('');
    expect(hook.result.current.blocked).toBe(false);
  });

  it('keeps its base while the session holds text the committed note does not', () => {
    const { hook } = open();
    act(() => hook.result.current.setContent('# Contract\n\nTyped.\n'));
    hook.rerender({ current: committed, remoteBase: committed });
    expect(hook.result.current.content).toBe('# Contract\n\nTyped.\n');
    expect(hook.result.current.baseNote.content).toBe(server.content);
  });
});
