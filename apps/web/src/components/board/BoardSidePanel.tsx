import { Fragment, type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Maximize2, X } from 'lucide-react';
import { boardsContaining, type CompilationRow } from '@mygitnotes/core/compilation';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { boardCardKey } from '../../lib/board/panel.js';
import { clampPanelWidth, readBoardPanelWidth, saveBoardPanelWidth } from '../../lib/board/storage.js';
import { useNotebookBoards } from '../../lib/board/use-notebook-boards.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteEditing } from '../../lib/note-editing.js';
import { boardsRoute } from '../../lib/routes.js';
import type { NotebookConfig } from '../../lib/types.js';
import { useNoteLookup } from '../../lib/use-note-queries.js';
import { Button } from '../Button.js';
import { HostedNoteEditor } from '../NoteEditorHost.js';
import { Tooltip } from '../Tooltip.js';
import type { BoardPanelActions } from './useBoardPanel.js';
import './board-panel.css';

const KEY_STEP = 16;

/**
 * The side panel of a board (白板筆記欄): the note of the card opened, in the hosted editor a Focus pane uses, so it is
 * edited in place with the same drafts, saving and live checkout. Its head has the note's path, 「開進 Focus」 (only for
 * a note of the notebook whose Focus it is), 「全螢幕」 and ✕; under it the boards of the notebook that hold the note,
 * each opening that board with the note's card centred and selected. Its divider resizes it; the width is kept on this device.
 */
export function BoardSidePanel({ note, row, notebooks, actions, leaving = false, onClose }: { note: NoteRef; row: CompilationRow; notebooks: readonly NotebookConfig[]; actions: BoardPanelActions; /** Back or Forward waits for its note to be saved: it takes no input meanwhile. */ leaving?: boolean; onClose: () => void; }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const editing = useNoteEditing();
  const hint = useId();
  const [width, setWidth] = useState(readBoardPanelWidth);
  const drag = useRef<{ x: number; width: number; } | null>(null);
  const aside = useRef<HTMLElement>(null);
  // React 18 has no `inert` prop: the attribute keeps typing out of the editor while its note is saved for Back or Forward.
  useEffect(() => {
    if (leaving) aside.current?.setAttribute('inert', '');
    else aside.current?.removeAttribute('inert');
  }, [leaving]);
  const lookup = useNoteLookup([note], false);
  const listed = lookup.notes[0];
  // The boards of the board's notebook, and of the note's own when it lies in another notebook of the repository.
  const own = useNotebookBoards(row.notebookId, notebooks).boards;
  const theirs = useNotebookBoards(note.notebookId === row.notebookId ? null : note.notebookId, notebooks).boards;
  const holding = boardsContaining(note, [...own ?? [], ...theirs ?? []], listed ? [listed] : []);
  const otherNotebook = note.notebookId !== actions.focusNotebook;
  const resize = (next: number) => {
    const value = clampPanelWidth(next);
    setWidth(value);
    saveBoardPanelWidth(value);
  };
  const jump = async (board: CompilationRow) => {
    if (!await editing.flushEditors([noteRefKey(note)])) return;
    navigate(boardsRoute(board.notebookId, board.path, { note: note.path, card: boardCardKey(board, note) }));
  };
  const divider = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag.current) setWidth(clampPanelWidth(drag.current.width + drag.current.x - event.clientX));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      resize(drag.current.width + drag.current.x - event.clientX);
      drag.current = null;
    },
    onPointerCancel: () => drag.current = null,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      resize(width + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP));
    },
  };
  const focusButton = (
    <Button size='small' disabled={otherNotebook || !listed} aria-describedby={otherNotebook ? hint : undefined} onClick={() => listed && actions.openInFocus(listed)}>
      <LayoutGrid size={14} aria-hidden='true' />
      {t('board.openInFocus')}
    </Button>
  );
  return (
    <aside ref={aside} className='board-side-panel' style={{ width }} aria-label={t('board.panel')} aria-busy={leaving || undefined} data-board-panel={note.path}>
      <div className='board-panel-divider' role='separator' tabIndex={0} aria-orientation='vertical' aria-label={t('board.panelResize')} aria-valuenow={width} aria-valuemin={clampPanelWidth(0)} aria-valuemax={clampPanelWidth(Infinity)} {...divider} />
      <header className='board-panel-head'>
        <span className='board-panel-path' title={note.path}>{note.path}</span>
        {otherNotebook
          ? (
            <Tooltip label={t('board.openInFocusOther')}>
              <span>{focusButton}</span>
            </Tooltip>
          )
          : focusButton}
        {otherNotebook && <span id={hint} hidden>{t('board.openInFocusOther')}</span>}
        <Button size='small' disabled={!listed} onClick={() => listed && actions.fullscreen(listed)}>
          <Maximize2 size={14} aria-hidden='true' />
          {t('board.fullscreen')}
        </Button>
        <Tooltip label={t('board.closePanel')}>
          <Button size='icon' aria-label={t('board.closePanel')} onClick={onClose}>
            <X size={16} aria-hidden='true' />
          </Button>
        </Tooltip>
      </header>
      {holding.length > 0 && (
        <p className='board-panel-boards'>
          {t('board.onBoards', { count: String(holding.length) })}
          {holding.map((board, index) => (
            <Fragment key={`${board.notebookId}:${board.path}`}>
              {index > 0 && <span aria-hidden='true'>・</span>}
              <button
                type='button'
                className='board-panel-board'
                aria-label={t('board.jumpTo', { title: board.name })}
                onClick={() => void jump(board)}
              >
                {board.name}
              </button>
            </Fragment>
          ))}
        </p>
      )}
      <div className='board-panel-editor'>
        <HostedNoteEditor notebookId={note.notebookId} path={note.path} frame='pane' active />
      </div>
    </aside>
  );
}
