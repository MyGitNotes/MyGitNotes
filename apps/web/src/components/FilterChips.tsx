import { Tooltip } from './Tooltip.js';
import { Plus, X } from 'lucide-react';
import type { FilterControls } from '../lib/filter-controls.js';
import { filterChips } from '../lib/filter-chips.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusLabel } from '../lib/status-color.js';
import './filter-chips.css';

/**
 * The filters in force, as chips at the top of the list where the filters themselves are out of sight (a phone, or the board above a Focus
 * with the sidebar in a drawer): each removable one has an ✕, "Clear all" drops them together, and "+ Filter" and the notebook's chip open
 * the filters.
 */
export function FilterChips({ filters, onAdd }: { filters: FilterControls; onAdd?: () => void; }) {
  const { t } = useTranslation();
  const labelOf = useStatusLabel();
  const chips = filterChips(filters, t, labelOf);
  const removable = chips.filter(chip => chip.remove).length;
  const add = (
    <button type='button' className='filter-chip filter-chip-add' aria-label={t('focusList.addFilterLabel')} onClick={onAdd}>
      <Plus aria-hidden='true' />
      {t('focusList.addFilter')}
    </button>
  );
  // Inside the phone drawer only removable filters belong here; the drawer already provides context and actions.
  if (!onAdd && !removable) return null;
  return (
    <div role='group' aria-label={t('focusList.chips')} className='filter-chips'>
      {chips.filter(chip => onAdd || chip.remove).map(chip =>
        chip.remove
          ? (
            <span key={chip.id} className='filter-chip' data-filter-chip={chip.id}>
              <Tooltip label={chip.label}>
                <span className='filter-chip-label'>{chip.label}</span>
              </Tooltip>
              <button type='button' className='filter-chip-remove' aria-label={t('filters.remove', { value: chip.label })} onClick={chip.remove}>
                <X aria-hidden='true' />
              </button>
            </span>
          )
          : (
            <Tooltip key={chip.id} label={chip.label}>
              <button type='button' className='filter-chip filter-chip-context' data-filter-chip={chip.id} onClick={onAdd}>
                <span className='filter-chip-label'>{chip.label}</span>
              </button>
            </Tooltip>
          )
      )}
      {onAdd && add}
      {onAdd && removable > 1 && <button type='button' className='filter-chip-clear' onClick={filters.onClear}>{t('filters.clear')}</button>}
    </div>
  );
}
