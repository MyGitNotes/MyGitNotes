import './phone-notes.css';
import { type ReactNode, type Ref, useImperativeHandle, useRef, useState } from 'react';
import { Eye, EyeOff, FolderTree, PanelLeft, Search, X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import type { SortField, SortOrder } from '../lib/note-sort.js';
import type { NotebookConfig } from '../lib/types.js';
import { ViewMode } from '../lib/types.js';
import { type NoteSearchHandle, noteSortOptions } from './NoteToolbar.js';
import { PhoneSheet } from './PhoneSheet.js';
import { Select } from './Select.js';

export interface PhoneListBarProps {
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
  notebookDisabled?: boolean;
  /** Notebooks whose repository cannot serve them; the switcher marks them. */
  unavailableNotebooks?: string[];
  /** With several repositories, the switcher lists notebooks under each repository's title. */
  notebookGroups?: { label: string; notebooks: string[]; }[];
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** Lets the "Search note text" command reach the field, opening it first. */
  searchRef?: Ref<NoteSearchHandle>;
}

/** A phone's list screen top: the sidebar drawer, the notebook switcher and the note search, in one 44px bar. */
export function PhoneListBar({ notebooks, selectedNotebookId, onSelectNotebook, notebookDisabled, unavailableNotebooks = [], notebookGroups, query, onQueryChange, filtersOpen, onToggleFilters, searchRef }: PhoneListBarProps) {
  const { t } = useTranslation();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useImperativeHandle(searchRef, () => ({
    focus: () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    },
  }), []);
  return (
    <div className='phone-list-bar' role='group' aria-label={t('phone.listBar')}>
      <button type='button' className='ui-icon-button' aria-label={t('filters.notebookPanel')} title={t('filters.notebookPanel')} aria-expanded={filtersOpen} aria-controls='notebook-panel' onClick={onToggleFilters}>
        <PanelLeft aria-hidden='true' />
      </button>
      {notebooks.length > 0 && <Select className='phone-list-notebook' aria-label={t('sidebar.notebooks')} value={selectedNotebookId} title={notebooks.find(nb => nb.id === selectedNotebookId)?.title} disabled={notebookDisabled} onValueChange={onSelectNotebook} groups={notebookGroups?.map(group => ({ label: group.label, values: group.notebooks }))} options={notebooks.map(nb => ({ value: nb.id, label: unavailableNotebooks.includes(nb.id) ? `${nb.title} · ${t('notebook.unavailable')}` : nb.title }))} />}
      <button type='button' className='ui-icon-button note-search-toggle' aria-label={t('header.searchPlaceholder')} aria-expanded={searchOpen} aria-controls='note-toolbar-search' data-active={query.trim() ? true : undefined} onClick={() => setSearchOpen(true)}>
        <Search aria-hidden='true' />
      </button>
      <div id='note-toolbar-search' className='note-toolbar-search' role='search' data-open={searchOpen || undefined}>
        <label className='note-search-field'>
          <Search size={15} aria-hidden='true' />
          <input ref={searchInput} type='search' aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={query} onChange={event => onQueryChange(event.target.value)} />
        </label>
        <button type='button' className='ui-icon-button note-search-close' aria-label={t('common.close')} onClick={() => setSearchOpen(false)}>
          <X size={16} aria-hidden='true' />
        </button>
      </div>
    </div>
  );
}

export interface PhoneFilterSheetProps {
  onClose: () => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  showHidden: boolean;
  hiddenNoteCount: number | null;
  onShowHiddenChange: (value: boolean) => void;
  /** Present while the list spans subfolders, where it can be grouped by folder. */
  groupByFolder?: { value: boolean; onChange: (value: boolean) => void; };
  /** The filter sections: status and tags. */
  children: ReactNode;
}

/** The list screen's filter sheet: how the notes are shown and ordered, then the filter sections the sidebar offers. */
export function PhoneFilterSheet({ onClose, sortField, sortOrder, onSortChange, viewMode, setViewMode, showHidden, hiddenNoteCount, onShowHiddenChange, groupByFolder, children }: PhoneFilterSheetProps) {
  const { t } = useTranslation();
  const sortOptions = noteSortOptions(t);
  return (
    <PhoneSheet title={t('phone.filterTitle')} onClose={onClose} className='phone-filter-sheet'>
      <section className='phone-sheet-section' aria-label={t('phone.display')}>
        <div className='phone-sheet-field'>
          <span>{t('filters.noteView')}</span>
          <Select aria-label={t('filters.noteView')} value={viewMode} onValueChange={value => setViewMode(value as ViewMode)} options={[{ value: 'flat', label: t('view.flat') }, { value: 'list', label: t('layout.list') }, { value: 'kanban', label: t('layout.kanban') }]} />
        </div>
        {viewMode !== 'kanban' && (
          <div className='phone-sheet-field'>
            <span>{t('sort.select')}</span>
            <Select
              aria-label={t('sort.select')}
              value={`${sortField}:${sortOrder}`}
              onValueChange={value => {
                const [field, order] = value.split(':') as [SortField, SortOrder];
                onSortChange(field, order);
              }}
              options={sortOptions}
            />
          </div>
        )}
        <button type='button' className='phone-sheet-item' aria-pressed={showHidden} onClick={() => onShowHiddenChange(!showHidden)}>
          {showHidden ? <Eye aria-hidden='true' /> : <EyeOff aria-hidden='true' />}
          <span>{t('filters.hidden')}{' ('}{hiddenNoteCount ?? '—'})</span>
        </button>
        {groupByFolder && (
          <button type='button' className='phone-sheet-item' aria-pressed={groupByFolder.value} onClick={() => groupByFolder.onChange(!groupByFolder.value)}>
            <FolderTree aria-hidden='true' />
            <span>{t('view.groupByFolder')}</span>
          </button>
        )}
      </section>
      <section className='phone-sheet-section phone-filter-sections'>{children}</section>
    </PhoneSheet>
  );
}
