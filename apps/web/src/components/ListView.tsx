import { NoteMoveButton } from './NoteMoveButton.js';
import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, GalleryHorizontalEnd, Trash2 } from 'lucide-react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { NoteTagActions, NoteTags } from './NoteTags.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { Select } from './Select.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { noteUpdatedTime, SortField, SortOrder } from '../lib/note-sort.js';
import { useTranslation } from '../lib/i18n/index.js';
import { highlightSegments } from '../lib/search-highlight.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { type NoteBrowseFocusMode, pointerMovesNotes, startNoteDrag } from '../lib/note-drag.js';
import { HighlightText } from './HighlightText.js';
import { type BrowseKind, NotesEmptyState } from './NotesEmptyState.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteZoomButton } from './NoteZoomButton.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';
import type { NoteGroupOf } from '../lib/note-groups.js';
import { NoteGroupHeading } from './NoteGroupHeading.js';

export interface ListViewProps {
  notes: NoteListItem[];
  /** Staged drafts the server cannot return yet; listed above the committed rows. */
  uncommitted?: NoteListItem[];
  hasFolderEntries?: boolean;
  /** The first page is still in flight, so nothing is known to be missing yet. */
  loading?: boolean;
  statuses: string[];
  readOnly?: boolean;
  canDelete?: boolean;
  confirmDelete?: boolean;
  onOpenNote: (note: NoteListItem) => void;
  onDeleteNote: (note: NoteListItem) => void;
  onMoveNote?: (note: NoteListItem) => void;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => void;
  onNewNote: () => void;
  /** What the list shows, so its empty state offers to create the same kind. */
  newKind?: BrowseKind;
  sortField?: SortField;
  sortOrder?: SortOrder;
  onSortChange?: (field: SortField, order?: SortOrder) => void;
  showMobileSort?: boolean;
  tagActions?: NoteTagActions;
  /** Present while a Focus is displayed: rows get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** An entry listed as the first row, such as the folder index in the flat view. */
  leading?: React.ReactNode;
  /** Active search text: highlights matches in the title and shows a matched-content snippet. */
  highlightQuery?: string;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on rows while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a row's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
  /** Present while the notes come grouped by folder: a header row starts each folder. */
  groupOf?: NoteGroupOf;
  /** Group keys whose notes are hidden under their heading. */
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
}

interface NoteRowActions {
  open: (note: NoteListItem) => void;
  remove: (note: NoteListItem) => void;
  move: (note: NoteListItem) => void;
  status: (note: NoteListItem, status: string) => void;
  zoom: (note: NoteListItem) => void;
  toggleSelect: (note: NoteListItem) => void;
}

