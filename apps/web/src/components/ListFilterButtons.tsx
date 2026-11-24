import { Tooltip } from './Tooltip.js';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FilterControls } from '../lib/filter-controls.js';
import type { ListFacets } from '../lib/list-facets.js';
import { metadataSortKey, type SortField, type SortOrder } from '../lib/note-sort.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusLabel } from '../lib/status-color.js';
import { StatusFilterBody, TagFilterBody, type TagManagement } from './ListFilters.js';
import { noteSortOptions } from './note-list-search.js';

export interface ListFilterButtonsProps {
  filters: FilterControls;
  counts: ListFacets;
  notebookId: string;
  tagManagement?: TagManagement;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  metadataSortFields?: readonly string[];
  /** The board sorts each column by itself, so it has no Sort button. */
  sortable: boolean;
  showHidden: boolean;
  /** Hidden notes in scope, or null while counting. */
  hiddenNoteCount: number | null;
  onShowHiddenChange: (value: boolean) => void;
  /** Present while the list spans subfolders, where it can be grouped by folder. */
  groupByFolder?: { value: boolean; onChange: (value: boolean) => void; };
  /** Whether the list takes in the folder's subfolders (view=flat) or only the folder itself (view=list); absent where it does not apply. */
  subfolders?: { value: boolean; onChange: (value: boolean) => void; };
}

/** The short name of each built-in sort field on the Sort button. */
const SHORT_SORT: Record<string, 'browse.sortUpdated' | 'browse.sortCreated' | 'browse.sortTitle' | 'browse.sortStatus'> = { updated: 'browse.sortUpdated', created: 'browse.sortCreated', title: 'browse.sortTitle', status: 'browse.sortStatus' };

/**
 * A button under the list header that opens a small panel below it. The panel is a non-modal dialog: Escape and a press outside close it, and
 * closing it with Escape puts the keyboard back on the button.
 */
function FilterPopover({ label, title, active = false, face, children }: { label: string; title: string; active?: boolean; /** What the button shows when it is shorter than its name, which `label` then gives it. */ face?: ReactNode; children: (close: () => void) => ReactNode; }): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // A select inside the panel (the tag sort) lists its options in a portal outside it: a press there is not a press outside.
      const inPopup = target instanceof Element && Boolean(target.closest('.select-popup'));
      if (!anchor.current?.contains(target) && !inPopup) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  // Each close the panel asks for puts the keyboard back on the button once the panel is gone; the panel's body is handed `close` while it
  // renders, so `close` itself touches no ref.
  const [closes, setCloses] = useState(0);
  useEffect(() => {
    if (closes > 0) button.current?.focus();
  }, [closes]);
  const close = () => {
    setOpen(false);
    setCloses(count => count + 1);
  };
  return (
    <div ref={anchor} className='list-filter-anchor'>
      <Tooltip label={face ? label : undefined}>
        <button ref={button} type='button' className='list-filter-button' data-active={active || undefined} aria-haspopup='dialog' aria-expanded={open} aria-controls={open ? id : undefined} aria-label={face ? label : undefined} onClick={() => setOpen(value => !value)}>
          {face ?? <span>{label}</span>}
          <ChevronDown aria-hidden='true' />
        </button>
      </Tooltip>
      {open && (
        <div
          ref={panel}
          id={id}
          role='dialog'
          aria-label={title}
          tabIndex={-1}
          className='list-filter-popover'
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
          }}
        >
          <h2>{title}</h2>
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** The Status, Tags and Sort buttons under the list header, each opening its own panel with the counts, and a way to clear the filters in force. */
export function ListFilterButtons({ filters, counts, notebookId, tagManagement, sortField, sortOrder, onSortChange, metadataSortFields, sortable, showHidden, hiddenNoteCount, onShowHiddenChange, groupByFolder, subfolders }: ListFilterButtonsProps): JSX.Element {
  const { t } = useTranslation();
  const labelOf = useStatusLabel();
  const { value } = filters;
  const sortOptions = noteSortOptions(t, metadataSortFields);
  const currentSort = sortOptions.find(option => option.value === `${sortField}:${sortOrder}`) ?? sortOptions[0];
  const [currentField = 'updated'] = currentSort.value.split(':');
  // The button shows the field and the order's icon, so Status, Tags and Sort fit one row of the list column; its name says the order in full.
  const sortFace = (
    <>
      <currentSort.Icon aria-hidden='true' />
      <span>{metadataSortKey(currentField as SortField) ?? t(SHORT_SORT[currentField] ?? 'browse.sortUpdated')}</span>
    </>
  );
  const live = value.live ?? [];
  const statusValue = [value.status ? labelOf(value.status) : null, ...live.map(state => t(state === 'editing' ? 'filters.liveEditing' : 'filters.livePending'))].filter(Boolean).join(', ') || t('browse.statusAll');
  const statusActive = Boolean(value.status) || live.length > 0;
  const inForce = statusActive || value.tags.length > 0;
  return (
    <>
      <FilterPopover label={t('browse.statusButton', { value: statusValue })} title={t('sidebar.status')} active={statusActive}>{() => <StatusFilterBody filters={filters} counts={counts} />}</FilterPopover>
      <FilterPopover label={value.tags.length > 0 ? t('browse.tagsButton', { count: value.tags.length }) : t('sidebar.tags')} title={t('sidebar.tags')} active={value.tags.length > 0}>{() => <TagFilterBody filters={filters} counts={counts} notebookId={notebookId} management={tagManagement} />}</FilterPopover>
      <FilterPopover label={sortable ? t('browse.sortButton', { value: currentSort.label }) : t('browse.display')} title={sortable ? t('sort.select') : t('browse.display')} face={sortable ? sortFace : undefined}>
        {close => (
          <>
            {sortable && sortOptions.map(option => (
              <button
                key={option.value}
                type='button'
                className='list-sort-option'
                aria-pressed={option.value === currentSort.value}
                onClick={() => {
                  const [field, order] = option.value.split(':') as [SortField, SortOrder];
                  onSortChange(field, order);
                  close();
                }}
              >
                <option.Icon aria-hidden='true' />
                <span>{option.label}</span>
              </button>
            ))}
            {sortable && <div className='list-display-separator' role='presentation' />}
            <label className='list-display-option'>
              <input
                type='checkbox'
                checked={showHidden}
                onChange={event => onShowHiddenChange(event.target.checked)}
              />
              <span>{t('filters.hidden')}{' ('}{hiddenNoteCount ?? '—'})</span>
            </label>
            {groupByFolder && (
              <label className='list-display-option'>
                <input type='checkbox' checked={groupByFolder.value} onChange={event => groupByFolder.onChange(event.target.checked)} />
                <span>{t('view.groupByFolder')}</span>
              </label>
            )}
            {subfolders && (
              <label className='list-display-option'>
                <input type='checkbox' checked={subfolders.value} onChange={event => subfolders.onChange(event.target.checked)} />
                <span>{t('browse.subfolders')}</span>
              </label>
            )}
          </>
        )}
      </FilterPopover>
      {inForce && <button type='button' className='list-filter-clear' onClick={filters.onClear}>{t('filters.clear')}</button>}
    </>
  );
}
