import { Tooltip } from './Tooltip.js';
import { Maximize2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
export function NoteZoomButton({ onClick, iconClassName = 'w-3.5 h-3.5' }: { onClick: () => void; iconClassName?: string; }) {
  const { t } = useTranslation();
  return (
    <Tooltip label={t('focus.zoomNote')}>
      <button type='button' onClick={onClick} aria-label={t('focus.zoomNote')} className='ui-icon-button'>
        <Maximize2 className={iconClassName} />
      </button>
    </Tooltip>
  );
}
