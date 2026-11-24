import type { CompilationRow } from '@mygitnotes/core/compilation';
import { CompilationView } from '../components/CompilationView.js';
import { planNewCompilation } from '../lib/compilation-create.js';
import { initialCompilationStatus } from '../lib/compilation-status.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { trailCompilation } from '../lib/routes.js';
import type { useBrowseFacets } from './useBrowseFacets.js';
import { useCompilationActionsValue } from './useCompilationActionsValue.js';
import { UNTITLED_STEM, type useCreateNote } from './useCreateNote.js';
import type { useDeletionUndo } from './useDeletionUndo.js';
import type { useFocusNoteNavigation } from './useFocusNoteNavigation.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useNoteSaving } from './useNoteSaving.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: WorkspaceState['config'];
  remote: WorkspaceState['remote'];
  folders: WorkspaceState['folders'];
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  repositoryFor: WorkspaceState['repositoryFor'];
  revisionFor: WorkspaceState['revisionFor'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  setGitStatus: WorkspaceState['setGitStatus'];
  setActionError: WorkspaceState['setActionError'];
  invalidateNotes: () => void;
  facets: ReturnType<typeof useBrowseFacets>['facetsQuery']['facets'];
  t: I18nContextValue['t'];
  selectedNotebookId: string;
  /** The selected notebook's root, whose folders filter the browse region. */
  folderRoot: string | undefined;
  setSelectedFolder: (folder: string | null) => void;
  /** The address's history state and the notebook it names, which say what a zoomed note leaves behind it. */
  locationState: unknown;
  routeNotebook: string | null;
  handleSaveNote: ReturnType<typeof useNoteSaving>['handleSaveNote'];
  handleDeleteNote: ReturnType<typeof useDeletionUndo>['handleDeleteNote'];
  createNote: ReturnType<typeof useCreateNote>['createNote'];
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  closeCompilationZoom: ReturnType<typeof useNoteActions>['closeCompilationZoom'];
  openInFocus: ReturnType<typeof useFocusNoteNavigation>['openInFocus'];
  openFromBrowse: ReturnType<typeof useFocusNoteNavigation>['openFromBrowse'];
}

/** Compilations: their actions, a new one, and a compilation shown in zoom or in a Focus pane. */
export function useCompilations({ config, remote, folders, canWriteNotebook, repositoryFor, revisionFor, stageWorkingNote, setGitStatus, setActionError, invalidateNotes, facets, t, selectedNotebookId, folderRoot, setSelectedFolder, locationState, routeNotebook, handleSaveNote, handleDeleteNote, createNote, handleOpenNote, closeCompilationZoom, openInFocus, openFromBrowse }: Params) {
  const compilationActions = useCompilationActionsValue({ remote, canWriteNotebook, repositoryId: notebookId => repositoryFor(notebookId)?.id, revisionFor, save: handleSaveNote, remove: handleDeleteNote, stageWorkingNote, invalidateNotes, setGitStatus, createNote: options => void createNote(options) });
  const createCompilation = async (row: CompilationRow) => {
    const notebook = config?.notebooks.find(nb => nb.id === row.notebookId);
    if (!notebook) return;
    try {
      const plan = await planNewCompilation(row, notebook, '', UNTITLED_STEM, initialCompilationStatus(config?.notebooks || [], notebook.id, facets));
      void openFromBrowse(await compilationActions.create(notebook.id, plan.path, plan.content, plan.metadata));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };
  // A new compilation starts empty, named Untitled, at the notebook root; its menu edits, renames and moves it.
  const createUntitledCompilation = () => createCompilation({ id: crypto.randomUUID(), name: t('compilation.untitled'), notebookId: selectedNotebookId, path: '', view: 'small', kind: 'custom', items: [] });
  const openCompilationFolder = (item: { notebookId: string; path: string; }) => {
    // A folder of this notebook filters the browse region and keeps the Focus; others open as they do elsewhere.
    const notebook = config?.notebooks.find(nb => nb.id === item.notebookId);
    if (item.notebookId !== selectedNotebookId || !notebook || !folderRoot) return false;
    const assetRoot = `${folderRoot}/${notebook.assets || 'assets'}`;
    if (item.path === assetRoot || item.path.startsWith(`${assetRoot}/`)) return false;
    if (item.path !== folderRoot && !item.path.startsWith(`${folderRoot}/`)) return false;
    setSelectedFolder(item.path === folderRoot ? null : item.path.slice(folderRoot.length + 1));
    return true;
  };
  /** The compilation at `path` of the selected notebook, in a Focus pane (`pane`) or in zoom. */
  const renderCompilation = (path: string, pane?: string) => (
    <CompilationView
      key={`${selectedNotebookId}:${path}`}
      notebookId={selectedNotebookId}
      path={path}
      notebooks={config?.notebooks || []}
      folders={folders}
      frame={pane === undefined ? 'zoom' : 'pane'}
      // A card in a Focus pane opens its note in another pane (splitting when there is only one); in zoom, or when the Focus cannot take it, it opens in zoom.
      // A heading-anchored item always opens in zoom, scrolled to its heading.
      onOpenNote={(note, anchor) => void (async () => {
        if (anchor || pane === undefined || !await openInFocus(note, pane, 'beside')) await handleOpenNote(note, anchor);
      })()}
      onOpenFolder={openCompilationFolder}
      onClose={pane === undefined ? closeCompilationZoom : undefined}
    />
  );

  // A note opened from a zoomed compilation leaves that compilation mounted behind it.
  const behindPath = trailCompilation(locationState, routeNotebook, config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root ?? '');
  const compilationBehind = behindPath ? { notebookId: selectedNotebookId, path: behindPath } : null;
  return { compilationActions, createUntitledCompilation, renderCompilation, compilationBehind };
}
