import { type ReactNode, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets, NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { type BoardElementKey, drawnArrows, noteLinkLines, noteLinkNeighbours } from '../../lib/board/connections.js';
import { arrowText, cardDescription } from '../../lib/board/describe.js';
import { boardEntries } from '../../lib/board/model.js';
import { placeBoard } from '../../lib/board/placement.js';
import { readBoardNoteLinks, saveBoardNoteLinks } from '../../lib/board/storage.js';
import { compilationRowItems } from '../../lib/compilation-content.js';
import { useLaneNotes } from '../../lib/compilation-queries.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../../lib/status-color.js';
import type { FolderItem } from '../../lib/types.js';
import { useNoteGraph } from '../../lib/use-note-queries.js';
import { usePhone } from '../../lib/use-phone.js';
import { Button } from '../Button.js';
import type { CompilationContentProps } from '../CompilationCard.js';
import { CompilationHeader, type CompilationHeaderProps } from '../CompilationHeader.js';
import { LoadingStatus } from '../LoadingStatus.js';
import { BoardCanvas } from './BoardCanvas.js';
import type { CardView } from './BoardCard.js';
import { cardView } from './card-view.js';
import './board.css';

type BoardHeader = Omit<CompilationHeaderProps, 'row' | 'count' | 'notebooks' | 'scrollButton' | 'extra'>;

/**
 * The whiteboard arrangement of a compilation, drawn: its cards where the file places them and the rest auto-placed,
 * its sections, free text and arrows, the dashed links written inside its notes, and the minimap. A card opens where
 * the compilation's host opens items (`onOpen`). Nothing here edits the board or writes the file; on a phone the
 * board is for looking, without the arrangement switch or the minimap.
 */
export function CompilationBoard({ row, notebooks, assets, assetsLoading = false, folders = [], onOpen, facets, extra, ...header }: Omit<CompilationContentProps, 'notes'> & BoardHeader & { row: CompilationRow; assetsLoading?: boolean; facets?: Record<string, NotebookFacets>; extra?: ReactNode; folders?: FolderItem[]; }) {
  const { t } = useTranslation();
  const phone = usePhone();
  // A board places every member, so it reads them all, with the body each card's first lines come from. The status
  // filter of the other arrangements does not apply: it stays in the file and the board shows every member.
  const unfiltered = useMemo(() => row.study?.status ? { ...row, study: { ...row.study, status: undefined } } : row, [row]);
  const lane = useLaneNotes(unfiltered, { content: true, all: true });
  const notes = lane.notes;
  const items = useMemo(() => compilationRowItems(row, notes, assets, notebooks, folders), [row, notes, assets, notebooks, folders]);
  const board = useMemo(() => placeBoard(boardEntries(row, items), row.board?.texts), [row, items]);
  const arrows = useMemo(() => drawnArrows(board, row.board?.arrows), [board, row.board?.arrows]);
  const [showNoteLinks, setShowNoteLinks] = useState(readBoardNoteLinks);
  const graph = useNoteGraph(showNoteLinks && board.cards.filter(card => card.item.kind === 'note').length > 1);
  const noteLinks = useMemo(() => graph.graph ? noteLinkLines(board.cards, graph.graph.links) : [], [board, graph.graph]);
  const dotClass = useStatusDotClass();
  const statusLabel = useStatusLabel();

  const byNote = new Map<string, NoteListItem>(notes.map(note => [noteRefKey(note), note]));
  const views = new Map<string, CardView>(board.cards.map(card => [card.key, cardView(card, { noteAt: (notebookId, path) => byNote.get(noteRefKey({ notebookId, path })), assets, notebooks, folders, notebookId: row.notebookId, loading: lane.loading, assetsLoading, dotClass })]));
  const sectionTitles = new Map(board.sections.map(section => [section.key, section.title]));
  const textTitles = new Map(board.texts.map(text => [text.id, text.text.split('\n')[0]]));
  const titleOf = (key: BoardElementKey) => {
    const [kind, ...rest] = key.split(':'), id = rest.join(':');
    return kind === 'card' ? views.get(id)?.title ?? id : kind === 'section' ? sectionTitles.get(id) ?? id : textTitles.get(id) ?? id;
  };
  const neighbours = noteLinkNeighbours(showNoteLinks ? noteLinks : []);
  const descriptions = new Map(
    board.cards.map((card): [string, string] => {
      const view = views.get(card.key)!;
      return [card.key, cardDescription({ key: card.key, ...(view.note?.status ? { status: statusLabel(view.note.status) } : {}), ...(card.section ? { section: sectionTitles.get(card.section) } : {}), ...(view.notebook ? { notebook: view.notebook.title } : {}) }, arrows, (neighbours.get(card.key) ?? []).map(key => views.get(key)?.title ?? key), titleOf, t)];
    }).filter(([, text]) => text),
  );
  const arrowTexts = arrows.map(arrow => ({ id: arrow.id, text: arrowText(arrow, titleOf, t) }));
  const changeNoteLinks = (shown: boolean) => {
    setShowNoteLinks(shown);
    saveBoardNoteLinks(shown);
  };
  // Custom positions are known at once; a dynamic board's members arrive with the query.
  const loaded = row.kind === 'custom' || !lane.loading;
  const empty = !board.cards.length && !board.texts.length;
  return (
    <section id={`screen-lane-${row.id}`} className={`screen-lane screen-view-board board-arrangement ${row.kind === 'dynamic' ? 'screen-lane-dynamic' : ''}`}>
      <CompilationHeader {...header} row={row} count={board.cards.length} notebooks={notebooks} facets={facets} extra={phone ? undefined : extra} hideArrangement={phone} />
      {lane.error && <p role='alert' className='screen-error'>{lane.error}</p>}
      {graph.error && showNoteLinks && <p role='alert' className='screen-error'>{graph.error}</p>}
      <BoardCanvas boardKey={`${row.notebookId}:${row.path}`} title={row.name} board={board} arrows={arrows} noteLinks={noteLinks} views={views} descriptions={descriptions} arrowTexts={arrowTexts} loaded={loaded} phone={phone} showNoteLinks={showNoteLinks} onNoteLinks={changeNoteLinks} onOpen={onOpen} />
      {lane.loading && !board.cards.length && <LoadingStatus className='board-empty'>{t('notes.loading')}</LoadingStatus>}
      {empty && !lane.loading && (
        <div className='board-empty'>
          <p>{t('board.empty')}</p>
          {!header.readOnly && !header.disabled && row.kind === 'custom' && header.onAdd && (
            <Button onClick={header.onAdd}>
              <Plus size={14} aria-hidden='true' />
              {t('screen.addItem')}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
