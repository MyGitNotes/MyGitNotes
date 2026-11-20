import { type ReactNode, useEffect, useRef } from 'react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AlertCircle, GripVertical } from 'lucide-react';
import type { BookEntry } from '../lib/book-chapters.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

export interface BookContentsProps {
  entries: readonly BookEntry[];
  /** A contents anchor maps to an item only when that row can move; folder note sections have no item of their own. */
  dragItems?: ReadonlyMap<string, ContentsDragItem>;
  /** The anchor of the entry in view. */
  active: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onJump: (anchor: string) => void;
}

interface ContentsDragItem {
  id: string;
  chapterId?: string;
}

/** The contents keep the entry in view visible. Each entry jumps to its section; orderable entries also have a separate handle. */
export function BookContents({ entries, dragItems, active, hasMore, loadingMore, onLoadMore, onJump }: BookContentsProps) {
  const { t } = useTranslation();
  const nav = useRef<HTMLElement>(null);
  // The list scrolls itself, not the page, to keep the highlighted entry visible.
  useEffect(() => {
    const list = nav.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !current) return;
    const bounds = list.getBoundingClientRect(), entry = current.getBoundingClientRect();
    if (entry.top < bounds.top) list.scrollTop -= bounds.top - entry.top;
    else if (entry.bottom > bounds.bottom) list.scrollTop += entry.bottom - bounds.bottom;
  }, [active]);
  return (
    <nav ref={nav} className='compilation-book-contents' aria-label={t('book.contents')}>
      <SortableContext items={dragItems ? [...dragItems.values()].map(item => item.id) : []} strategy={verticalListSortingStrategy}>
        <ol>
          {entries.map(entry => {
            const dragItem = dragItems?.get(entry.anchor);
            const jump = (
              <button type='button' className='compilation-book-jump' aria-current={entry.anchor === active ? 'location' : undefined} title={entry.title} onClick={() => onJump(entry.anchor)}>
                <span>{entry.title}</span>
                {entry.missing && <AlertCircle size={13} role='img' aria-label={t('screen.missing')} />}
              </button>
            );
            return dragItem ? <SortableContentsRow key={entry.anchor} entry={entry} dragItem={dragItem}>{jump}</SortableContentsRow> : <li key={entry.anchor} data-level={entry.level} data-heading={entry.heading || undefined}>{jump}</li>;
          })}
        </ol>
      </SortableContext>
      {hasMore && <Button type='button' className='compilation-book-load-more' disabled={loadingMore} onClick={onLoadMore}>{t('book.loadMore')}</Button>}
    </nav>
  );
}

/** The drop target is tinted rather than shifting rows: plain folder sub-sections must stay with their parent. */
function SortableContentsRow({ entry, dragItem, children }: { entry: BookEntry; dragItem: ContentsDragItem; children: ReactNode; }) {
  const { t } = useTranslation();
  const { id, chapterId } = dragItem;
  const sort = useSortable({ id, data: { chapterId, title: entry.title } });
  /* eslint-disable react/refs -- dnd-kit exposes callback refs and render state, not values read from refs. */
  return (
    <li ref={sort.setNodeRef} data-level={entry.level} data-heading={entry.heading || undefined} data-drop-target={sort.isOver && !sort.isDragging || undefined} data-dragging={sort.isDragging || undefined}>
      <Button type='button' size='icon' ref={sort.setActivatorNodeRef} {...sort.attributes} {...sort.listeners} className='screen-drag-handle' data-key-scope='book-reorder' aria-label={`${t(entry.heading ? 'compilation.moveChapter' : 'screen.moveItem')}: ${entry.title}`}>
        <GripVertical size={14} aria-hidden='true' />
      </Button>
      {children}
    </li>
  );
  /* eslint-enable react/refs */
}
