import { describe, expect, it, vi } from 'vitest';
import { followMovedNote } from './follow-moved-note.js';

/*
 * A note this page shows answered that it lies elsewhere now: a live note's move another person made, checked in or still
 * waiting for its check-in (docs/specs/2026-11-15-builtin-live-editor §20.4). Every view of it here follows it there.
 */

const notebook = { id: 'nb', root: 'notes' };
const note = { notebookId: 'nb', path: 'notes/meetings/weekly.md' };

describe('followMovedNote', () => {
  it('points the Focus tabs of the note at its new path, takes the address there when it named the note, and reads the lists again', () => {
    const relocatePaths = vi.fn(), navigate = vi.fn(), refresh = vi.fn();
    followMovedNote({ note, to: 'notes/archive/weekly.md', notebook, routedPath: note.path, search: '?mode=raw', state: { focusNote: true }, relocatePaths, navigate, refresh });
    expect(relocatePaths).toHaveBeenCalledOnce();
    const [notebookId, move] = relocatePaths.mock.calls[0] as [string, (path: string) => string];
    expect(notebookId).toBe('nb');
    expect(move(note.path)).toBe('notes/archive/weekly.md');
    expect(move('notes/other.md')).toBe('notes/other.md');
    // The address keeps what its history entry says of it (a note the Focus shows stays in the Focus, not zoom).
    expect(navigate).toHaveBeenCalledWith('/notebooks/nb/notes/archive/weekly.md?mode=raw', { replace: true, state: { focusNote: true } });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('carries a note link the page was loaded on, still waiting for the Focus, to where the note lies', () => {
    const follow = vi.fn(), navigate = vi.fn();
    followMovedNote({ note, to: 'notes/archive/weekly.md', notebook, routedPath: note.path, search: '', state: null, link: { follow }, relocatePaths: vi.fn(), navigate, refresh: vi.fn() });
    expect(follow).toHaveBeenCalledWith('meetings/weekly.md', 'archive/weekly.md');
    expect(follow.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it('leaves an address that names another note alone, and follows no path outside the notebook', () => {
    const relocatePaths = vi.fn(), navigate = vi.fn(), refresh = vi.fn();
    followMovedNote({ note, to: 'notes/archive/weekly.md', notebook, routedPath: 'notes/other.md', search: '', relocatePaths, navigate, refresh });
    expect(relocatePaths).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    followMovedNote({ note, to: 'elsewhere/weekly.md', notebook, routedPath: note.path, search: '', relocatePaths, navigate, refresh });
    expect(relocatePaths).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
