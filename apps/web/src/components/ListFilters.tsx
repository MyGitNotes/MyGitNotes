import React, { useState } from 'react';
import { FilePen, Filter, Radio, Search, Tag, X } from 'lucide-react';
import { LIVE_FILTERS, type LiveFilter } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import type { ListFacets } from '../lib/list-facets.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';
import { filterAndSortTags, getSavedTagSort, saveTagSort, type TagSort } from '../lib/tag-list.js';
import { Select } from './Select.js';
import { TagActions } from './TagActions.js';

const selectedItemStyle: React.CSSProperties = { backgroundColor: 'color-mix(in srgb, var(--color-text) 8%, transparent)', color: 'var(--color-text)' };

/** Renaming, merging and deleting a tag across the workspace, offered on each tag where the person may. */
export interface TagManagement {
  workspaceTagNames: string[];
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
}

/** The status filter: every status with its count, and the live states (編輯中, 未歸檔) where the workspace has a live editor. */
export function StatusFilterBody({ filters, counts }: { filters: FilterControls; counts: ListFacets; }): JSX.Element {
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  const { value, statuses, onChange } = filters;
  const selectedStatus = value.status;
  const selectedLive = value.live ?? [];
  const onSelectStatus = (status: string | null) => onChange({ status });
  // Either live state or both: they are kept in their fixed order.
  const onToggleLive = (state: LiveFilter) => onChange({ live: selectedLive.includes(state) ? selectedLive.filter(item => item !== state) : LIVE_FILTERS.filter(item => item === state || selectedLive.includes(item)) });
  return (
    <>
      <div className='flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider mb-1 px-2 empty:hidden'>{selectedStatus && <button type='button' onClick={() => onSelectStatus(null)} className='text-xs hover:underline capitalize' style={{ color: 'var(--color-muted)' }}>{t('sidebar.clear')}</button>}</div>
      <div className='space-y-1 text-sm'>
        <button type='button' onClick={() => onSelectStatus(null)} aria-pressed={selectedStatus === null} style={selectedStatus === null ? selectedItemStyle : undefined} className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${selectedStatus === null ? 'font-semibold hover:opacity-90' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
          <div className='flex items-center gap-2'>
            <Filter className='w-3.5 h-3.5 text-muted' />
            <span>{t('sidebar.allStatuses')}</span>
          </div>
          <span className='text-xs text-muted'>{counts.total ?? '—'}</span>
        </button>
        {statuses.map(status => {
          const count = counts.total === null ? null : counts.statuses[status] || 0;
          const isSelected = selectedStatus === status;
          return (
            <button type='button' key={status} data-status-filter={status} onClick={() => onSelectStatus(isSelected ? null : status)} aria-pressed={isSelected} style={isSelected ? selectedItemStyle : undefined} className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition ${isSelected ? 'font-semibold hover:opacity-90' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
              <div className='flex items-center gap-2'>
                <span className={`status-dot ${dotClass(status)}`} aria-hidden='true' />
                <span className='truncate'>{labelOf(status)}</span>
              </div>
              <span className='text-xs text-muted'>{count ?? '—'}</span>
            </button>
          );
        })}
      </div>
      {filters.liveAvailable && (
        <div role='group' aria-label={t('filters.live')} className='sidebar-live-filter mt-3 space-y-1 text-sm'>
          <p aria-hidden='true' className='px-2 text-xs font-semibold text-muted'>{t('filters.live')}</p>
          {LIVE_FILTERS.map(state => {
            const isSelected = selectedLive.includes(state);
            const Icon = state === 'editing' ? Radio : FilePen;
            return (
              <button type='button' key={state} data-live-filter={state} onClick={() => onToggleLive(state)} aria-pressed={isSelected} style={isSelected ? selectedItemStyle : undefined} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition ${isSelected ? 'font-semibold hover:opacity-90' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}>
                <Icon aria-hidden='true' className='w-3.5 h-3.5 shrink-0' />
                <span className='truncate'>{t(state === 'editing' ? 'filters.liveEditing' : 'filters.livePending')}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * The tag filter: a search over the tags, their order, whether a note needs any or all of the chosen tags, and every tag with its count,
 * each with the workspace's tag actions where the person may change tags. The search starts empty again in another notebook.
 */
export function TagFilterBody({ filters, counts, notebookId, management }: { filters: FilterControls; counts: ListFacets; notebookId: string; management?: TagManagement; }): JSX.Element {
  const { t, language } = useTranslation();
  const { value, onChange } = filters;
  const selectedTags = value.tags;
  const onSelectTag = (tag: string | null) => onChange({ tags: tag === null ? [] : selectedTags.includes(tag) ? selectedTags.filter(item => item !== tag) : [...selectedTags, tag] });
  const [tagQuery, setTagQuery] = useState('');
  const [tagSort, setTagSort] = useState<TagSort>(getSavedTagSort);
  const [tagNotebook, setTagNotebook] = useState(notebookId);
  if (tagNotebook !== notebookId) {
    setTagNotebook(notebookId);
    setTagQuery('');
  }
  const allTags = Object.keys(counts.tags);
  const visibleTags = filterAndSortTags(counts.tags, tagQuery, tagSort, language);
  return (
    <>
      <div className='flex items-center justify-between text-xs font-semibold text-muted uppercase tracking-wider mb-1 px-2 empty:hidden'>{selectedTags.length > 0 && <button type='button' onClick={() => onSelectTag(null)} className='text-xs hover:underline' style={{ color: 'var(--color-muted)' }}>{t('sidebar.clear')}</button>}</div>
      <div className='space-y-2 px-1 mb-2.5'>
        <div className='relative'>
          <Search aria-hidden='true' className='absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted pointer-events-none' />
          <input type='search' aria-label={t('sidebar.searchTags')} placeholder={t('sidebar.searchTags')} value={tagQuery} onChange={event => setTagQuery(event.target.value)} className='w-full min-w-0 h-9 pl-8 pr-8 rounded-lg border bg-transparent text-xs placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-muted [&::-webkit-search-cancel-button]:hidden' style={{ color: 'var(--color-text)', borderColor: 'var(--color-line-strong)' }} />
          {tagQuery && (
            <button type='button' aria-label={t('sidebar.clearTagSearch')} onClick={() => setTagQuery('')} className='absolute right-1 top-1 p-1.5 rounded-md text-muted hover:bg-fg/5'>
              <X className='w-4 h-4' />
            </button>
          )}
        </div>
        <Select
          aria-label={t('sidebar.sortTags')}
          value={tagSort}
          onValueChange={next => {
            const sort = next as TagSort;
            setTagSort(sort);
            saveTagSort(sort);
          }}
          options={[{ value: 'name-asc', label: t('sidebar.tagNameAsc') }, { value: 'name-desc', label: t('sidebar.tagNameDesc') }, { value: 'count-desc', label: t('sidebar.tagCountDesc') }, { value: 'count-asc', label: t('sidebar.tagCountAsc') }]}
          className='w-full'
          style={{ color: 'var(--color-muted)', borderColor: 'var(--color-line)' }}
        />
        <p role='status' className='text-[11px] text-muted'>{t('sidebar.tagResults', { count: visibleTags.length, total: allTags.length })}</p>
        {selectedTags.filter(tag => !visibleTags.includes(tag)).map(tag => (
          <button type='button' key={tag} className='sidebar-missing-filter' onClick={() => onSelectTag(tag)} aria-label={t('sidebar.clearActiveTag', { tag })}>
            <span>#{tag}</span>
            <X size={12} />
          </button>
        ))}
      </div>
      {visibleTags.length === 0 && <p className='px-2 py-3 text-xs text-muted'>{t('sidebar.noMatchingTags')}</p>}
      <div className='sidebar-tag-mode' role='group' aria-label={t('filters.tagMode')}>{(['any', 'all'] as const).map(mode => <button type='button' key={mode} aria-pressed={value.tagMode === mode} onClick={() => onChange({ tagMode: mode })}>{t(`filters.${mode}`)}</button>)}</div>
      <div className='sidebar-tags flex flex-wrap gap-1.5 px-1'>
        {visibleTags.map(tag => {
          const isSelected = selectedTags.includes(tag);
          const tagChip = (
            <button type='button' data-tag-filter={tag} onClick={() => onSelectTag(tag)} aria-pressed={isSelected} style={isSelected ? selectedItemStyle : undefined} className={`max-w-full inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition border ${isSelected ? 'font-semibold border-line-strong hover:opacity-90' : 'text-muted bg-surface border-line-strong hover:border-muted hover:bg-sidebar hover:text-fg'}`}>
              <Tag className='w-3 h-3 shrink-0' />
              <span className='min-w-0 break-words text-left'>{tag}</span>
              <span className={`text-[10px] ml-0.5 ${isSelected ? 'opacity-70' : 'text-muted'}`}>{counts.tags[tag]}</span>
            </button>
          );
          return (
            <div key={tag} className='inline-flex flex-col items-start gap-1 max-w-full'>
              <div className='sidebar-tag-row inline-flex items-center gap-1 max-w-full'>{management ? <TagActions tag={tag} allTags={management.workspaceTagNames} onPreviewUsage={management.onPreviewUsage} onRename={management.onRename} onMerge={management.onMerge} onDelete={management.onDelete}>{tagChip}</TagActions> : tagChip}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
