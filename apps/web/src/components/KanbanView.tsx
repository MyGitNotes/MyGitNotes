import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FoldHorizontal, Plus } from 'lucide-react';
import type { NoteListItem, NoteQuery } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { SortField, SortOrder } from '../lib/note-sort.js';
import { metadataSortOptions } from '../lib/note-sort-options.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';
import { useNoteList } from '../lib/use-note-queries.js';
import type { NoteBrowseFocusMode } from '../lib/note-drag.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';
import { useKanbanPrefs } from '../lib/kanban-prefs.js';
import { FrontmatterInvalid } from './NoteStatusSelect.js';
import { LiveBadge } from './live/LiveBadge.js';
import { useLiveLock } from './live/live-drafts.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteListSentinel } from './NoteListSentinel.js';
import { NoteMoveButton } from './NoteMoveButton.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteZoomButton } from './NoteZoomButton.js';
import { Select } from './Select.js';
import { Tooltip } from './Tooltip.js';
import { type BoardContext, cardDragProps, type Column, statusQuery, useColumnDrag } from './kanban/board.js';
import { KanbanCard } from './kanban/KanbanCard.js';
import { KanbanStrip } from './kanban/KanbanStrip.js';
import { KanbanDisplay } from './kanban/KanbanToolbar.js';
import './kanban/kanban.css';

