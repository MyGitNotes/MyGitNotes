import { AlertCircle } from 'lucide-react';
import React from 'react';
import type { useNavigate } from 'react-router-dom';
import { LoadingStatus } from '../components/LoadingStatus.js';
import type { BoardsPageProps } from '../components/boards/BoardsPage.js';
import type { NotebookGraphPage as NotebookGraphView } from '../components/NotebookGraphPage.js';
import { fetchGitStatus } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { noteRoute } from '../lib/routes.js';
import type { FolderItem, NotebookConfig } from '../lib/types.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useWorkspaceOverview } from './useWorkspaceOverview.js';
import type { WorkspaceState } from './workspace-state.js';

const CompilationStudy = React.lazy(() => import('../components/CompilationStudy.js').then(module => ({ default: module.CompilationStudy })));
const NotebookGraphPage = React.lazy(() => import('../components/NotebookGraphPage.js').then(module => ({ default: module.NotebookGraphPage })));
const BoardsPage = React.lazy(() => import('../components/boards/BoardsPage.js').then(module => ({ default: module.BoardsPage })));

/** The notebook views of a notebook whose repository cannot serve it: why, in its place. */
export function NotebookUnavailableRoute({ notebookTitle, unavailable }: { notebookTitle: string; unavailable: NonNullable<ReturnType<typeof useWorkspaceOverview>['notebookUnavailable']>; }) {
  const { t } = useTranslation();
  return (
    <main className='workspace-route notebook-unavailable'>
      <section role='alert' className='notebook-unavailable-card'>
        <AlertCircle aria-hidden='true' />
        <div>
          <h2>{t('notebook.unavailableTitle', { title: notebookTitle })}</h2>
          <p>{t(`notebook.unavailable.${unavailable.reason}`)}</p>
          <p className='notebook-unavailable-detail'>{unavailable.message}</p>
        </div>
      </section>
    </main>
  );
}

interface StudyRouteProps {
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  notebookId: string;
  /** The selected notebook, whose compilation at `path` is studied. */
  notebook: NotebookConfig | undefined;
  path: string;
  remote: WorkspaceState['remote'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  invalidateNotes: () => void;
  setGitStatus: WorkspaceState['setGitStatus'];
  setActionError: WorkspaceState['setActionError'];
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  navigate: ReturnType<typeof useNavigate>;
}

/** A compilation studied on its own screen, which goes back to the compilation's note. */
export function StudyRoute({ notebooks, folders, notebookId, notebook, path, remote, refreshWorkspace, invalidateNotes, setGitStatus, setActionError, handleOpenNote, navigate }: StudyRouteProps) {
  const { t } = useTranslation();
  return (
    <React.Suspense fallback={<LoadingStatus className='p-8'>{t('screen.loading')}</LoadingStatus>}>
      <CompilationStudy
        key={`${notebookId}:${path}`}
        notebooks={notebooks}
        folders={folders}
        notebookId={notebookId}
        path={path}
        onStudySaved={() => {
          if (remote) void refreshWorkspace(true);
          else invalidateNotes();
          void fetchGitStatus().then(result => setGitStatus(result.status)).catch(error => setActionError((error as Error).message));
        }}
        onOpenNote={handleOpenNote}
        onBack={() => {
          navigate(notebook ? noteRoute(notebook.id, path.slice(notebook.root.length + 1)) : '/notes');
        }}
      />
    </React.Suspense>
  );
}

/** The notebook's graph, read again when the workspace's source changes (`graphKey`). */
export function GraphRoute({ graphKey, notebookId, notebooks, filters, folders }: { graphKey: string; notebookId: string; notebooks: NotebookConfig[]; filters: React.ComponentProps<typeof NotebookGraphView>['filters']; folders: FolderItem[]; }) {
  const { t } = useTranslation();
  return (
    <main className='workspace-route graph-main flex-1 w-full h-full relative min-h-0'>
      <React.Suspense fallback={<p role='status' className='p-8'>{t('graph.title')}</p>}>
        <NotebookGraphPage key={graphKey} notebookId={notebookId} notebooks={notebooks} filters={filters} folders={folders} />
      </React.Suspense>
    </main>
  );
}

/** The 白板 page: the notebook's boards, or one board with its side panel, read again when the workspace's source changes (`sourceKey`). */
export function BoardsRoute({ sourceKey, ...page }: BoardsPageProps & { sourceKey: string; }) {
  const { t } = useTranslation();
  return (
    <main className='workspace-route boards-main flex-1 w-full h-full relative min-h-0'>
      <React.Suspense fallback={<LoadingStatus className='p-8'>{t('boards.loading')}</LoadingStatus>}>
        <BoardsPage key={`${sourceKey}:${page.notebookId}`} {...page} />
      </React.Suspense>
    </main>
  );
}
