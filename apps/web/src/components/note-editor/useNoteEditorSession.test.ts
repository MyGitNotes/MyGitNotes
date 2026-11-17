// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
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

describe('useNoteEditorSession and a late committed note equal to unsaved text', () => {
  // An autosave waits 750 ms before it writes; vi.waitFor's default 1000 ms would leave a busy machine 250 ms for the write itself.
  const SAVE_WAIT = { timeout: 10_000 };
  it('still saves an undo that a late read of an older save happens to match', async () => {
    const start = note('Idea', '# Idea\n\nC0.\n');
    const first = { ...start, content: '# Idea\n\nC1.\n' };
    const onSave = vi.fn(async (params: { path: string; content: string; metadata?: Record<string, unknown>; }) => ({ ...start, content: params.content, metadata: params.metadata ?? start.metadata }));
    const base = { readOnly: false, autoSave: true, draftMode: false, propIsDirty: false, branch: 'main', draftScope: '', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote: undefined, onRestoreFile: vi.fn(), onCommitFile: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note' | 'remoteBase'>;
    const hook = renderHook(({ remoteBase }: { remoteBase: NoteItem; }) => useNoteEditorSession({ ...base, note: start, remoteBase }), { initialProps: { remoteBase: start } });
    act(() => hook.result.current.setContent(first.content));
    await vi.waitFor(() => expect(hook.result.current.hasUnsavedChanges).toBe(false), SAVE_WAIT);
    act(() => hook.result.current.setContent('# Idea\n\nC2.\n'));
    await vi.waitFor(() => expect(hook.result.current.hasUnsavedChanges).toBe(false), SAVE_WAIT);
    // Undo back to C1, then the read that followed the first save arrives late, holding C1.
    act(() => hook.result.current.setContent(first.content));
    hook.rerender({ remoteBase: { ...first } });
    // The hook marks the session saved only after the write resolves and React renders, which can land after the poll that sees the write.
    await vi.waitFor(() => {
      expect(onSave.mock.calls.at(-1)?.[0].content).toBe(first.content);
      expect(hook.result.current.hasUnsavedChanges).toBe(false);
    }, SAVE_WAIT);
  });
});

describe('useNoteEditorSession when the check of the remote note fails', () => {
  function open(failure: Error) {
    const onMarkConflict = vi.fn();
    const base = { readOnly: false, autoSave: true, draftMode: true, propIsDirty: false, branch: 'main', draftScope: 'repo', onSave: vi.fn() as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote: vi.fn(async () => Promise.reject(failure)), onRestoreFile: vi.fn(), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    const hook = renderHook(() => useNoteEditorSession({ ...base, note: note('Contract') }));
    return { hook, onMarkConflict };
  }

  it('keeps a conflict draft of a note the remote reports gone', async () => {
    const { hook, onMarkConflict } = open(new ApiError('Not found', 404));
    await vi.waitFor(() => expect(hook.result.current.blocked).toBe(true));
    expect(onMarkConflict).toHaveBeenCalledOnce();
    expect(localStorage.getItem('gh_notes_draft:repo:conflict:notes/idea.md')).not.toBeNull();
  });

  it('shows another failure without a conflict draft, so a note nobody edited is not listed as a conflict', async () => {
    const { hook, onMarkConflict } = open(new Error('Notebook is not configured.'));
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('Notebook is not configured.'));
    expect(hook.result.current.blocked).toBe(false);
    expect(onMarkConflict).not.toHaveBeenCalled();
    expect(Object.keys(localStorage)).toEqual([]);
  });
});

describe('useNoteEditorSession and a note the remote says moved', () => {
  it.each([true, false])('follows a note the remote reports at another path, keeping no conflict draft, nothing of its own having been typed (read-only: %s)', async readOnly => {
    const onMarkConflict = vi.fn(), onMoved = vi.fn();
    const moved = new ApiError('This live note was checked in and filed.', 404, undefined, undefined, false, { movedTo: 'notes/archive/idea.md' });
    const base = { readOnly, autoSave: true, draftMode: true, propIsDirty: false, branch: 'main', draftScope: 'repo', onSave: vi.fn() as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote: vi.fn(async () => Promise.reject(moved)), onRestoreFile: vi.fn(async () => Promise.reject(moved)), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict, onMoved } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    const hook = renderHook(() => useNoteEditorSession({ ...base, note: note('Contract') }));
    await vi.waitFor(() => expect(onMoved).toHaveBeenCalledWith('notes/archive/idea.md'));
    // A refresh asked of it, as a live editor's refetch asks, follows too.
    onMoved.mockClear();
    await act(() => hook.result.current.pullLatest());
    expect(onMoved).toHaveBeenCalledWith('notes/archive/idea.md');
    expect(hook.result.current.blocked).toBe(false);
    expect(hook.result.current.saveError).toBe('');
    expect(onMarkConflict).not.toHaveBeenCalled();
    expect(Object.keys(localStorage)).toEqual([]);
  });
});

describe('useNoteEditorSession and a note the remote says moved, holding text of its own', () => {
  it('keeps a read-only session holding text that differs from its base where it is, as a conflict, instead of following without it (review3 F001)', async () => {
    const onMarkConflict = vi.fn(), onMoved = vi.fn();
    const moved = new ApiError('This live note was checked in and filed.', 404, undefined, undefined, false, { movedTo: 'notes/archive/idea.md' });
    const onReadRemote = vi.fn<() => Promise<NoteItem>>().mockResolvedValueOnce(note('Contract')).mockRejectedValue(moved);
    const base = { readOnly: true, autoSave: false, draftMode: true, propIsDirty: false, branch: 'main', draftScope: 'repo', onSave: vi.fn() as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(async () => Promise.reject(moved)), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict, onMoved } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    const hook = renderHook(() => useNoteEditorSession({ ...base, note: note('Contract') }));
    await vi.waitFor(() => expect(onReadRemote).toHaveBeenCalledOnce());
    // Held text of its own, as an offline merge conflict a read-only session keeps.
    act(() => hook.result.current.setContent('# Contract\n\nTyped offline.\n'));
    await act(() => hook.result.current.pullLatest());
    expect(onMoved).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(hook.result.current.blocked).toBe(true));
    expect(onMarkConflict).toHaveBeenCalledOnce();
    expect(localStorage.getItem('gh_notes_draft:repo:conflict:notes/idea.md')).not.toBeNull();
  });
});

