import './note-toolbar.css';
import { type ReactNode, type Ref, useId, useImperativeHandle, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowDownZA, ArrowUpWideNarrow, CalendarArrowDown, CalendarArrowUp, ChevronDown, ClockArrowDown, ClockArrowUp, Eye, EyeOff, FileText, Folder, FolderTree, GalleryHorizontalEnd, Kanban, LayoutTemplate, List, ListOrdered, ListTree, Plus, Search, X } from 'lucide-react';
import { WorkspaceSidebarToggle } from './WorkspaceChrome.js';
import { Select } from './Select.js';
import { SelectButtonGroup, SelectButtonPrimary, SelectButtonTrigger } from './SelectButton.js';
import type { SortField, SortOrder } from '../lib/note-sort.js';
import { metadataSortOptions } from '../lib/note-sort-options.js';
import { ViewMode } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

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
  readOnly: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  onNewNote: () => void;
  /** Each of these creates at once, with default values, at the notebook root. */
  onNewCompilation: () => void;
  onNewOutline?: () => void;
  /** The notebook's note templates, each a New menu item that creates a note from it. */
  templates?: { id: string; title: string; }[];
  onNewFromTemplate?: (templateId: string) => void;
  /** Opens the notebook's Manage templates dialog from the New menu, which a read-only notebook does not show. */
  onManageTemplates?: () => void;
  /** The note search, the `q` query parameter. */
  query: string;
  onQueryChange: (query: string) => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** The Focus switcher and Layout menu. */
  focusControls?: ReactNode;
  /** Opens the legacy bookmark import from the New menu; a read-only notebook reaches it from the recovery notice instead, or from a writable notebook. */
  onImportLegacy?: () => void;
  /** Lets the "Search note text" command reach the field, opening it first on narrow screens. */
  searchRef?: Ref<NoteSearchHandle>;
  /**
   * The left browse dock beside a Focus shows the search, the sort and the display toggles at its own top, over the list they act on
   * (`NoteListTools` placed `dock`), so the toolbar leaves them out.
   */
  listToolsDocked?: boolean;
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
   * top of the left browse dock beside a Focus, the field always shown and the toggles beside it.
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
  // In the toolbar the field may be hidden behind a button (a narrow toolbar) and expands over the toolbar; in the dock it is always shown.
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
    return (
      <div className='note-list-tools' data-placement='dock'>
        <div id={searchId} className='note-list-tools-search' role='search'>{field}</div>
        {tools}
      </div>
    );
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