interface KanbanViewProps {
  /** The board's filter; each column adds its own status condition and pages on its own. */
  query: Partial<NoteQuery>;
  /** The folder index, which the board shows in the toolbar instead of as a card. */
  hiddenNote?: NoteListItem;
  /** The open board owns its column totals and sort overrides, but its display menu belongs in the surrounding toolbar. */
  toolbarHost?: HTMLElement | null;
  displayOptions?: React.ReactNode;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onNewNoteWithStatus: (status: string) => void;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
  /** Frontmatter fields (`metadata.<key>`) the board and column sort menus offer besides the built-in ones. */
  metadataSortFields?: readonly string[];
  /** Present while a Focus is displayed: cards get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on cards while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a card's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
}

const columnSortOptionValues = [{ value: 'updated:desc', label: 'kanban.newest' }, { value: 'updated:asc', label: 'kanban.oldest' }, { value: 'title:asc', label: 'kanban.titleAsc' }, { value: 'title:desc', label: 'kanban.titleDesc' }, { value: 'created:desc', label: 'kanban.createdNewest' }] as const;

function KanbanColumn({ col, index, board, query, hiddenNote, sort, onSort }: { col: Column; index: number; board: BoardContext; query: Partial<NoteQuery>; hiddenNote?: NoteListItem; sort: { field: SortField; order: SortOrder; }; onSort: (value: { field: SortField; order: SortOrder; }) => void; }) {
  const { t } = useTranslation();
  const hide = hiddenNote && (hiddenNote.status || '') === col.id ? hiddenNote.path : undefined;
  const result = useNoteList(statusQuery(query, col.id, sort), { hide });
  const drag = useColumnDrag(board, col.id);
  const isColumnDragOver = board.dragOverColumnId === col.id;
  const report = board.onTotal;
  useEffect(() => {
    report(col.id, result.total);
  }, [report, col.id, result.total]);
  const notes = [...result.uncommitted, ...result.notes];
  // A column with no notes rests as a strip until the person opens it; any column folds to one by hand.
  const empty = !result.loading && !result.total && !notes.length;
  if (board.foldOf(col.id, empty) === 'strip') return <KanbanStrip id={col.id} title={col.title} dot={col.color} total={result.total} over={isColumnDragOver} drop={drag} onExpand={() => board.setFold(col.id, 'open')} />;

  return (
    <div data-status-column={col.id} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} className={`kanban-column rounded-xl p-3 flex flex-col max-h-full border transition-colors shadow-xs ${isColumnDragOver ? '' : 'border-line/80'}`} style={{ backgroundColor: isColumnDragOver ? 'var(--color-primary-light)' : 'var(--color-surface)', borderColor: isColumnDragOver ? 'var(--color-primary)' : 'var(--color-line)', boxShadow: isColumnDragOver ? '0 0 0 2px var(--color-primary), 0 8px 20px -4px var(--color-primary-light)' : undefined }}>
      {/* Column Header */}
      <div className='flex items-center justify-between mb-3 px-1'>
        <div className='flex items-center gap-2 min-w-0'>
          <span className={`status-dot ${col.color}`} aria-hidden='true' />
          <h3 className='font-semibold text-fg text-sm truncate'>{col.title}</h3>
          <span className='text-xs px-2 py-0.5 rounded-full bg-fg/5 text-muted font-medium shrink-0'>{result.total}</span>
        </div>
        <div className='flex items-center gap-1.5 shrink-0'>
          {/* Column Sort Selector */}
          <Select
            aria-label={`${t('kanban.columnSort')} ${col.title}`}
            value={`${sort.field}:${sort.order}`}
            onValueChange={(val) => {
              const [field, order] = val.split(':') as [SortField, SortOrder];
              onSort({ field, order });
            }}
            options={[...columnSortOptionValues.map(option => ({ value: option.value, label: t(option.label) })), ...metadataSortOptions(t, board.metadataSortFields ?? [])]}
            className='kanban-column-sort min-h-7 px-1.5 py-1 text-[11px] font-medium'
          />
          {!board.readOnly && (
            <Tooltip label={t('kanban.addNoteTo', { title: col.title })}>
              <button type='button' onClick={() => board.onNewNoteWithStatus(col.id)} className='p-1 text-muted hover:text-fg hover:bg-fg/5 rounded-md transition' aria-label={t('kanban.addNoteTo', { title: col.title })}>
                <Plus className='w-4 h-4' />
              </button>
            </Tooltip>
          )}
          <FoldButton title={col.title} onFold={() => board.setFold(col.id, 'strip')} />
        </div>
      </div>
      {/* Note Cards List (Drag Target Area) */}
      <div className='kanban-cards overflow-y-auto space-y-2.5 flex-1 pr-0.5 min-h-[80px]'>
        {/* Drop Target Guide Indicator */}
        {isColumnDragOver && board.dragged && <div className='border-2 border-dashed rounded-lg p-3 text-center text-xs font-semibold animate-pulse transition my-1' style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'var(--color-primary-light)' }}>{t('kanban.dropNoteInto', { title: col.title })}</div>}
        {result.error && <p role='alert' className='text-xs text-danger'>{result.error}</p>}
        {result.loading && <LoadingStatus className='text-xs text-muted'>{t('notes.loading')}</LoadingStatus>}
        {!result.loading && notes.length === 0 && !isColumnDragOver ? <div className='py-8 text-center text-xs text-muted border border-dashed border-line rounded-lg'>{board.readOnly ? t('kanban.noNotes') : t('kanban.dragNotesHere')}</div> : (notes.map(note => <KanbanCard key={noteRefKey(note)} note={note} board={board} index={index} />))}
        <NoteListSentinel hasMore={result.hasMore} loading={result.loadingMore} error={result.error} onLoadMore={result.loadMore} />
      </div>
    </div>
  );
}

