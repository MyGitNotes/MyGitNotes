import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { boardTiles, compilationIndex } from '../../lib/board/listing.js';
import { useNotebookBoards } from '../../lib/board/use-notebook-boards.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteEditing } from '../../lib/note-editing.js';
import { boardsQuery, boardsRoute, legacyGraphRoute, parseWorkspaceRoute } from '../../lib/routes.js';
import type { FolderItem, NotebookConfig } from '../../lib/types.js';
import { usePhone } from '../../lib/use-phone.js';
import type { BoardPanelActions } from '../board/useBoardPanel.js';
import { CompilationView } from '../CompilationView.js';
import { BoardList } from './BoardList.js';
import './boards.css';

export interface BoardsPageProps {
  notebookId: string;
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  /** Whether the notebook takes new files: a read-only notebook has no 新增白板. */
  writable: boolean;
  /** 「開進 Focus」 and 「全螢幕」 of the side panel. */
  sidePanel: BoardPanelActions;
  /** Opens a note where the page cannot show it: a heading-anchored card in zoom at its heading, or any card on a phone. */
  onOpenNote: (note: NoteListItem, anchor?: string) => void;
  /** Creates an empty custom compilation arranged as a board (未命名白板) at the notebook root, giving its repository path. */
  onCreate: () => Promise<string | undefined>;
}

/**
 * The 白板 page (`/boards`): the notebook's boards as tiles, or one board full-window (`&board=<repository path>`) with
 * the breadcrumb 「白板 / <title>」, its side panel open on a card (`&note=`) and a card to centre (`&card=`).
 */
export function BoardsPage({ notebookId, notebooks, folders, writable, sidePanel, onOpenNote, onCreate }: BoardsPageProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const editing = useNoteEditing();
  const phone = usePhone();
  const notebook = notebooks.find(candidate => candidate.id === notebookId);
  const { board } = boardsQuery(location.search);
  const { entries, boards, error, retry } = useNotebookBoards(notebookId, notebooks);
  const tiles = useMemo(() => entries ? boardTiles(entries) : null, [entries]);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // A former graph address (`/graph`) waits for the notebook's compilations when it names one, then is replaced.
  const { legacyGraph } = parseWorkspaceRoute(location.pathname, location.search);
  const redirect = legacyGraph && notebook ? legacyGraphRoute(location.search, notebook, entries ? compilationIndex(entries) : null) : null;
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect, navigate]);

  const toList = async () => {
    if (await editing.flushEditors()) navigate(boardsRoute(notebookId));
  };
  const create = async () => {
    setCreating(true);
    setCreateError('');
    try {
      const path = await onCreate();
      if (path) navigate(boardsRoute(notebookId, path));
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  if (legacyGraph) {
    return error && !redirect
      ? (
        <div role='alert'>
          {error} <button type='button' onClick={retry}>{t('auth.retry')}</button>
        </div>
      )
      : null;
  }
  if (board) {
    const lead = (
      <nav className='boards-breadcrumb' aria-label={t('boards.breadcrumb')}>
        <button type='button' className='boards-breadcrumb-link' onClick={() => void toList()}>{t('boards.back')}</button>
        <span aria-hidden='true'>/</span>
      </nav>
    );
    return (
      <div className='boards-page' data-view='board'>
        <CompilationView key={`${notebookId}:${board}`} notebookId={notebookId} path={board} notebooks={notebooks} folders={folders} frame='page' onOpenNote={onOpenNote} onClose={() => navigate(boardsRoute(notebookId), { replace: true })} sidePanel={sidePanel} lead={lead} />
      </div>
    );
  }
  return (
    <div className='boards-page' data-view='list'>
      <BoardList rows={boards ?? []} notebooks={notebooks} folders={folders} tiles={tiles} error={createError || error} busy={creating} onOpen={tile => navigate(boardsRoute(notebookId, tile.path))} onCreate={writable && !phone ? () => void create() : undefined} />
    </div>
  );
}
