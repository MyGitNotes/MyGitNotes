import { type DragEvent, useEffect, useMemo, useState } from 'react';
import { ChevronsLeft, ChevronsRight, GripVertical, LocateFixed, Plus, Search } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { type NoteListItem, noteRefKey } from '@mygitnotes/core/note-query';
import { boardNotes, pendingNote } from '../../lib/board/add.js';
import { readBoardDrawerFolded, saveBoardDrawerFolded } from '../../lib/board/storage.js';
import { BOARD_NOTE_TYPE, draggedNote, drawerRows, dynamicSource, linkedNotes, otherBoardCounts } from '../../lib/board/drawer.js';
import type { BoardSelectionKey } from '../../lib/board/edit.js';
import type { PlacedBoard } from '../../lib/board/placement.js';
import { useDrawerNotes } from '../../lib/board/use-drawer-notes.js';
import { useNotebookBoards } from '../../lib/board/use-notebook-boards.js';
import { repositoryNotebooks } from '../../lib/compilation-rows.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { NotebookConfig } from '../../lib/types.js';
import { useDebounced } from '../../lib/use-debounced.js';
import { useNoteGraph } from '../../lib/use-note-queries.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { Tooltip } from '../Tooltip.js';
import type { BoardAdding } from './useBoardAdding.js';
import './board-drawer.css';

/** While the chips leave fewer rows than this, the drawer reads the search's next page by itself. */
const FILL = 30;

export interface BoardDrawerProps {
  row: CompilationRow;
  placed: PlacedBoard;
  selection: ReadonlySet<BoardSelectionKey>;
  notebooks: readonly NotebookConfig[];
  adding: BoardAdding;
  folded: boolean;
  onFold: (folded: boolean) => void;
}

/**
 * The 筆記庫 drawer of the 白板 page: the notes of the board's notebook (its menu offers the other notebooks of the
 * repository), searched as the Notes page searches, with the chips 「不在這塊白板」 and 「連到選取的卡片」 (the note
 * graph), and 「N 塊白板」 on a note other boards hold. A row is dragged onto the board, or 「加到白板」 places it;
 * a note the board shows offers 「在白板上找」 instead. On a dynamic board it only finds, and its foot says where the
 * board's cards come from. Folded, it is a strip with the button that opens it.
 */