/** Notes the board's filter matches that carry no status; the server answers this column too. */
function KanbanUnassignedColumn({ board, query, hiddenNote, sort }: { board: BoardContext; query: Partial<NoteQuery>; hiddenNote?: NoteListItem; sort: { field: SortField; order: SortOrder; }; }) {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(board.onToggleSelect);
  const liveLock = useLiveLock();
  const hide = hiddenNote && !hiddenNote.status ? hiddenNote.path : undefined;
  const result = useNoteList(statusQuery(query, '', sort), { hide });
  const notes = [...result.uncommitted, ...result.notes];
  const drag = useColumnDrag(board, '');
  const report = board.onTotal;
  useEffect(() => {
    report('', result.total);
  }, [report, result.total]);
  if (!result.loading && !result.total && !notes.length) return null;
  // Folded only by hand: an empty no-status column leaves the board altogether.
  if (board.foldOf('', false) === 'strip') return <KanbanStrip id='' title={t('kanban.noStatus')} dot='bg-muted' total={result.total} over={board.dragOverColumnId === ''} drop={drag} onExpand={() => board.setFold('', 'open')} />;
  return (
    <div onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop} className='kanban-column rounded-xl p-3 flex flex-col max-h-full border border-dashed shadow-xs' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-line)' }}>
      <div className='flex items-center justify-between mb-3 px-1'>
        <div className='flex items-center gap-2 min-w-0'>
          <span className='w-2.5 h-2.5 rounded-full bg-muted shrink-0' />
          <h3 className='font-medium text-sm truncate' style={{ color: 'var(--color-muted)' }}>{t('kanban.noStatus')}</h3>
          <span className='text-xs px-2 py-0.5 rounded-full bg-fg/5 text-muted font-medium'>{result.total}</span>
        </div>
        <FoldButton title={t('kanban.noStatus')} onFold={() => board.setFold('', 'strip')} />
      </div>
      <div className='kanban-cards overflow-y-auto space-y-2.5 flex-1 pr-0.5'>
        {result.loading && <LoadingStatus className='text-xs text-muted'>{t('notes.loading')}</LoadingStatus>}
        {notes.map((note) => {
          const selectionActive = Boolean(board.selectedKeys?.size);
          const selected = board.selectedKeys?.has(noteRefKey(note)) ?? false;
          return (
            <Tooltip key={noteRefKey(note)} label={selectionActive ? undefined : t('notes.multiSelectHint')}>
              <div {...cardDragProps(board, note)} {...touchSelection.itemProps(note, board.onOpenNote)} className='p-3 rounded-lg border hover:shadow-xs transition cursor-grab active:cursor-grabbing' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-line)' }}>
                <div className='flex items-start gap-1.5 mb-1 min-w-0'>
                  {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => board.onToggleSelect?.(note)} className='mt-0.5' />}
                  <div className='font-medium text-fg text-sm line-clamp-2 min-w-0'>{note.title}</div>
                  {note.frontmatterInvalid && <FrontmatterInvalid iconOnly />}
                  <LiveBadge live={note.live} title={note.title} />
                </div>
                {(board.focusMode || (!board.readOnly && board.onMoveNote)) && <div className='flex justify-end items-center gap-1' onClick={event => event.stopPropagation()}>{board.focusMode && <NoteZoomButton onClick={() => board.focusMode?.onZoomNote(note)} />} {!board.readOnly && board.onMoveNote && <NoteMoveButton onClick={() => board.onMoveNote?.(note)} reason={liveLock(note, 'move')} />}</div>}
              </div>
            </Tooltip>
          );
        })}
        <NoteListSentinel hasMore={result.hasMore} loading={result.loadingMore} error={result.error} onLoadMore={result.loadMore} />
      </div>
    </div>
  );
}

const DENSITIES = [{ value: 'compact', label: 'kanban.densityCompact' }, { value: 'normal', label: 'kanban.densityNormal' }] as const;

/** Folds a column to its strip. */
function FoldButton({ title, onFold }: { title: string; onFold: () => void; }) {
  const { t } = useTranslation();
  const label = t('kanban.collapseColumn', { title });
  return (
    <Tooltip label={label}>
      <button type='button' onClick={onFold} className='p-1 text-muted hover:text-fg hover:bg-fg/5 rounded-md transition' aria-label={label} aria-expanded='true'>
        <FoldHorizontal className='w-4 h-4' />
      </button>
    </Tooltip>
  );
}

