import { Tooltip } from './Tooltip.js';
import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react';
import { BookOpen, Brain, ChevronLeft, ChevronRight, Columns2, Columns3, LayoutGrid, ListOrdered, Plus, Presentation, SlidersHorizontal, TableOfContents, Zap } from 'lucide-react';
import type { CompilationRow, CompilationSort } from '@mygitnotes/core/compilation';
import { type NotebookFacets, noteQueryStatuses } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusLabel } from '../lib/status-color.js';
import type { ScrollDirection } from '../lib/use-hold-scroll.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import './study.css';

/** What the arrangement switch marks: the whiteboard for the graph arrangement it replaces, which no file is read as any more. */
export const shownView = (view: CompilationRow['view']): Exclude<CompilationRow['view'], 'graph'> => view === 'graph' ? 'board' : view;

/** The arrangement switch: the three lane sizes, book and whiteboard. */
export const compilationViewTabs = [{ value: 'thumbnail', icon: LayoutGrid }, { value: 'small', icon: Columns3 }, { value: 'medium', icon: Columns2 }, { value: 'book', icon: BookOpen }, { value: 'board', icon: Presentation }] as const;
/** The arrangements a compilation can be switched to, in the switch's order. */
export const COMPILATION_SWITCH_VIEWS = compilationViewTabs.map(tab => tab.value);

export interface CompilationHeaderProps {
  row: CompilationRow;
  count: number;
  disabled: boolean;
  readOnly?: boolean;
  notebooks: NotebookConfig[];
  facets?: Record<string, NotebookFacets>;
  onStudy?: () => void;
  onView?: (view: CompilationRow['view']) => void;
  onAdd?: () => void;
  onSort?: (sort: CompilationSort) => void;
  /** Opens the dialog that sets a dynamic compilation's manual order. */
  onEditOrder?: () => void;
  /** Opens the dialog that arranges a custom compilation's items and chapters. */
  onArrange?: () => void;
  /** Renames the compilation from its name; absent when it cannot be renamed. */
  onRename?: () => void;
  onStudyChange?: (study: NonNullable<CompilationRow['study']>) => void;
  /** Adds a note to a dynamic compilation's source. */
  onCreateInSource?: () => void;
  /** Props for the left and right scroll buttons; absent when the arrangement does not scroll sideways. */
  scrollButton?: (direction: ScrollDirection) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** View-level actions that follow the others, such as edit, copy and delete. */
  extra?: ReactNode;
  /** Hides the status filter, which a whiteboard does not apply: its cards stay where they are placed. */
  hideQuery?: boolean;
  /** Hides the arrangement switch, as a phone does on a whiteboard, which it only shows. */
  hideArrangement?: boolean;
}

