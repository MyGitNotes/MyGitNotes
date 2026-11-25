import { Plus, Presentation, Zap } from 'lucide-react';
import type { BoardTile } from '../../lib/board/listing.js';
import { formatDateYMD } from '../../lib/date-utils.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';

/**
 * The 白板 page's list: one tile per board of the notebook (title, description, card and section counts, last edit),
 * newest edit first, and 「新增白板」 where the notebook is writable and the screen wider than a phone.
 */
export function BoardList({ tiles, error, busy = false, onOpen, onCreate }: { tiles: BoardTile[] | null; error: string; busy?: boolean; onOpen: (tile: BoardTile) => void; onCreate?: () => void; }) {
  const { t } = useTranslation();
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
