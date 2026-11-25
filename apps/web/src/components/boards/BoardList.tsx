import { Plus, Presentation, Zap } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { compilationRowItems } from '../../lib/compilation-content.js';
import { useLaneNotes } from '../../lib/compilation-queries.js';
import type { FolderItem, NotebookConfig } from '../../lib/types.js';
import { useCompilationAssets } from '../useCompilationItemOpen.js';
import type { BoardTile } from '../../lib/board/listing.js';
import { formatDateYMD } from '../../lib/date-utils.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';

type BoardScope = { notebooks: NotebookConfig[]; folders: FolderItem[]; };

function DynamicCounts({ row, notebooks, folders }: BoardScope & { row: Extract<CompilationRow, { kind: 'dynamic'; }>; }) {
  const { t } = useTranslation();
  const lane = useLaneNotes({ ...row, study: undefined }, { all: true });
  const assets = useCompilationAssets(notebooks, row.source.kind === 'folder' ? [row.source.notebookId] : []);
  if (lane.loading || assets.loading || lane.error || assets.error) return null;
  const items = compilationRowItems(row, lane.notes, assets.assets, notebooks, folders);
  const sections = items.filter(item => item.kind === 'heading').length;
  return (
    <>
      <span>{t('boards.cards', { count: String(items.length - sections) })}</span>
      <span>{t('boards.sections', { count: String(sections) })}</span>
    </>
  );
}

/**
 * The 白板 page's list: one tile per board of the notebook (title, description, card and section counts, last edit),
 * newest edit first, and 「新增白板」 where the notebook is writable and the screen wider than a phone.
 */
export function BoardList({ rows, notebooks, folders, tiles, error, busy = false, onOpen, onCreate }: BoardScope & { rows: CompilationRow[]; tiles: BoardTile[] | null; error: string; busy?: boolean; onOpen: (tile: BoardTile) => void; onCreate?: () => void; }) {
  const { t } = useTranslation();
  const dynamic = new Map(rows.flatMap(row => row.kind === 'dynamic' ? [[row.path, row] as const] : []));
  return (
    <section className='boards-list' aria-labelledby='boards-list-title'>
      <header className='boards-list-header'>
        <h2 id='boards-list-title'>{t('nav.boards')}</h2>
        {onCreate && (
          <Button variant='primary' disabled={busy} onClick={onCreate}>
            <Plus size={14} aria-hidden='true' />
            {t('boards.new')}
          </Button>
        )}
      </header>
      {error && <p role='alert' className='screen-error'>{error}</p>}
      {!tiles ? <LoadingStatus>{t('boards.loading')}</LoadingStatus> : !tiles.length ? <p className='boards-empty'>{t('boards.empty')}</p> : (
        <ul className='boards-tiles' aria-label={t('boards.list')}>
          {tiles.map(tile => (
            <li key={tile.path}>
              <button
                type='button'
                className='boards-tile'
                data-board-tile={tile.path}
                onClick={() => onOpen(tile)}
              >
                <span className='boards-tile-title'>
                  <Presentation size={16} aria-hidden='true' />
                  <span>{tile.title}</span>
                </span>
                {tile.description && <span className='boards-tile-description'>{tile.description}</span>}
                <span className='boards-tile-meta'>
                  {tile.source
                    ? (
                      <span>
                        <Zap size={12} aria-hidden='true' />
                        {t(tile.source === 'tag' ? 'boards.dynamicTag' : 'boards.dynamicFolder')}
                      </span>
                    )
                    : (
                      <>
                        <span>{t('boards.cards', { count: String(tile.cards ?? 0) })}</span>
                        <span>{t('boards.sections', { count: String(tile.sections ?? 0) })}</span>
                      </>
                    )}
                  {dynamic.has(tile.path) && <DynamicCounts row={dynamic.get(tile.path)!} notebooks={notebooks} folders={folders} />}
                  {tile.updated > 0 && <time dateTime={new Date(tile.updated).toISOString()}>{t('boards.edited', { date: formatDateYMD(new Date(tile.updated)) })}</time>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