describe('useNoteEditorSession and a read that cannot reach the server', () => {
  it('says so in its own words instead of the browser’s, and clears it once the connection is back', async () => {
    const onReadRemote = vi.fn<() => Promise<NoteItem>>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(note('Old name'));
    const base = { readOnly: true, autoSave: true, draftMode: false, propIsDirty: false, branch: 'main', draftScope: '', onSave: vi.fn() as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    const hook = renderHook(() => useNoteEditorSession({ ...base, note: note('Old name') }));
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('editor.remoteUnreachable'));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => expect(onReadRemote).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe(''));
  });

  const writable = (onReadRemote: () => Promise<NoteItem>, onSave: (params: { path: string; content: string; }) => Promise<NoteItem>) => {
    const base = { readOnly: false, autoSave: false, draftMode: false, propIsDirty: false, branch: 'main', draftScope: '', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    return renderHook(() => useNoteEditorSession({ ...base, note: note('Old name') }));
  };

  it('says a save that could not reach the server failed, and a later read does not clear that until a save succeeds', async () => {
    const onReadRemote = vi.fn(async () => note('Old name'));
    const onSave = vi.fn<(params: { path: string; content: string; }) => Promise<NoteItem>>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async params => ({ ...note('Old name'), content: params.content }));
    const hook = writable(onReadRemote, onSave);
    await vi.waitFor(() => expect(onReadRemote).toHaveBeenCalledOnce());
    act(() => hook.result.current.setContent('# Old name\n\nTyped.\n'));
    await act(async () => {
      await hook.result.current.handleExplicitSave();
    });
    expect(hook.result.current.saveError).toBe('editor.saveUnreachable');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => expect(onReadRemote).toHaveBeenCalledTimes(3));
    expect(hook.result.current.saveError).toBe('editor.saveUnreachable');
    expect(hook.result.current.hasUnsavedChanges).toBe(true);
    await act(async () => {
      await hook.result.current.handleExplicitSave();
    });
    expect(hook.result.current.saveError).toBe('');
  });

  it.each(['commit', 'autosave'])('says the %s that could not reach the server failed, and a failed read afterwards does not replace that until a write succeeds', async kind => {
    const offline = { current: true };
    const fetchFailure = () => new TypeError('Failed to fetch');
    const onReadRemote = vi.fn(async () => {
      if (offline.current) throw fetchFailure();
      return note('Old name');
    });
    const onSave = vi.fn(async (params: { path: string; content: string; }) => {
      if (offline.current) throw fetchFailure();
      return { ...note('Old name'), content: params.content };
    });
    const onCommitFile = vi.fn(async () => {
      if (offline.current) throw fetchFailure();
    });
    const base = { readOnly: false, autoSave: kind === 'autosave', draftMode: false, propIsDirty: false, branch: 'main', draftScope: '', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(), onCommitFile, remoteBase: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    const hook = renderHook(() => useNoteEditorSession({ ...base, note: note('Old name') }));
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('editor.remoteUnreachable'));
    act(() => hook.result.current.setContent('# Old name\n\nTyped.\n'));
    if (kind === 'commit') {
      await act(async () => {
        expect(await hook.result.current.commitNote()).toBe(false);
      });
    }
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe('editor.saveUnreachable'), { timeout: 5000 });
    // Another read, still offline, fails: the write's failure is what the person must see.
    const reads = onReadRemote.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await vi.waitFor(() => expect(onReadRemote.mock.calls.length).toBeGreaterThan(reads));
    await act(async () => {
      await hook.result.current.pullLatest();
    });
    expect(hook.result.current.saveError).toBe('editor.saveUnreachable');
    offline.current = false;
    await act(async () => {
      expect(await hook.result.current.commitNote()).toBe(true);
    });
    expect(hook.result.current.saveError).toBe('');
  });

  it('keeps the words of a TypeError that is no network failure', async () => {
    const onReadRemote = vi.fn<() => Promise<NoteItem>>().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'content')"));
    const hook = writable(onReadRemote, vi.fn());
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe("Cannot read properties of undefined (reading 'content')"));
  });
});