export function BoardDrawer({ row, placed, selection, notebooks, adding, folded, onFold }: BoardDrawerProps) {
  const { t } = useTranslation();
  const choices = repositoryNotebooks(notebooks, row.notebookId);
  const [notebookId, setNotebookId] = useState(row.notebookId);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [offBoard, setOffBoard] = useState(true);
  const [linkedOn, setLinkedOn] = useState(false);
  const shown = useMemo(() => boardNotes(placed), [placed]);
  const selectedNotes = useMemo(() =>
    new Set([...selection].flatMap(key => {
      const card = key.startsWith('card:') ? placed.cards.find(candidate => `card:${candidate.key}` === key) : undefined;
      return card?.item.kind === 'note' ? [noteRefKey(card.item)] : [];
    })), [selection, placed]);
  const graph = useNoteGraph(linkedOn);
  const linked = useMemo(() => linkedOn ? linkedNotes(graph.graph?.links ?? [], selectedNotes) : null, [linkedOn, graph.graph, selectedNotes]);
  const found = useDrawerNotes(notebookId, q, linked);
  const rows = drawerRows(found.notes, { ...(offBoard ? { offBoard: new Set(shown.keys()) } : {}), ...(linked ? { linked } : {}) });
  const { hasMore, loadingMore, loadMore } = found;
  useEffect(() => {
    if (!folded && hasMore && !loadingMore && rows.length < FILL) loadMore();
  }, [folded, hasMore, loadingMore, rows.length, loadMore]);
  const repository = new Set(choices.map(notebook => notebook.id));
  const { boards } = useNotebookBoards(folded ? null : 'all', notebooks);
  const counts = otherBoardCounts(rows, (boards ?? []).filter(board => repository.has(board.notebookId)), row);
  const canAdd = row.kind === 'custom';
  const source = dynamicSource(row, notebooks);

  if (folded) {
    return (
      <aside className='board-drawer' data-folded='' aria-label={t('board.drawer')}>
        <Tooltip label={t('board.drawerOpen')} side='right'>
          <button type='button' className='ui-icon-button' aria-label={t('board.drawerOpen')} aria-expanded={false} onClick={() => onFold(false)}>
            <ChevronsRight size={16} aria-hidden='true' />
          </button>
        </Tooltip>
      </aside>
    );
  }
  const drag = (note: NoteListItem) => (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.setData(BOARD_NOTE_TYPE, draggedNote(note));
    event.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <aside className='board-drawer' aria-label={t('board.drawer')}>
      <header className='board-drawer-head'>
        <h2>{t('board.drawer')}</h2>
        <Tooltip label={t('board.drawerFold')}>
          <button type='button' className='ui-icon-button' aria-label={t('board.drawerFold')} aria-expanded onClick={() => onFold(true)}>
            <ChevronsLeft size={16} aria-hidden='true' />
          </button>
        </Tooltip>
      </header>
      {choices.length > 1 && <select className='ui-control board-drawer-notebook' aria-label={t('board.drawerNotebook')} value={notebookId} onChange={event => setNotebookId(event.target.value)}>{choices.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.title}</option>)}</select>}
      <label className='board-drawer-search'>
        <Search size={14} aria-hidden='true' />
        <input type='search' className='ui-control' placeholder={t('board.drawerSearch')} aria-label={t('board.drawerSearch')} value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <div className='board-drawer-chips' role='group' aria-label={t('board.drawerChips')}>
        <button type='button' className='board-drawer-chip' aria-pressed={offBoard} onClick={() => setOffBoard(!offBoard)}>{t('board.chipOffBoard')}</button>
        <button type='button' className='board-drawer-chip' aria-pressed={linkedOn} onClick={() => setLinkedOn(!linkedOn)}>{t('board.chipLinked')}</button>
      </div>
      {linkedOn && !selectedNotes.size && <p className='board-drawer-hint'>{t('board.chipLinkedNone')}</p>}
      {(found.error || graph.error) && <p role='alert' className='board-drawer-hint'>{found.error || graph.error}</p>}
      <ul className='board-drawer-list' aria-label={t('board.drawerNotes')} aria-busy={found.loading || undefined}>
        {rows.map(note => {
          const key = noteRefKey(note), card = shown.get(key), count = counts.get(key);
          // A pending live note has no Git path yet: it cannot join a board until it is checked in, and says so.
          const pending = !card && pendingNote(note), movable = canAdd && !card && !pending;
          const action = card ? t('board.findOnBoard') : t('board.addToBoard');
          return (
            <li key={key} className='board-drawer-row' draggable={movable} data-drawer-note={note.path} data-pending={pending || undefined} onDragStart={movable ? drag(note) : undefined}>
              {movable && <GripVertical className='board-drawer-grip' size={14} aria-hidden='true' />}
              <span className='board-drawer-title'>{note.title || note.path}</span>
              {count !== undefined && (
                <Tooltip label={t('board.onOtherBoards', { count: String(count) })}>
                  <span className='board-drawer-count' aria-label={t('board.onOtherBoards', { count: String(count) })}>{t('board.boardCount', { count: String(count) })}</span>
                </Tooltip>
              )}
              {(card || canAdd) && (
                <Tooltip label={pending ? t('board.pendingNote') : action}>
                  <button type='button' className='ui-icon-button board-drawer-action' aria-label={`${action}: ${note.title || note.path}`} aria-disabled={pending || undefined} onClick={() => card ? adding.find(card) : adding.addToBoard(note)}>{card ? <LocateFixed size={14} aria-hidden='true' /> : <Plus size={14} aria-hidden='true' />}</button>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && !loadingMore && !found.loading && <button type='button' className='ui-button ui-button-small board-drawer-more' onClick={loadMore}>{t('board.drawerMore')}</button>}
      {found.loading || loadingMore ? <LoadingStatus className='board-drawer-hint'>{t('notes.loading')}</LoadingStatus> : !rows.length && <p className='board-drawer-hint'>{t('board.drawerEmpty')}</p>}
      <p className='board-drawer-foot'>{source ? t(source.kind === 'tag' ? 'board.drawerTag' : 'board.drawerFolder', { name: source.name }) : t('board.drawerHint')}</p>
    </aside>
  );
}

/**
 * Whether the drawer is folded: as this device keeps it, and while a side panel is open (`panel` names its note)
 * folded to its strip, as in the approved frame, unless opened again beside that panel.
 */
export function useDrawerFold(panel: string | undefined) {
  const [stored, setStored] = useState(readBoardDrawerFolded);
  const [besidePanel, setBesidePanel] = useState<string>();
  const forced = panel !== undefined && besidePanel !== panel;
  // Folding beside a panel lasts as long as that panel; opening is kept.
  const onFold = (folded: boolean) => {
    if (panel !== undefined) setBesidePanel(folded ? undefined : panel);
    if (panel !== undefined && folded) return;
    setStored(folded);
    saveBoardDrawerFolded(folded);
  };
  return { folded: stored || forced, onFold };
}
