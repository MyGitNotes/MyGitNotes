import { Tooltip } from './Tooltip.js';
import { FolderInput } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
export function NoteMoveButton({ onClick, disabled = false, reason }: { onClick: () => void; disabled?: boolean; /** Why the move is refused (編輯中); disables the button. */ reason?: string; }) {
  const { t } = useTranslation();
  return (
    <Tooltip label={reason ?? t('files.moveNote')}>
      <button
        type='button'
        className='ui-icon-button'
        aria-label={t('files.moveNote')}
        disabled={disabled || Boolean(reason)}
        onClick={event => {
          event.stopPropagation();
          onClick();
        }}
      >
        <FolderInput size={16} />
      </button>
    </Tooltip>
  );
}
