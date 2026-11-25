import { Minus, Plus, RotateCcw, Spline } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { Tooltip } from '../Tooltip.js';

/** The board's header controls: 顯示筆記內連結 and the zoom control (− 85% + and ↺, which fits the content). */
export function BoardControls({ zoom, noteLinks, onNoteLinks, onZoom, onFit }: { zoom: number; noteLinks: boolean; onNoteLinks: (shown: boolean) => void; onZoom: (direction: 1 | -1) => void; onFit: () => void; }) {
  const { t } = useTranslation();
  return (
    <div className='board-controls' data-board-control=''>
      <Tooltip label={t('board.noteLinks')}>
        <button type='button' className='ui-icon-button board-note-links-toggle' aria-pressed={noteLinks} aria-label={t('board.noteLinks')} onClick={() => onNoteLinks(!noteLinks)}>
          <Spline size={16} aria-hidden='true' />
        </button>
      </Tooltip>
      <div className='board-zoom' role='group' aria-label={t('board.zoom')}>
        <Tooltip label={t('board.zoomOut')}>
          <button type='button' className='ui-icon-button' aria-label={t('board.zoomOut')} onClick={() => onZoom(-1)}>
            <Minus size={14} aria-hidden='true' />
          </button>
        </Tooltip>
        <span className='board-zoom-value'>{`${Math.round(zoom * 100)}%`}</span>
        <Tooltip label={t('board.zoomIn')}>
          <button type='button' className='ui-icon-button' aria-label={t('board.zoomIn')} onClick={() => onZoom(1)}>
            <Plus size={14} aria-hidden='true' />
          </button>
        </Tooltip>
        <Tooltip label={t('board.fit')}>
          <button type='button' className='ui-icon-button' aria-label={t('board.fit')} onClick={onFit}>
            <RotateCcw size={14} aria-hidden='true' />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
