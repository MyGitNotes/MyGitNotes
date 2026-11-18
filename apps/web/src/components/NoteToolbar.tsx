import './note-toolbar.css';
import { type ReactNode, type Ref, type RefObject, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowDownZA, ArrowUpWideNarrow, CalendarArrowDown, CalendarArrowUp, ClockArrowDown, ClockArrowUp, Eye, EyeOff, FolderTree, ListOrdered, Search, X } from 'lucide-react';
import { Select } from './Select.js';
import { type NewNoteActions, NewNoteMenu } from './NewNoteMenu.js';
import { ViewModeButtons } from './ViewModeSwitch.js';
import type { SortField, SortOrder } from '../lib/note-sort.js';
import { metadataSortOptions } from '../lib/note-sort-options.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

/**
 * The notes toolbar row under the header. On the list page and over the Kanban board it holds the list's tools at its left and the view switch at
 * its right end; beside the left dock it is not drawn at all (`notesToolbarRow`). While the header and the browse region are folded away
 * (`browseCollapsed`) only what acts on the Focus stays: the Focus controls, New, and `utilities`. Otherwise the header holds the Focus controls and New.
 */
interface NoteToolbarProps {
  showHidden: boolean;
  /** Hidden notes in scope, or null while the counts are still being answered. */
  hiddenNoteCount: number | null;
  onShowHiddenChange: (value: boolean) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  /** Frontmatter fields (`metadata.<key>`) the sort menu offers besides the built-in ones, such as the notebook's default_sort field. */
  metadataSortFields?: readonly string[];
  /** Present while the list spans subfolders, where it can be grouped by folder. */
  groupByFolder?: { value: boolean; onChange: (value: boolean) => void; };
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  /** The Focus switcher and Layout menu, given only while the header that otherwise holds them is folded away. */
  focusControls?: ReactNode;
  /** The New button's actions, given only while the header is folded away and the notebook is writable. */
  newNote?: NewNoteActions;
  /** Lets the "Search note text" command reach the field, opening it first on narrow screens. */
  searchRef?: Ref<NoteSearchHandle>;
  /** With the browse region and the header folded away only what acts on the Focus stays: the Focus controls, New, and `utilities`. */
  browseCollapsed?: boolean;
  /** The header's assistant and command buttons, shown here while the header is folded away. */
  utilities?: ReactNode;
  /** While collapsed, a search in force still dims the Focus: a button names it and reopens the browse region at the field. */
  onRevealSearch?: () => void;
}

/** The orders the notes list offers, as the sort menu lists them. */
export const noteSortOptions = (t: ReturnType<typeof useTranslation>['t'], metadataSortFields: readonly string[] = []) => [{ value: 'updated:desc', label: t('sort.updatedDesc'), Icon: ClockArrowDown }, { value: 'updated:asc', label: t('sort.updatedAsc'), Icon: ClockArrowUp }, { value: 'created:desc', label: t('sort.createdDesc'), Icon: CalendarArrowDown }, { value: 'created:asc', label: t('sort.createdAsc'), Icon: CalendarArrowUp }, { value: 'title:asc', label: t('sort.titleAsc'), Icon: ArrowDownAZ }, { value: 'title:desc', label: t('sort.titleDesc'), Icon: ArrowDownZA }, { value: 'status:asc', label: t('sort.status'), Icon: ListOrdered }, ...metadataSortOptions(t, metadataSortFields).map(option => ({ ...option, Icon: option.value.endsWith(':desc') ? ArrowDownWideNarrow : ArrowUpWideNarrow }))];

export interface NoteSearchHandle {
  focus: () => void;
}