const NoteRow = React.memo(function NoteRow({ note, statuses, readOnly, canDelete, isPendingDelete, actions, dates, tagActions, showZoom, canDrag, canMove, draft = false, highlightQuery = '', selected, selectionActive }: { note: NoteListItem; draft?: boolean; tagActions?: NoteTagActions; statuses: string[]; readOnly: boolean; canDelete: boolean; isPendingDelete: boolean; actions: NoteRowActions; dates: { short: Intl.DateTimeFormat; full: Intl.DateTimeFormat; }; showZoom?: boolean; canDrag?: boolean; canMove?: boolean; highlightQuery?: string; selected: boolean; selectionActive: boolean; }) {
  const { t } = useTranslation();
  // A draft row lifts no more than a draft card does (CardView), so on touch it only opens.
  const touchSelection = useNoteTouchSelection(actions.toggleSelect, canMove && !draft);
  const dragsToMove = Boolean(canMove) && pointerMovesNotes();
  const updated = noteUpdatedTime(note);
  const formattedDate = updated ? dates.short.format(updated) : '—';
  // The path is the title's tooltip; while a search matches it, it also shows after the title with the match marked, so a row found by its path says why.
  const pathMatched = highlightSegments(note.path, highlightQuery).some(segment => segment.match);
  return (
    <tr {...touchSelection.itemProps(note, actions.open)} title={selectionActive ? undefined : t('notes.multiSelectHint')} draggable={canDrag || dragsToMove} onDragStart={canDrag || dragsToMove ? event => startNoteDrag(event, note, { focus: Boolean(canDrag), move: dragsToMove }) : undefined} className='hover:bg-fg/5 transition cursor-pointer group'>
      <td className='py-2 px-3'>
        <div className='flex items-center gap-2.5'>
          {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => actions.toggleSelect(note)} />}
          {isCompilationPath(note.path) ? <GalleryHorizontalEnd className='w-4 h-4 text-primary shrink-0' aria-hidden='true' /> : <FileText className='w-4 h-4 text-primary shrink-0' />}
          <div className='min-w-0 flex-1'>
            <div className='font-medium text-fg transition flex items-center gap-1.5' title={note.path}>
              <span className='note-row-title'>
                <HighlightText text={note.title} query={highlightQuery} />
              </span>
              {note.path.endsWith('.mdx') && <span className='shrink-0 text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/40 leading-none'>MDX</span>}
              {pathMatched && (
                <span className='note-row-path font-mono'>
                  <HighlightText text={note.path} query={highlightQuery} />
                </span>
              )}
            </div>
            {note.matchSnippet && (
              <div className='text-xs text-muted mt-0.5 line-clamp-2'>
                <HighlightText text={note.matchSnippet} query={highlightQuery} />
              </div>
            )}
          </div>
        </div>
      </td>
      {/* In-Table Selectable Status */}
      <td className='py-2 px-3'>
        <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={(status) => actions.status(note, status)} />
      </td>
      <td className='py-2 px-3'>{note.tags.length > 0 ? <NoteTags tags={note.tags} oneLine tagActions={tagActions} /> : <span className='text-xs text-muted'>—</span>}</td>
      <td className='py-2 px-3 text-xs text-muted whitespace-nowrap tabular-nums'>
        <time dateTime={updated ? new Date(updated).toISOString() : undefined} title={updated ? dates.full.format(updated) : undefined}>{formattedDate}</time>
      </td>
      {/* Actions Column */}
      <td className='py-2 px-3 text-right'>
        <div className='note-row-actions flex items-center justify-end' data-confirming={isPendingDelete || undefined} onClick={(e) => e.stopPropagation()}>
          {showZoom && <NoteZoomButton onClick={() => actions.zoom(note)} iconClassName='w-4 h-4' />}
          {!readOnly && <NoteMoveButton onClick={() => actions.move(note)} />}
          {!readOnly && canDelete && (
            <button
              type='button'
              onClick={() => actions.remove(note)}
              title={isPendingDelete ? t('notes.confirmDelete') : t('notes.delete')}
              className={isPendingDelete ? 'p-1.5 text-on-danger bg-danger hover:bg-danger/90 rounded-lg transition' : 'p-1.5 text-muted hover:text-danger hover:bg-danger-soft rounded-lg transition'}
            >
              <Trash2 className='w-4 h-4' />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export const ListView: React.FC<ListViewProps> = ({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onUpdateNoteStatus, onNewNote, newKind, sortField = 'updated', sortOrder = 'desc', onSortChange, showMobileSort = false, tagActions, focusMode, leading, highlightQuery = '', selectedKeys, onToggleSelect, groupOf, collapsedGroups, onToggleGroup }) => {
  const { t, language } = useTranslation();
  // Rows retain stable actions while invoking the latest committed callbacks.
  const handlers = useRef({ onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote, focusMode, onToggleSelect });
  useLayoutEffect(() => {
    handlers.current = { onOpenNote, onDeleteNote, onUpdateNoteStatus, onMoveNote, focusMode, onToggleSelect };
  });
  const notesRef = useRef(notes);
  useLayoutEffect(() => {
    notesRef.current = [...uncommitted, ...notes];
  });
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = notesRef.current.find(n => noteRefKey(n) === path);
    if (note) handlers.current.onDeleteNote(note);
  });
  const movable = !readOnly && Boolean(onMoveNote);
  const actions = useMemo<NoteRowActions>(() => ({ open: note => handlers.current.onOpenNote(note), remove: note => requestDelete(noteRefKey(note)), move: note => handlers.current.onMoveNote?.(note), status: (note, status) => handlers.current.onUpdateNoteStatus(note, status), zoom: note => handlers.current.focusMode?.onZoomNote(note), toggleSelect: note => handlers.current.onToggleSelect?.(note) }), [requestDelete]);
  const dates = useMemo(() => ({ short: new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit' }), full: new Intl.DateTimeFormat(language, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }) }), [language]);

  const isEmpty = !loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries;

  if (isEmpty) {
    return <NotesEmptyState readOnly={readOnly} kind={newKind} onNewNote={onNewNote} />;
  }

  const renderSortHeader = (field: SortField, label: string, className = '') => {
    const isActive = sortField === field;

    return (
      <th className={`py-1.5 px-3 select-none ${className}`}>
        {onSortChange
          ? (
            <button type='button' onClick={() => onSortChange(field)} className='group inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg transition'>
              <span>{label}</span>
              {isActive ? (sortOrder === 'asc' ? <ArrowUp className='w-3.5 h-3.5 text-primary' /> : <ArrowDown className='w-3.5 h-3.5 text-primary' />) : <ArrowUpDown className='w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition text-muted' />}
            </button>
          )
          : <span>{label}</span>}
      </th>
    );
  };

  return (
    <>
      {showMobileSort && notes.length > 0 && onSortChange && (
        <div className='note-list-mobile-sort mobile-only items-center gap-2 mb-4'>
          <ArrowUpDown className='w-3.5 h-3.5 text-muted shrink-0' aria-hidden='true' />
          <Select
            aria-label={t('sort.select')}
            value={`${sortField}:${sortOrder}`}
            onValueChange={value => {
              const [field, order] = value.split(':') as [SortField, SortOrder];
              onSortChange(field, order);
            }}
            options={[{ value: 'updated:desc', label: t('sort.updatedDesc') }, { value: 'updated:asc', label: t('sort.updatedAsc') }, { value: 'created:desc', label: t('sort.createdDesc') }, { value: 'created:asc', label: t('sort.createdAsc') }, { value: 'title:asc', label: t('sort.titleAsc') }, { value: 'title:desc', label: t('sort.titleDesc') }, { value: 'status:asc', label: t('sort.status') }]}
          />
        </div>
      )}
      {(notes.length > 0 || uncommitted.length > 0 || leading) && (
        <div className='note-list rounded-xl border shadow-xs overflow-hidden transition-colors' style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-line)' }}>
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <thead className='bg-fg/5 border-b text-xs font-medium text-muted' style={{ borderColor: 'var(--color-line)' }}>
                <tr>
                  {renderSortHeader('title', t('notes.title'))}
                  {renderSortHeader('status', t('notes.status'), 'note-col-status')}
                  <th className='py-1.5 px-3 note-col-tags'>{t('notes.tags')}</th>
                  {renderSortHeader('updated', t('notes.modified'), 'note-col-modified')}
                  <th className='py-1.5 px-3 note-col-actions text-right'>{t('notes.actions')}</th>
                </tr>
              </thead>
              {uncommitted.length > 0 && (
                <tbody className='divide-y note-list-uncommitted' style={{ borderColor: 'var(--color-line)' }}>
                  <tr>
                    <th colSpan={5} scope='colgroup' className='py-1.5 px-3 text-left text-xs font-medium text-warning'>{t('notes.uncommitted')}</th>
                  </tr>
                  {uncommitted.map(note => <NoteRow key={noteRefKey(note)} note={note} statuses={statuses} readOnly={readOnly} canDelete={canDelete} isPendingDelete={pendingDeletePath === noteRefKey(note)} actions={actions} dates={dates} tagActions={tagActions} showZoom={!!focusMode} canDrag={!!focusMode?.canDrag(note)} canMove={movable} draft highlightQuery={highlightQuery} selected={false} selectionActive={false} />)}
                </tbody>
              )}
              <tbody className='divide-y' style={{ borderColor: 'var(--color-line)' }}>
                {leading && (
                  <tr className='note-list-leading hover:bg-fg/5 transition'>
                    <td colSpan={5} className='py-2 px-3'>{leading}</td>
                  </tr>
                )}
                {/* Notes row rendering */}
                {notes.map((note, index) => {
                  const group = groupOf?.(note);
                  const header = group && (index === 0 || groupOf!(notes[index - 1]).key !== group.key)
                    ? (
                      <tr key={`group:${group.key}`} className='note-group-row'>
                        <th colSpan={5} scope='colgroup' className='note-group-cell'>
                          <NoteGroupHeading group={group} collapsed={collapsedGroups?.has(group.key) ?? false} onToggle={onToggleGroup} />
                        </th>
                      </tr>
                    )
                    : null;
                  if (group && collapsedGroups?.has(group.key)) return header ? <React.Fragment key={noteRefKey(note)}>{header}</React.Fragment> : null;
                  return (
                    <React.Fragment key={noteRefKey(note)}>
                      {header}
                      <NoteRow note={note} statuses={statuses} readOnly={readOnly} canDelete={canDelete} isPendingDelete={pendingDeletePath === noteRefKey(note)} actions={actions} dates={dates} tagActions={tagActions} showZoom={!!focusMode} canDrag={!!focusMode?.canDrag(note)} canMove={movable} highlightQuery={highlightQuery} selected={selectedKeys?.has(noteRefKey(note)) ?? false} selectionActive={Boolean(selectedKeys?.size)} />
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};
