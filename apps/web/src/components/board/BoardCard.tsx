import { memo } from 'react';
import { FileText, Folder, Image as ImageIcon, Youtube } from 'lucide-react';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { PlacedCard } from '../../lib/board/placement.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNotePaths } from '../../lib/use-note-queries.js';
import { useHold } from '../../lib/use-hold.js';
import type { CompilationAsset } from '../CompilationCard.js';
import { hasNotebookMark, type MarkedNotebook, notebookInitial, NotebookMark } from '../NotebookMark.js';

/** What a card shows, resolved by the board from the lane's notes and assets. */
export interface CardView {
  title: string;
  /** The first lines under the title: a note's excerpt, a heading-anchored item's heading, a folder's note count, an asset's or video's name. */
  excerpt?: string;
  note?: NoteListItem;
  asset?: CompilationAsset;
  /** The status dot's class, when the note has a status. */
  dot?: string;
  /** The notebook of a card from another notebook than the compilation's. */
  notebook?: MarkedNotebook;
  missing: boolean;
  loading: boolean;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** A folder card's count of the notes it holds, read as the lane's folder card reads them. */
function FolderCount({ item }: { item: Extract<CompilationItem, { kind: 'folder'; }>; }) {
  const { t } = useTranslation();
  const paths = useNotePaths({ notebookId: item.notebookId, folders: [item.path], descendants: true });
  return <span className='board-card-excerpt'>{paths.loading ? t('notes.loading') : t('board.folderCount', { count: String(paths.notes.length) })}</span>;
}

/**
 * One card: a button of one size at its board position, relative to its section's corner, or the board's origin.
 * It shows the status dot, title and first two lines, or zoomed out the title only (the board's CSS decides from its
 * zoom), and the mark of another notebook in its corner. Pressing it opens the item where the compilation opens items;
 * on an editable board the press also selects it. With `onHold` (a phone), a finger resting on a note's card asks for the note's menu,
 * while a finger that moves first still pans the board.
 */
export const BoardCard = memo(function BoardCard({ card, view, originX, originY, describedBy, selected, onOpen, onHold }: { card: PlacedCard; view: CardView; originX: number; originY: number; describedBy?: string; selected?: boolean; onOpen: (item: CompilationItem, note?: NoteListItem) => void; onHold?: (item: CompilationItem, note: NoteListItem) => void; }) {
  const { t } = useTranslation();
  const { item } = card;
  const { note } = view;
  const hold = useHold(onHold && note ? () => onHold(item, note) : undefined);
  const thumbnail = item.kind === 'youtube' ? `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg` : view.asset && IMAGE.test(view.asset.name) ? view.asset.rawUrl : undefined;
  const icon = item.kind === 'folder' ? <Folder aria-hidden='true' /> : item.kind === 'asset' ? <ImageIcon aria-hidden='true' /> : item.kind === 'youtube' ? <Youtube aria-hidden='true' /> : view.dot ? <span className={`status-dot board-card-dot ${view.dot}`} aria-hidden='true' /> : <FileText aria-hidden='true' />;
  return (
    <button type='button' className='board-card' data-board-card={card.key} data-board-key={`card:${card.key}`} data-selected={selected || undefined} data-kind={item.kind} data-missing={view.missing || undefined} data-other-notebook={view.notebook ? view.notebook.title : undefined} data-placed={card.placed || undefined} style={{ left: card.rect.x - originX, top: card.rect.y - originY }} aria-describedby={describedBy} data-holdable={hold.onTouchStart ? '' : undefined} {...hold} onClick={() => onOpen(item, view.note)}>
      <span className='board-card-head'>
        {icon}
        <span className='board-card-title'>{view.title}</span>
      </span>
      {thumbnail && <img className='board-card-thumbnail' src={thumbnail} alt='' loading='lazy' />}
      {view.missing ? <span className='board-card-excerpt board-card-missing'>{t('board.missing')}</span> : item.kind === 'folder' ? <FolderCount item={item} /> : view.excerpt ? <span className='board-card-excerpt'>{view.excerpt}</span> : view.loading ? <span className='board-card-excerpt'>{t('notes.loading')}</span> : null}
      {view.notebook && <span className='board-card-notebook' aria-hidden='true'>{hasNotebookMark(view.notebook) ? <NotebookMark notebook={view.notebook} size='tab' /> : <span className='board-card-initial'>{notebookInitial(view.notebook.title)}</span>}</span>}
    </button>
  );
});