/** The compilation's name, source and the controls shared by its arrangements. */
export function CompilationHeader({ row, count, disabled, readOnly, notebooks, facets, onStudy, onView, onAdd, onSort, onEditOrder, onArrange, onRename, onStudyChange, onCreateInSource, scrollButton, extra, hideQuery = false, hideArrangement = false }: CompilationHeaderProps) {
  const { t } = useTranslation();
  const [queryOpen, setQueryOpen] = useState(false);
  const query = row.study || { filter: 'all' as const, dueFirst: false };
  const filtered = Boolean(query.status);
  const labelOf = useStatusLabel(notebooks.find(notebook => notebook.id === row.notebookId)?.statuses);
  const statuses = noteQueryStatuses(notebooks, row.notebookId, Object.keys(facets?.[row.notebookId]?.statuses || {}));
  const source = row.kind === 'dynamic' ? row.source.kind === 'tag' ? `#${row.source.tag}` : row.source.path : '';
  return (
    <header className='screen-lane-header'>
      <div className='screen-lane-heading'>
        <h3>
          {onRename && !readOnly
            ? (
              <Tooltip label={t('files.rename')}>
                <button type='button' className='title-rename' disabled={disabled} onClick={onRename}>{row.name}</button>
              </Tooltip>
            )
            : row.name}
        </h3>
        <span className='screen-count'>{count}</span>
        {row.kind === 'dynamic' && (
          <Tooltip label={t('screen.dynamicHint')}>
            <span className='screen-dynamic-label'>
              <Zap size={12} />
              {t('screen.dynamic')}
              {' · '}
              {source}
            </span>
          </Tooltip>
        )}
      </div>
      <div className='screen-lane-actions'>
        {!readOnly && !hideQuery && (
          <Tooltip label={t('screen.filtersAndSort')}>
            <Button
              type='button'
              size='icon'
              className={`screen-lane-query-toggle ${filtered ? 'is-active' : ''}`}
              aria-label={`${t('screen.filtersAndSort')}: ${row.name}`}
              aria-expanded={queryOpen}
              aria-controls={`screen-query-${row.id}`}
              onClick={() => setQueryOpen(open => !open)}
            >
              <SlidersHorizontal size={18} />
            </Button>
          </Tooltip>
        )}
        {!readOnly && !hideQuery && (
          <div id={`screen-query-${row.id}`} className='screen-lane-query' data-open={queryOpen}>
            <label className='screen-lane-filter'>
              {t('study.status')}
              <select className='ui-control' disabled={disabled} value={query.status || ''} onChange={event => onStudyChange?.({ ...query, status: event.target.value || undefined })}>
                <option value=''>{t('study.filter.all')}</option>
                {statuses.map(status => <option key={status} value={status}>{labelOf(status)}</option>)}
              </select>
            </label>
            {row.kind === 'dynamic' && (
              <div className='screen-lane-sort-group'>
                <label className='screen-lane-sort'>
                  <span>{t('sort.select')}</span>
                  <Select
                    className='screen-sort-select'
                    aria-label={`${t('sort.select')}: ${row.name}`}
                    disabled={disabled}
                    value={`${row.sort?.field || 'title'}:${row.sort?.order || 'asc'}`}
                    onValueChange={value => {
                      const [field, order] = value.split(':') as [CompilationSort['field'], CompilationSort['order']];
                      onSort?.({ field, order });
                    }}
                    options={([['updated:desc', 'sort.updatedDesc'], ['updated:asc', 'sort.updatedAsc'], ['created:desc', 'sort.createdDesc'], ['created:asc', 'sort.createdAsc'], ['title:asc', 'sort.titleAsc'], ['title:desc', 'sort.titleDesc'], ['status:asc', 'sort.status'], ...(row.manualOrder?.length || row.sort?.field === 'manual' ? [['manual:asc', 'sort.manual'] as const] : [])] as const).map(([value, label]) => ({ value, label: t(label) }))}
                  />
                </label>
                {onEditOrder && !readOnly && (
                  <Tooltip label={t('compilation.editOrder')}>
                    <Button type='button' size='icon' className='screen-lane-order' disabled={disabled} aria-label={`${t('compilation.editOrder')}: ${row.name}`} onClick={onEditOrder}>
                      <ListOrdered size={16} aria-hidden='true' />
                    </Button>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        )}
        {!readOnly && !hideArrangement && <Select className='screen-view-select' aria-label={`${t('screen.view')}: ${row.name}`} value={shownView(row.view)} disabled={disabled} onValueChange={value => onView?.(value as CompilationRow['view'])} options={COMPILATION_SWITCH_VIEWS.map(value => ({ value, label: t(`screen.${value}`) }))} />}
        {!readOnly && !hideArrangement && (
          <div className='screen-view-tabs' role='group' aria-label={`${t('screen.view')}: ${row.name}`}>
            {compilationViewTabs.map(({ value, icon: Icon }) => (
              <Tooltip key={value} label={t(`screen.${value}`)}>
                <Button
                  type='button'
                  disabled={disabled}
                  size='icon'
                  aria-label={t(`screen.${value}`)}
                  aria-pressed={shownView(row.view) === value}
                  onClick={() => onView?.(value)}
                >
                  <Icon size={16} />
                </Button>
              </Tooltip>
            ))}
          </div>
        )}
        {!readOnly && (
          <Tooltip label={t('study.start')}>
            <Button type='button' size='icon' className='screen-start-study' aria-label={`${t('study.start')}: ${row.name}`} onClick={onStudy}>
              <Brain size={18} />
            </Button>
          </Tooltip>
        )}
        {!readOnly && onArrange && row.kind === 'custom' && (
          <Tooltip label={t('compilation.arrange')}>
            <Button type='button' size='icon' className='screen-lane-arrange' disabled={disabled} aria-label={`${t('compilation.arrange')}: ${row.name}`} onClick={onArrange}>
              <TableOfContents size={16} aria-hidden='true' />
            </Button>
          </Tooltip>
        )}
        {!readOnly && (row.kind === 'custom'
          ? (
            <Button type='button' size='icon' disabled={disabled} onClick={onAdd} aria-label={`${t('screen.addItem')}: ${row.name}`}>
              <Plus size={16} />
            </Button>
          )
          : (
            <Tooltip label={t('screen.createNoteInLane')}>
              <Button type='button' size='icon' disabled={disabled} onClick={onCreateInSource} aria-label={`${t('screen.createNoteInLane')}: ${row.name}`}>
                <Plus size={16} />
              </Button>
            </Tooltip>
          ))}
        {scrollButton && (
          <>
            <Button type='button' size='icon' className='screen-lane-scroll' aria-label={`${t('screen.scrollLeft')}: ${row.name}`} {...scrollButton(-1)}>
              <ChevronLeft size={16} />
            </Button>
            <Button type='button' size='icon' className='screen-lane-scroll' aria-label={`${t('screen.scrollRight')}: ${row.name}`} {...scrollButton(1)}>
              <ChevronRight size={16} />
            </Button>
          </>
        )}
        {extra}
      </div>
      {row.description && <p className='screen-lane-description'>{row.description}</p>}
    </header>
  );
}