export interface NoteListToolsProps {
  /**
   * `toolbar`: in the notes toolbar, where a narrow toolbar hides the field behind a button that opens it over the toolbar. `dock`: at the
   * top of the left browse dock beside a Focus, the field shown beside the toggles, or behind a button that opens it over the row when
   * the dock is too narrow for both.
   */
  placement: 'toolbar' | 'dock';
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  /** Lets the "Search note text" command reach the field, opening it first where it is behind a button. */
  searchRef?: Ref<NoteSearchHandle>;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortChange: (field: SortField, order: SortOrder) => void;
  metadataSortFields?: readonly string[];
  /** The sort menu is left out where the list has no order of its own (the Kanban board sorts each column). */
  sortable: boolean;
  showHidden: boolean;
  hiddenNoteCount: number | null;
  onShowHiddenChange: (value: boolean) => void;
  groupByFolder?: { value: boolean; onChange: (value: boolean) => void; };
}

/** The tools that act on the note list: the search, the sort menu, and the hidden-notes and group-by-folder toggles. */
export function NoteListTools({ placement, query, onQueryChange, searchRef, sortField, sortOrder, onSortChange, metadataSortFields, sortable, showHidden, hiddenNoteCount, onShowHiddenChange, groupByFolder }: NoteListToolsProps): JSX.Element {
  const { t } = useTranslation();
  const ids = useId();
  // In the toolbar the field may be hidden behind a button (a narrow toolbar) and expands over the toolbar; in the dock likewise when the dock is too narrow.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const sortOptions = noteSortOptions(t, metadataSortFields);
  const currentSort = sortOptions.find(option => option.value === `${sortField}:${sortOrder}`) ?? sortOptions[0];
  useImperativeHandle(searchRef, () => ({
    focus: () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInput.current?.focus());
    },
  }), []);
  const toolbar = placement === 'toolbar';
  const searchId = toolbar ? 'note-toolbar-search' : `${ids}search`;
  const field = (
    <label className='note-search-field'>
      <Search size={15} aria-hidden='true' />
      <input ref={searchInput} type='search' aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={query} onChange={event => onQueryChange(event.target.value)} />
    </label>
  );
  const tools = (
    <>
      {sortable && (
        <Select
          className='note-toolbar-sort'
          aria-label={`${t('sort.select')}: ${currentSort.label}`}
          title={`${t('sort.select')}: ${currentSort.label}`}
          value={`${sortField}:${sortOrder}`}
          onValueChange={value => {
            const [field, order] = value.split(':') as [SortField, SortOrder];
            onSortChange(field, order);
          }}
          options={sortOptions}
          icon={<currentSort.Icon size={16} aria-hidden='true' />}
        />
      )}
      <div className='note-display-options' role='group' aria-label={t('filters.title')}>
        <button type='button' className='note-display-toggle' aria-label={t('filters.hidden')} aria-pressed={showHidden} aria-describedby={`${ids}hidden`} onClick={() => onShowHiddenChange(!showHidden)}>
          {showHidden ? <Eye size={16} aria-hidden='true' /> : <EyeOff size={16} aria-hidden='true' />}
          <span id={`${ids}hidden`} role='tooltip' className='note-display-tooltip'>{t('filters.hidden')}{' ('}{hiddenNoteCount ?? '—'})</span>
        </button>
        {groupByFolder && (
          <button type='button' className='note-display-toggle' aria-label={t('view.groupByFolder')} aria-pressed={groupByFolder.value} aria-describedby={`${ids}group`} onClick={() => groupByFolder.onChange(!groupByFolder.value)}>
            <FolderTree size={16} aria-hidden='true' />
            <span id={`${ids}group`} role='tooltip' className='note-display-tooltip'>{t('view.groupByFolder')}</span>
          </button>
        )}
      </div>
    </>
  );
  if (!toolbar) {
    return <DockListTools searchId={searchId} open={searchOpen} onOpenChange={setSearchOpen} query={query} input={searchInput} field={field}>{tools}</DockListTools>;
  }
  return (
    <>
      <button type='button' className='ui-icon-button note-search-toggle' aria-label={t('header.searchPlaceholder')} aria-expanded={searchOpen} aria-controls={searchId} data-active={query.trim() ? true : undefined} onClick={() => setSearchOpen(true)}>
        <Search size={16} aria-hidden='true' />
      </button>
      <div id={searchId} className='note-toolbar-search' role='search' data-open={searchOpen || undefined}>
        {field}
        <button type='button' className='ui-icon-button note-search-close' aria-label={t('common.close')} onClick={() => setSearchOpen(false)}>
          <X size={16} aria-hidden='true' />
        </button>
      </div>
      {tools}
    </>
  );
}

