import { type ReactNode, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { boardsQuery, boardsRoute, noteRoute } from '../../lib/routes.js';
import type { NotebookConfig } from '../../lib/types.js';
import { usePhone } from '../../lib/use-phone.js';
import { shownView } from '../CompilationHeader.js';
import type { CompilationContentProps } from '../CompilationCard.js';
import { BoardSidePanel } from './BoardSidePanel.js';
import { type BoardPanelActions, useBoardPanel } from './useBoardPanel.js';

interface Params {
  /** `page` is the 白板 page, which always draws the board; `zoom` and `pane` draw it when the compilation is arranged as one. */
  frame: 'zoom' | 'pane' | 'page';
  notebookId: string;
  path: string;
  row: CompilationRow | undefined;
  notebooks: readonly NotebookConfig[];
  /** Opens note cards in the side panel; without it (a Focus pane, a phone) they open where the host opens notes. */
  sidePanel: BoardPanelActions | undefined;
  /** Saves every editor of the page, before the page is left. */
  flushEditors: () => Promise<boolean>;
  /** False when the row was refused; the view shows why. */
  change: (row: CompilationRow) => boolean;
  /** False when a write failed; the view shows why. */
  save: () => Promise<boolean>;
}

/**
 * What a compilation view adds around its board: the side panel a note card opens in, the card an address names to
 * centre and select (`&card=`, on the 白板 page), and the 白板 page's arrangement switch, which leaves the page for
 * the book or a lane.
 */
export function useBoardHost({ frame, notebookId, path, row, notebooks, sidePanel, flushEditors, change, save }: Params) {
  const location = useLocation();
  const navigate = useNavigate();
  const phone = usePhone();
  const page = frame === 'page';
  const enabled = Boolean(sidePanel) && !phone;
  const query = boardsQuery(location.search);
  const panel = useBoardPanel({ enabled, owns: !page || query.board === path, row, notebooks });
  // A jump from a side panel names the card to centre and select: once per arrival at the address.
  const card = page ? query.card : null;
  const reveal = useMemo(() => card ? { card, key: location.key } : undefined, [card, location.key]);
  /**
   * Choosing the book or a lane on the 白板 page writes that arrangement and opens the compilation in zoom on the Notes
   * page, which closes back to the list, where it stays (it holds board data).
   */
  const leave = async (current: CompilationRow, view: CompilationRow['view']) => {
    if (shownView(view) === 'board') return;
    const notebook = notebooks.find(candidate => candidate.id === notebookId);
    if (!notebook || !await flushEditors()) return;
    // The file keeps a board section, empty when it had none, so the compilation stays on the 白板 page's list. A
    // refused or failed write stays on the board, where its error shows.
    if ((view !== current.view || !current.board) && (!change({ ...current, view, board: current.board ?? {} }) || !await save())) return;
    navigate(`${noteRoute(notebookId, path.slice(notebook.root.replace(/\/$/, '').length + 1))}?${new URLSearchParams({ returnTo: boardsRoute(notebookId) })}`);
  };
  /**
   * A note card opens in the side panel where there is one; a folder, asset or video, or a missing note, opens as in a
   * lane, once the panel's note is saved, since a folder or a note in zoom leaves the board.
   */
  const openCard = (open: CompilationContentProps['onOpen']): CompilationContentProps['onOpen'] => (item, note) => {
    if (item.kind === 'note' && note && enabled) return void panel.open(note);
    if (!panel.note) return open(item, note);
    void panel.saved().then(saved => saved && open(item, note));
  };
  // The board keeps its place whether the panel is open, so opening a card keeps its selection, undo and camera.
  const withPanel = (board: ReactNode, current: CompilationRow) => {
    if (!sidePanel) return board;
    return <div className='board-with-panel'>{board} {panel.note && <BoardSidePanel key={panel.note.notebookId} note={panel.note} row={current} notebooks={notebooks} actions={sidePanel} onClose={() => void panel.close()} />}</div>;
  };
  return { page, reveal, leave, openCard, withPanel, saved: panel.saved };
}
