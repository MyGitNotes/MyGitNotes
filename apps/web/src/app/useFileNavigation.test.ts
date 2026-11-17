// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFileNavigation } from './useFileNavigation.js';
import { parseWorkspaceRoute } from '../lib/routes.js';

const api = vi.hoisted(() => ({ readNote: vi.fn() }));
vi.mock('../lib/api.js', () => api);

afterEach(cleanup);
type Params = Parameters<typeof useFileNavigation>[0];
function fixture(overrides: Partial<Params> = {}) {
  const params: Params = { editorRegistry: { register: vi.fn(() => () => {}), flushEditors: vi.fn().mockResolvedValue(true) }, draftsUnder: vi.fn(() => []), remote: false, readDraft: vi.fn(() => undefined), t: key => key, config: { schema_version: 3, workspace: { title: 'Test', default_notebook: 'a' }, notebooks: [{ id: 'a', root: 'notes/a', title: 'A' }] }, setFileDialog: vi.fn(), refreshWorkspace: vi.fn().mockResolvedValue(undefined), refreshDocuments: vi.fn().mockResolvedValue(undefined), editorRoute: parseWorkspaceRoute('/notebooks/a', ''), editorNotebookId: 'a', setEditingNote: vi.fn(), setActionError: vi.fn(), navigate: vi.fn(), location: { pathname: '/notebooks/a', search: '', hash: '', key: 'test', state: null }, returnTo: '/notebooks/a', focusNoteRoute: false, setFileEditorRevision: vi.fn(), selectedFolder: 'one/nested', folderRoot: 'notes/a', changeFilters: vi.fn(), handleOpenFolderIndex: vi.fn().mockResolvedValue(undefined), ...overrides };
  const { result } = renderHook(() => useFileNavigation(params));
  return { params, model: result.current };
}
it.each(['browse', 'move', 'delete'] as const)('maps nested folder %s requests to workspace paths and scoped document browsing', action => {
  const { params, model } = fixture();
  model.openFileManager('a', 'one/nested', action);
  expect(params.setFileDialog).toHaveBeenCalledWith({ notebookId: 'a', path: 'notes/a/one/nested', showDocuments: true, initialOperation: action === 'delete' ? 'remove-directory' : action === 'move' ? 'move' : undefined });
});
it('refuses file changes when an editor cannot flush, even before draft state catches up', async () => {
  const { params, model } = fixture();
  vi.mocked(params.editorRegistry.flushEditors).mockResolvedValue(false);
  await expect(model.beforeFileChange()).rejects.toThrow('folder.draftsHint');
});
it('refuses a change that strands drafts under its paths, naming them, and lets one without a scope through', async () => {
  const draftsUnder = vi.fn((_notebookId: string, paths: readonly string[]) => paths.includes('notes/a/one') ? ['notes/a/one/x.md'] : []);
  const { model } = fixture({ draftsUnder });
  await expect(model.beforeFileChange({ notebookId: 'a', paths: ['notes/a/one'] })).rejects.toThrow('files.draftsBlock');
  await expect(model.beforeFileChange({ notebookId: 'a', paths: ['notes/a/two'], carried: ['notes/a/two'] })).resolves.toBeUndefined();
  expect(draftsUnder).toHaveBeenLastCalledWith('a', ['notes/a/two'], ['notes/a/two']);
  await expect(model.beforeFileChange()).resolves.toBeUndefined();
  expect(draftsUnder).toHaveBeenCalledTimes(2);
});
it('reopens the open remote note on its draft, not the commit, after a change to other files', async () => {
  const draft = { id: 'x', path: 'notes/a/one/nested/note.md', notebookId: 'a', title: 'Note', tags: [], metadata: {}, content: 'draft' };
  const readDraft = vi.fn((_: string, path: string) => path === draft.path ? { note: draft, base: { ...draft, content: 'committed' } } : undefined);
  const { params, model } = fixture({ remote: true, readDraft, editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/assets/x.png', pathMap: {}, deletedPaths: [] });
  expect(params.setEditingNote).toHaveBeenCalledWith(draft);
  expect(api.readNote).not.toHaveBeenCalled();
});
it('clears deleted folder filters and exits a deleted open note after refreshing workspace state', async () => {
  const { params, model } = fixture({ editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a', pathMap: {}, deletedPaths: ['notes/a/one/nested', 'notes/a/one/nested/note.md'] });
  expect(params.refreshWorkspace).toHaveBeenCalledWith(true);
  expect(params.refreshDocuments).toHaveBeenCalledOnce();
  expect(params.setEditingNote).toHaveBeenCalledWith(null);
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a', { replace: true });
  expect(params.changeFilters).toHaveBeenCalledWith({ folders: [] });
});
it('repairs selected folder and open-note routes when preserving contents moves them out', async () => {
  const { params, model } = fixture({ editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/two', pathMap: { 'notes/a/one/nested': 'notes/a/two', 'notes/a/one/nested/note.md': 'notes/a/two/note.md' }, deletedPaths: ['notes/a/one/nested', 'notes/a/one/nested/note.md'] });
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a/notes/two/note.md', { replace: true, state: null });
  expect(params.changeFilters).toHaveBeenCalledWith({ folders: ['notes/a/two'] });
});
it('shows a renamed open note at its new path before the workspace is read again, when asked to work in the background', async () => {
  let settle = () => {};
  const refreshWorkspace = vi.fn(() =>
    new Promise<void>(resolve => {
      settle = resolve;
    })
  );
  const { params, model } = fixture({ refreshWorkspace, editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/one/nested/fresh.md', pathMap: { 'notes/a/one/nested/note.md': 'notes/a/one/nested/fresh.md' }, deletedPaths: [] }, { background: true });
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a/notes/one/nested/fresh.md', { replace: true, state: null });
  expect(params.setFileDialog).toHaveBeenCalledWith(undefined);
  expect(refreshWorkspace).toHaveBeenCalledWith(true);
  expect(params.refreshDocuments).toHaveBeenCalledOnce();
  settle();
});
it('reports a failed background refresh instead of dropping it', async () => {
  const { params, model } = fixture({ refreshWorkspace: vi.fn().mockRejectedValue(new Error('offline')), editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'x', pathMap: { 'notes/a/one/nested/note.md': 'notes/a/one/nested/fresh.md' }, deletedPaths: [] }, { background: true });
  await vi.waitFor(() => expect(params.setActionError).toHaveBeenCalledWith('offline'));
});
it('keeps a renamed note the Focus shows at an address of the Focus, so it is not taken for zoom, before its entry is marked too', async () => {
  const location = { pathname: '/notebooks/a/notes/one/nested/note.md', search: '?q=x', hash: '', key: 'test', state: null };
  const { params, model } = fixture({ location: location as never, focusNoteRoute: true, editorRoute: parseWorkspaceRoute(location.pathname, location.search) });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/one/nested/fresh.md', pathMap: { 'notes/a/one/nested/note.md': 'notes/a/one/nested/fresh.md' }, deletedPaths: [] });
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a/notes/one/nested/fresh.md?q=x', { replace: true, state: { focusNote: true } });
});
it('points the Focus tabs of every file a move relocated at its new path before the workspace is read again, so a tab of a moved note stays open', async () => {
  const order: string[] = [];
  const relocateFocus = vi.fn(() => void order.push('relocate'));
  const refreshWorkspace = vi.fn(async () => void order.push('refresh'));
  const { model } = fixture({ relocateFocus, refreshWorkspace });
  // A folder move takes along a live note's target inside it: the mover's own tab of that note follows like the others.
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/projects/archive', pathMap: { 'notes/a/archive': 'notes/a/projects/archive', 'notes/a/archive/ideas.md': 'notes/a/projects/archive/ideas.md' }, deletedPaths: ['notes/a/archive'] });
  expect(relocateFocus).toHaveBeenCalledOnce();
  const [move] = relocateFocus.mock.calls[0] as unknown as [(path: string) => string];
  expect(move('notes/a/archive/ideas.md')).toBe('notes/a/projects/archive/ideas.md');
  expect(move('notes/a/big.md')).toBe('notes/a/big.md');
  expect(order).toEqual(['relocate', 'refresh']);
  // A change that moved nothing leaves the Focus alone.
  await model.onFilesChanged({ revision: 'r3', selectedPath: 'notes/a', pathMap: {}, deletedPaths: [] });
  expect(relocateFocus).toHaveBeenCalledOnce();
});