export const KanbanView: React.FC<KanbanViewProps> = ({ query, hiddenNote, toolbarHost, displayOptions, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onUpdateNoteStatus, onDeleteNote, onMoveNote, onNewNoteWithStatus, sortField = 'updated', sortOrder = 'desc', onSortChange, metadataSortFields, focusMode, selectedKeys, onToggleSelect }) => {
  const liveLock = useLiveLock();
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  const [dragged, setDragged] = useState<NoteListItem | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const columnsRef = useRef<HTMLDivElement>(null);
  useAltWheelHorizontalScroll(columnsRef, columnsRef);

  // Per-column sort override state
  const [columnSorts, setColumnSorts] = useState<Record<string, { field: SortField; order: SortOrder; }>>({});

  const columns: Column[] = statuses.map((status) => ({ id: status, title: labelOf(status), color: dotClass(status) }));

  // Board sort key: inside Kanban, 'status' defaults to 'updated'
  const effectiveBoardSortField = sortField === 'status' ? 'updated' : sortField;
  const boardSortKey = `${effectiveBoardSortField}:${sortOrder}`;

  const boardSortOptions = [{ value: 'updated:desc', label: t('sort.updatedDesc') }, { value: 'updated:asc', label: t('sort.updatedAsc') }, { value: 'created:desc', label: t('sort.createdDesc') }, { value: 'created:asc', label: t('sort.createdAsc') }, { value: 'title:asc', label: t('sort.titleAsc') }, { value: 'title:desc', label: t('sort.titleDesc') }, ...metadataSortOptions(t, metadataSortFields ?? [])];

  const [prefs, updatePrefs] = useKanbanPrefs();
  const foldOf = (id: string, empty: boolean) => prefs.columns[id] ?? (empty ? 'strip' : 'open');
  const setFold = (id: string, fold: 'strip' | 'open') => updatePrefs(current => ({ columns: { ...current.columns, [id]: fold } }));
  const board: BoardContext = { liveLocked: note => Boolean(liveLock(note, 'other')), density: prefs.density, foldOf, setFold, metadataSortFields, columns, readOnly, canDelete, confirmDelete, onOpenNote, onUpdateNoteStatus, onDeleteNote, onMoveNote, onNewNoteWithStatus, dragged, setDragged, dragOverColumnId, setDragOverColumnId, focusMode, selectedKeys, onToggleSelect, onTotal: (columnId, total) => setTotals(previous => (previous[columnId] === total ? previous : { ...previous, [columnId]: total })) };
  // Only the columns on the board count, so a status that disappeared leaves no stale total.
  const boardTotal = [...columns.map(col => col.id), ''].reduce((sum, id) => sum + (totals[id] || 0), 0);

  const display = (
    <KanbanDisplay>
      <p className='text-xs text-muted'>{t('kanban.columns', { count: columns.length })}{' · '}{t('kanban.notes', { count: boardTotal })}</p>
      {displayOptions}
      <div className='board-display-field'>
        <span>{t('kanban.density')}</span>
        <div className='kanban-density' role='group' aria-label={t('kanban.density')}>{DENSITIES.map(({ value, label }) => <button key={value} type='button' aria-pressed={prefs.density === value} onClick={() => updatePrefs({ density: value })}>{t(label)}</button>)}</div>
      </div>
      {onSortChange && (
        <div className='board-display-field'>
          <span className='text-muted font-medium whitespace-nowrap'>{t('kanban.sortBy')}</span>
          <Select
            aria-label={t('kanban.sortBy')}
            value={boardSortKey}
            onValueChange={(val) => {
              const [f, o] = val.split(':') as [SortField, SortOrder];
              setColumnSorts({});
              onSortChange(f, o);
            }}
            options={boardSortOptions}
            className='font-medium'
          />
        </div>
      )}
    </KanbanDisplay>
  );
  return (
    <div className='kanban-view flex flex-col h-full select-none'>
      {toolbarHost ? createPortal(display, toolbarHost) : toolbarHost === undefined ? display : null}
      {/* Kanban Columns List */}
      <div ref={columnsRef} data-kanban-columns='' className='kanban-columns flex gap-3 overflow-x-auto pt-1 px-1 pb-6 flex-1 items-start'>
        {columns.map((col, index) => <KanbanColumn key={col.id} col={col} index={index} board={board} query={query} hiddenNote={hiddenNote} sort={columnSorts[col.id] || { field: effectiveBoardSortField, order: sortOrder }} onSort={value => setColumnSorts(previous => ({ ...previous, [col.id]: value }))} />)}
        <KanbanUnassignedColumn board={board} query={query} hiddenNote={hiddenNote} sort={{ field: effectiveBoardSortField, order: sortOrder }} />
      </div>
    </div>
  );
};
