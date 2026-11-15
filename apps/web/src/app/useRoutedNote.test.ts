// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseWorkspaceRoute } from '../lib/routes.js';

const lookup = vi.hoisted(() => ({ current: { notes: [] as unknown[], committed: [] as unknown[], loading: true, paused: false, error: '' } }));
vi.mock('../lib/use-note-queries.js', () => ({ useNoteLookup: () => lookup.current }));
vi.mock('../lib/api.js', () => ({ ApiError: class extends Error {}, readNote: vi.fn() }));

const { useRoutedNote } = await import('./useRoutedNote.js');

const config = { notebooks: [{ id: 'nb', root: 'notes', name: 'Notes' }] } as unknown as Parameters<typeof useRoutedNote>[0]['config'];
const open = () => renderHook(() => useRoutedNote({ config, editorRoute: parseWorkspaceRoute('/notebooks/nb/notes/idea.md', ''), editorNotebookId: 'nb', editingNote: null, loading: false, sourceId: 'src', setEditingNote: vi.fn() }));

describe('useRoutedNote and a note read that waits for the connection', () => {
  it('says the note cannot be read offline instead of loading for ever, and loads once the read runs again', () => {
    lookup.current = { notes: [], committed: [], loading: true, paused: true, error: '' };
    const hook = open();
    expect(hook.result.current.routedLoading).toBe(false);
    expect(hook.result.current.routeError).toBe('route.noteOffline');
    lookup.current = { ...lookup.current, paused: false };
    hook.rerender();
    expect(hook.result.current.routedLoading).toBe(true);
    expect(hook.result.current.routeError).toBe('');
  });

  it('still loads while a read is running', () => {
    lookup.current = { notes: [], committed: [], loading: true, paused: false, error: '' };
    const hook = open();
    expect(hook.result.current.routedLoading).toBe(true);
    expect(hook.result.current.routeError).toBe('');
  });
});
