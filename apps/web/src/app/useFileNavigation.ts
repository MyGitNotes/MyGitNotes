import type { FileDialogRequest } from '../components/files/types.js';
import type { FolderAction } from '../components/FolderActions.js';
import { type NoteListItem } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { noteRoute, parseWorkspaceRoute } from '../lib/routes.js';
import React from 'react';
import { readNote } from '../lib/api.js';
import { useNoteEditorRegistry } from '../lib/note-editing.js';
import { type FileResult } from '../lib/files-api.js';
import type { FileChangeScope } from '../lib/file-change-scope.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useNoteRestoration } from './useNoteRestoration.js';

interface Params {
  editorRegistry: ReturnType<typeof useNoteEditorRegistry>;
  draftsUnder: WorkspaceState['draftsUnder'];
  remote: boolean;
  readDraft: WorkspaceState['readDraft'];
  t: I18nContextValue['t'];
  config: WorkspaceState['config'];
  setFileDialog: React.Dispatch<React.SetStateAction<FileDialogRequest | undefined>>;
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  refreshDocuments: () => Promise<void>;
  editorRoute: ReturnType<typeof parseWorkspaceRoute>;
  editorNotebookId: string;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  setActionError: WorkspaceState['setActionError'];
  navigate: ReturnType<typeof useNavigate>;
  location: ReturnType<typeof useLocation>;
  returnTo: string;
  setFileEditorRevision: React.Dispatch<React.SetStateAction<number>>;
  selectedFolder: string | null;
  folderRoot: string | undefined;
  changeFilters: FilterControls['onChange'];
  handleOpenFolderIndex: ReturnType<typeof useNoteRestoration>['handleOpenFolderIndex'];
}

export function useFileNavigation({ editorRegistry, draftsUnder, remote, readDraft, t, config, setFileDialog, refreshWorkspace, refreshDocuments, editorRoute, editorNotebookId, setEditingNote, setActionError, navigate, location, returnTo, setFileEditorRevision, selectedFolder, folderRoot, changeFilters, handleOpenFolderIndex }: Params) {
  /**
   * Saves the open editors, then refuses a change that would strand drafts: those under the paths it touches. A change
   * without a scope touches no note (an R2 asset move rewrites links, which the commit of any draft merges).
   */
  const beforeFileChange = async (scope?: FileChangeScope) => {
    if (!await editorRegistry.flushEditors()) throw new Error(t('folder.draftsHint'));
    const stranded = scope ? draftsUnder(scope.notebookId, scope.paths, scope.carried) : [];
    if (stranded.length > 0) throw new Error(t('files.draftsBlock', { paths: stranded.join(', ') }));
  };
  const openFileManager = (notebookId: string, relativePath = '', action: FolderAction = 'browse') => {
    const notebook = config?.notebooks.find(nb => nb.id === notebookId);
    if (notebook) setFileDialog({ notebookId, path: notebook.root + (relativePath ? '/' + relativePath : ''), showDocuments: true, initialOperation: action === 'delete' ? 'remove-directory' : action === 'move' ? 'move' : undefined });
  };
  /**
   * Brings the page up to date with `result`. With `background`, a change that moved the open note shows the note at its
   * new path at once and the workspace is read again while the person already works there.
   */
  const onFilesChanged = async (result: FileResult, { background = false }: { background?: boolean; } = {}) => {
    // A file action commits in a remote workspace; read the head past the server's cache.
    const refresh = Promise.all([refreshWorkspace(true), refreshDocuments()]).then(() => {});
    const nb = editorRoute.note ? config?.notebooks.find(nb => nb.id === editorNotebookId) : undefined;
    const previous = nb ? nb.root + '/' + editorRoute.note : '';
    if (background && nb && result.pathMap[previous]) refresh.catch(error => setActionError((error as Error).message));
    else await refresh;
    if (editorRoute.note) {
      if (nb && result.pathMap[previous]) {
        setEditingNote(null);
        navigate(noteRoute(nb.id, result.pathMap[previous].slice(nb.root.length + 1)) + location.search, { replace: true });
        setFileDialog(undefined);
      } else if (nb) {
        try {
          if (result.deletedPaths.includes(previous)) {
            setEditingNote(null);
            navigate(returnTo, { replace: true });
          } else {
            // A remote note keeps its draft through a change to other files; the editor reopens on it, not on the commit.
            setEditingNote((remote ? readDraft(nb.id, previous)?.note : undefined) ?? await readNote(previous, nb.id));
            setFileEditorRevision(value => value + 1);
          }
        } catch (error) {
          if ((error as { status?: number; }).status !== 404) throw error;
          setEditingNote(null);
          navigate(returnTo, { replace: true });
        }
      }
    }
    if (selectedFolder && folderRoot && result.pathMap[folderRoot + '/' + selectedFolder]) {
      const moved = result.pathMap[folderRoot + '/' + selectedFolder];
      changeFilters({ folders: [moved] });
    } else if (selectedFolder && folderRoot && result.deletedPaths.includes(folderRoot + '/' + selectedFolder)) {
      changeFilters({ folders: [] });
    }
  };
  const openFileIndex = async (path: string, notebookId: string) => {
    const nb = config?.notebooks.find(nb => nb.id === notebookId);
    if (!nb) return;
    await handleOpenFolderIndex(path === nb.root ? '' : path.slice(nb.root.length + 1), undefined, nb.id);
    setFileDialog(undefined);
  };

  return { beforeFileChange, openFileManager, onFilesChanged, openFileIndex };
}