/**
 * The dock's list tools. A dock too narrow for the field beside the sort and the toggles (a container query on the row's width) shows a
 * button in its place, which opens the field over the whole row; the close button and Esc fold it back to the button, and so does a click
 * outside while the field is empty. A search typed there stays open until closed, and the folded button marks a search in force.
 */
function DockListTools({ searchId, open, onOpenChange, query, input, field, children }: { searchId: string; open: boolean; onOpenChange: (open: boolean) => void; query: string; input: RefObject<HTMLInputElement | null>; field: JSX.Element; children: ReactNode; }): JSX.Element {
  const { t } = useTranslation();
  const toggle = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const active = query.trim();
  const close = () => {
    onOpenChange(false);
    toggle.current?.focus();
  };
  useEffect(() => {
    if (!open || active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, active, onOpenChange]);
  const label = active ? `${t('header.searchPlaceholder')}: ${active}` : t('header.searchPlaceholder');
  return (
    <div ref={frame} className='note-list-tools-frame'>
      <div className='note-list-tools' data-placement='dock'>
        <button
          ref={toggle}
          type='button'
          className='ui-icon-button note-search-toggle'
          aria-label={label}
          title={label}
          aria-expanded={open}
          aria-controls={searchId}
          data-active={active ? true : undefined}
          onClick={() => {
            onOpenChange(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Search size={16} aria-hidden='true' />
        </button>
        <div
          id={searchId}
          className='note-list-tools-search'
          role='search'
          data-open={open || undefined}
          onKeyDown={event => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              close();
            }
          }}
        >
          {field}
          <button type='button' className='ui-icon-button note-search-close' aria-label={t('common.close')} onClick={close}>
            <X size={16} aria-hidden='true' />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NoteToolbar({ showHidden, hiddenNoteCount, onShowHiddenChange, sortField, sortOrder, onSortChange, metadataSortFields, groupByFolder, viewMode, setViewMode, query, onQueryChange, focusControls, newNote, searchRef, browseCollapsed = false, utilities, onRevealSearch }: NoteToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className='header-note-actions flex items-center gap-2.5 flex-1 min-w-0' data-collapsed={browseCollapsed || undefined}>
      {!browseCollapsed && <NoteListTools placement='toolbar' query={query} onQueryChange={onQueryChange} searchRef={searchRef} sortField={sortField} sortOrder={sortOrder} onSortChange={onSortChange} metadataSortFields={metadataSortFields} sortable={viewMode !== 'kanban'} showHidden={showHidden} hiddenNoteCount={hiddenNoteCount} onShowHiddenChange={onShowHiddenChange} groupByFolder={groupByFolder} />}
      {browseCollapsed && query.trim() && onRevealSearch && (
        <button type='button' className='ui-icon-button note-search-active' aria-label={`${t('header.searchPlaceholder')}: ${query.trim()}`} title={query.trim()} onClick={onRevealSearch}>
          <Search size={16} aria-hidden='true' />
        </button>
      )}
      {focusControls && <div className='note-focus-controls' role='group' aria-label={t('focus.title')}>{focusControls}</div>}
      {/* The view switch at the right end, where New was before the header took it. */}
      {!browseCollapsed && <ViewModeButtons viewMode={viewMode} setViewMode={setViewMode} />}
      {/* A read-only notebook shows neither the button nor its menu. */}
      {newNote && <NewNoteMenu {...newNote} />}
      {utilities}
    </div>
  );
}
