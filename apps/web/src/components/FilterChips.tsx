import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus, X } from 'lucide-react';
import type { FilterControls } from '../lib/filter-controls.js';
import { filterChips } from '../lib/filter-chips.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { RailSectionId } from './SidebarRail.js';
import './filter-chips.css';

/**
 * The filters in force, as chips at the top of the list beside a Focus (where the sidebar is folded away): each removable one has an ✕,
 * "Clear all" drops them together, and "+ Filter" opens the sidebar section that sets one. `sections` names the sections the sidebar offers;
 * without any (the sidebar is a drawer), "+ Filter" simply opens it.
 */
export function FilterChips({ filters, sections, onAdd }: { filters: FilterControls; sections: { id: RailSectionId; label: string; }[]; onAdd: (section: RailSectionId | null) => void; }) {
  const { t } = useTranslation();
  const chips = filterChips(filters, t);
  const removable = chips.filter(chip => chip.remove).length;
  const add = sections.length > 0
    ? (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className='filter-chip filter-chip-add' aria-label={t('focusList.addFilterLabel')}>
          <Plus aria-hidden='true' />
          {t('focusList.addFilter')}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className='sidebar-tag-menu' align='start' sideOffset={4} collisionPadding={8} onCloseAutoFocus={event => event.preventDefault()}>{sections.map(section => <DropdownMenu.Item key={section.id} onSelect={() => onAdd(section.id)}>{section.label}</DropdownMenu.Item>)}</DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
    : (
      <button type='button' className='filter-chip filter-chip-add' aria-label={t('focusList.addFilterLabel')} onClick={() => onAdd(null)}>
        <Plus aria-hidden='true' />
        {t('focusList.addFilter')}
      </button>
    );
  return (
    <div role='group' aria-label={t('focusList.chips')} className='filter-chips'>
      {chips.map(chip =>
        chip.remove
          ? (
            <span key={chip.id} className='filter-chip' data-filter-chip={chip.id}>
              <span className='filter-chip-label' title={chip.label}>{chip.label}</span>
              <button type='button' className='filter-chip-remove' aria-label={t('filters.remove', { value: chip.label })} onClick={chip.remove}>
                <X aria-hidden='true' />
              </button>
            </span>
          )
          : (
            <button key={chip.id} type='button' className='filter-chip filter-chip-context' data-filter-chip={chip.id} title={chip.label} onClick={() => onAdd(chip.section)}>
              <span className='filter-chip-label'>{chip.label}</span>
            </button>
          )
      )}
      {add}
      {removable > 1 && <button type='button' className='filter-chip-clear' onClick={filters.onClear}>{t('filters.clear')}</button>}
    </div>
  );
}
