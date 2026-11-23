import { Tooltip } from './Tooltip.js';
import { AlertTriangle } from 'lucide-react';
import { Select } from './Select.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';

/**
 * Says a note's frontmatter cannot be read, where its status would be: it has none to show or set until it is fixed.
 * `iconOnly` keeps the warning sign alone, named for assistive technology, where a row shows only a status dot; `announce`
 * makes it a live region, for the open note whose frontmatter may break while it is typed.
 */
export function FrontmatterInvalid({ iconOnly = false, announce = false }: { iconOnly?: boolean; announce?: boolean; }) {
  const { t } = useTranslation();
  const name = t('editor.frontmatterInvalidShort');
  return (
    <Tooltip label={t('editor.frontmatterInvalidLive')}>
      <span className='note-frontmatter-invalid' data-icon-only={iconOnly || undefined} role={announce ? 'status' : iconOnly ? 'img' : undefined} aria-label={iconOnly ? name : undefined}>
        <AlertTriangle aria-hidden='true' />
        {!iconOnly && <span>{name}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * A note's status as a coloured dot and its name, borderless; the chevron and a tint show on row hover and on focus.
 * `dotOnly` keeps just the dot, which still opens the same menu, for a row too narrow for the name. A note whose
 * frontmatter cannot be read (`unreadable`) shows that in its place, in the same size, with no menu.
 */
export function NoteStatusSelect({ status = '', statuses, readOnly, onChange, label, dotOnly = false, onOpenChange, lockedReason, unreadable = false }: { status?: string; statuses: string[]; readOnly: boolean; onChange: (status: string) => void; label: string; dotOnly?: boolean; onOpenChange?: (open: boolean) => void; /** Why the status cannot change now (編輯中), shown on the locked control. */ lockedReason?: string; unreadable?: boolean; }) {
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  const options = ['', ...statuses, ...(status && !statuses.includes(status) ? [status] : [])].map(value => ({ value, label: value ? labelOf(value) : t('notes.noStatus') }));
  const name = status ? labelOf(status) : t('notes.noStatus');

  if (unreadable) return <FrontmatterInvalid iconOnly={dotOnly} />;
  return (
    <div className='relative inline-flex items-center shrink-0 min-w-0 note-status-select max-w-[min(12rem,100%)]' onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Select
        aria-label={label}
        disabled={readOnly || Boolean(lockedReason)}
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
        tooltip={lockedReason ?? label}
      />
    </div>
  );
}
