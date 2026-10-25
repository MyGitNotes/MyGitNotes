import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass } from '../lib/status-color.js';

/**
 * A note's status as a coloured dot and its name, borderless; the chevron and a tint show on row hover and on focus.
 * `dotOnly` keeps just the dot, which still opens the same menu, for a row too narrow for the name.
 */
export function NoteStatusSelect({ status = '', statuses, readOnly, onChange, label, dotOnly = false, onOpenChange }: { status?: string; statuses: string[]; readOnly: boolean; onChange: (status: string) => void; label: string; dotOnly?: boolean; onOpenChange?: (open: boolean) => void; }) {
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const options = ['', ...statuses, ...(status && !statuses.includes(status) ? [status] : [])].map(value => ({ value, label: value || t('notes.noStatus') }));
  const name = status || t('notes.noStatus');

  return (
    <div className='relative inline-flex items-center shrink-0 min-w-0 note-status-select max-w-[min(12rem,100%)]' onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Select
        aria-label={label}
        disabled={readOnly}
        value={status}
        onValueChange={onChange}
        onOpenChange={onOpenChange}
        options={options}
        icon={
          <span className='status-cell-value'>
            <span className={status ? `status-dot ${dotClass(status)}` : 'status-dot status-dot-empty'} aria-hidden='true' />
            {dotOnly ? <span className='sr-only'>{name}</span> : <span className='status-cell-name'>{name}</span>}
          </span>
        }
        className={`status-cell cursor-pointer disabled:cursor-default ${status ? '' : 'status-cell-empty'}${dotOnly ? ' status-cell-dot' : ''}`}
        title={label}
      />
    </div>
  );
}