// FM-F003: a save refused because the note's frontmatter cannot be read (someone broke the block) is a 409 too, but no
// remote change merges it away: the session shows the refusal, reads nothing back, and its autosave does not send the
// refused draft again.
describe('useNoteEditorSession and a save refused because the frontmatter cannot be read', () => {
  const refusal = 'The frontmatter cannot be read.';
  const refused = () => new ApiError(refusal, 409, undefined, undefined, false, { code: 'frontmatter-invalid' });
  function open(autoSave: boolean) {
    const onReadRemote = vi.fn(async () => note('Old name'));
    const onSave = vi.fn(async (): Promise<NoteItem> => {
      throw refused();
    });
    const base = { readOnly: false, autoSave, draftMode: false, propIsDirty: false, branch: 'main', draftScope: '', onSave: onSave as unknown as UseNoteEditorSessionParams['onSave'], onReadRemote, onRestoreFile: vi.fn(), onCommitFile: undefined, remoteBase: undefined, conflictReason: undefined, onMarkConflict: undefined } satisfies Omit<UseNoteEditorSessionParams, 'note'>;
    return { hook: renderHook(() => useNoteEditorSession({ ...base, note: note('Old name') })), onReadRemote, onSave };
  }

  it('shows the refusal of an explicit save of a remote note, not a remote change', async () => {
    const { hook, onReadRemote, onSave } = open(false);
    await vi.waitFor(() => expect(onReadRemote).toHaveBeenCalledOnce());
    act(() => hook.result.current.setMetadata({ ...hook.result.current.metadata, status: 'done' }));
    await act(async () => {
      expect(await hook.result.current.handleExplicitSave()).toBe(false);
    });
    expect(hook.result.current.saveError).toBe(refusal);
    expect(onSave).toHaveBeenCalledOnce();
    // The read before the save, and none after the refusal.
    expect(onReadRemote).toHaveBeenCalledTimes(2);
    expect(hook.result.current.hasUnsavedChanges).toBe(true);
    expect(hook.result.current.metadata).toMatchObject({ status: 'done' });
  });

  it('does not autosave a refused draft again, until it changes', async () => {
    const { hook, onSave } = open(true);
    act(() => hook.result.current.setMetadata({ ...hook.result.current.metadata, status: 'done' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce(), { timeout: 3000 });
    await vi.waitFor(() => expect(hook.result.current.saveError).toBe(refusal));
    // An explicit save tries once more, as asked; it reads the note first, which hands the session a new base.
    await act(async () => {
      expect(await hook.result.current.handleExplicitSave()).toBe(false);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    await act(() => new Promise(resolve => setTimeout(resolve, 1500)));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(hook.result.current.saveError).toBe(refusal);
    // A changed draft is saved again.
    act(() => hook.result.current.setContent('# Old name\n\nFixed.\n'));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(3), { timeout: 3000 });
  });
});