export function NoteToolbar({ showHidden, hiddenNoteCount, onShowHiddenChange, sortField, sortOrder, onSortChange, metadataSortFields, groupByFolder, readOnly, viewMode, setViewMode, onNewNote, onNewCompilation, onNewOutline, templates = [], onNewFromTemplate, onManageTemplates, query, onQueryChange, filtersOpen, onToggleFilters, focusControls, onImportLegacy, searchRef, listToolsDocked = false, browseCollapsed = false, utilities, onRevealSearch }: NoteToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className='header-note-actions flex items-center gap-2.5 flex-1 min-w-0 justify-end'>
      {!browseCollapsed && <WorkspaceSidebarToggle label={t('filters.notebookPanel')} open={filtersOpen} controlsId='notebook-panel' onClick={onToggleFilters} />}
      {!browseCollapsed && !listToolsDocked && <NoteListTools placement='toolbar' query={query} onQueryChange={onQueryChange} searchRef={searchRef} sortField={sortField} sortOrder={sortOrder} onSortChange={onSortChange} metadataSortFields={metadataSortFields} sortable={viewMode !== 'kanban'} showHidden={showHidden} hiddenNoteCount={hiddenNoteCount} onShowHiddenChange={onShowHiddenChange} groupByFolder={groupByFolder} />}
      {browseCollapsed && query.trim() && onRevealSearch && (
        <button type='button' className='ui-icon-button note-search-active' aria-label={`${t('header.searchPlaceholder')}: ${query.trim()}`} title={query.trim()} onClick={onRevealSearch}>
          <Search size={16} aria-hidden='true' />
        </button>
      )}
      {focusControls && <div className='note-focus-controls' role='group' aria-label={t('focus.title')}>{focusControls}</div>}
      {/* View Switcher Mobile: in place of the desktop buttons once the toolbar is too narrow for them. */}
      {!browseCollapsed && <Select aria-label={t('filters.noteView')} value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)} options={[{ value: 'flat', label: t('view.flat') }, { value: 'list', label: t('layout.list') }, { value: 'kanban', label: t('layout.kanban') }]} className='mobile-only note-view-select px-1' />}
      {/* View Switcher Desktop */}
      {!browseCollapsed && (
        <div className='desktop-views flex items-center bg-fg/5 p-1 rounded-lg gap-1 shrink-0'>
          {([{ mode: 'flat', icon: List }, { mode: 'list', icon: Folder }, { mode: 'kanban', icon: Kanban }] as const).map(({ mode, icon: Icon }) => (
            <button
              key={mode}
              type='button'
              onClick={() => setViewMode(mode)}
              title={t(`view.${mode}`)}
              aria-label={t(`view.${mode}`)}
              aria-pressed={viewMode === mode}
              style={viewMode === mode ? { backgroundColor: 'var(--color-surface)', color: 'var(--color-primary)' } : undefined}
              className={`p-1.5 rounded-md transition ${viewMode === mode ? 'shadow-xs hover:opacity-90' : 'text-muted hover:text-fg hover:bg-fg/5'}`}
            >
              <Icon className='w-4 h-4' />
            </button>
          ))}
        </div>
      )}
      {/* New Note Button: a read-only notebook shows neither the button nor its menu, which holds only what creates or imports notes and manages templates. */}
      {!readOnly && (
        <SelectButtonGroup>
          <SelectButtonPrimary aria-label={t('header.newNote')} onClick={onNewNote} className='ui-button-primary header-new-note'>
            <Plus aria-hidden='true' />
            <span>{t('header.newNote')}</span>
          </SelectButtonPrimary>
          <DropdownMenu.Root>
            <SelectButtonTrigger className='ui-button-primary' aria-label={t('header.newMenu')} title={t('header.newMenu')}>
              <ChevronDown aria-hidden='true' />
            </SelectButtonTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className='focus-menu' align='end' sideOffset={4} collisionPadding={8} aria-label={t('header.newMenu')}>
                <DropdownMenu.Item onSelect={onNewNote}>
                  <Plus size={14} aria-hidden='true' />
                  {t('header.newNote')}
                </DropdownMenu.Item>
                {onNewFromTemplate && templates.map(template => (
                  <DropdownMenu.Item
                    key={template.id}
                    onSelect={() => onNewFromTemplate(template.id)}
                  >
                    <FileText size={14} aria-hidden='true' />
                    {t('header.newFromTemplate', { template: template.title })}
                  </DropdownMenu.Item>
                ))}
                {onManageTemplates && (
                  <DropdownMenu.Item onSelect={onManageTemplates}>
                    <LayoutTemplate size={14} aria-hidden='true' />
                    {t('templates.manage')}
                  </DropdownMenu.Item>
                )}
                {onNewOutline && (
                  <DropdownMenu.Item onSelect={onNewOutline}>
                    <ListTree size={14} aria-hidden='true' />
                    {t('outline.new')}
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item onSelect={onNewCompilation}>
                  <GalleryHorizontalEnd size={14} aria-hidden='true' />
                  {t('compilation.new')}
                </DropdownMenu.Item>
                {onImportLegacy && <DropdownMenu.Item onSelect={onImportLegacy}>{t('legacyOutline.title')}</DropdownMenu.Item>}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </SelectButtonGroup>
      )}
      {utilities}
    </div>
  );
}
