import type { ReactNode } from 'react';
import { ListFilter, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { FilterPopover, type ListFilterButtonsProps } from '../ListFilterButtons.js';
import { StatusFilterBody, TagFilterBody } from '../ListFilters.js';

/** Status, live states and tags share a trigger when the board occupies the list column. */
export function KanbanFilters({ filters, counts, notebookId, tagManagement }: Pick<ListFilterButtonsProps, 'filters' | 'counts' | 'notebookId' | 'tagManagement'>) {
  const { t } = useTranslation();
  const count = Number(Boolean(filters.value.status)) + (filters.value.live?.length ?? 0) + filters.value.tags.length;
  const title = t('filters.title');
  return (
    <FilterPopover
      label={count ? `${title} (${count})` : title}
      title={title}
      active={count > 0}
      face={
        <>
          <ListFilter />
          <span className='board-button-label'>{title}</span>
          {count > 0 && <span>{count}</span>}
        </>
      }
    >
      {() => (
        <>
          <details open>
            <summary>{t('sidebar.status')}</summary>
            <StatusFilterBody filters={filters} counts={counts} />
          </details>
          <details open={filters.value.tags.length > 0}>
            <summary>{t('sidebar.tags')}</summary>
            <TagFilterBody filters={filters} counts={counts} notebookId={notebookId} management={tagManagement} />
          </details>
          {count > 0 && <button type='button' className='list-filter-clear' onClick={filters.onClear}>{t('filters.clear')}</button>}
        </>
      )}
    </FilterPopover>
  );
}

export function KanbanDisplay({ children }: { children: ReactNode; }) {
  const { t } = useTranslation();
  const title = t('browse.display');
  return (
    <FilterPopover
      label={title}
      title={title}
      face={
        <>
          <SlidersHorizontal />
          <span className='board-button-label'>{title}</span>
        </>
      }
    >
      {() => children}
    </FilterPopover>
  );
}
