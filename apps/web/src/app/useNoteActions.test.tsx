// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { expect, it, vi } from 'vitest';
import { parseWorkspaceRoute } from '../lib/routes.js';
import { useNoteActions } from './useNoteActions.js';

vi.mock('../lib/api.js', () => ({ fetchAssets: vi.fn(async () => []) }));

const config = { notebooks: [{ id: 'life', root: 'notes/life' }] } as never;
const note = (name: string) => ({ path: `notes/life/${name}.md`, notebookId: 'life' } as NoteListItem);

function open(pathname: string, search: string, state: unknown, target: NoteListItem) {
  const navigate = vi.fn();
  const location = { pathname, search, hash: '', state, key: 'k' } as never;
  const { result } = renderHook(() => useNoteActions({ activeTab: 'notes', editorRegistry: { flushEditors: async () => true } as never, setEditingNote: () => {}, config, location, editorRoute: parseWorkspaceRoute(pathname, search), returnTo: '/notes/life', selectedFolder: null, selectedNotebookId: 'life', navigate, setAssets: () => {} }));
  return { navigate, run: () => result.current.handleOpenNote(target) };
}

it('stacks a note opened from a zoomed note, so closing it returns there', async () => {
  const { navigate, run } = open('/notebooks/life/notes/one.md', '?returnTo=%2Fnotes%2Flife', null, note('two'));
  await run();
  expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/two.md'), { replace: false, state: { noteTrail: ['/notebooks/life/notes/one.md?returnTo=%2Fnotes%2Flife'] } });
});

it('keeps the trail when the zoomed note is opened again, so closing it never shows it again', async () => {
  const trail = { noteTrail: ['/notebooks/life/notes/zero.md'] };
  const { navigate, run } = open('/notebooks/life/notes/one.md', '?returnTo=%2Fnotes%2Flife', trail, note('one'));
  await run();
  expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/one.md'), { replace: true, state: trail });
});

it('drops the ?zoom request of a note opened from a zoom link, since the zoom it opens carries returnTo', async () => {
  const { navigate, run } = open('/notebooks/life/notes/one.md', '?zoom', null, note('two'));
  await run();
  const url = new URL(navigate.mock.calls[0]![0] as string, 'https://workspace.invalid');
  expect(url.searchParams.has('zoom')).toBe(false);
  expect(url.searchParams.get('returnTo')).toBe('/notes/life');
});
