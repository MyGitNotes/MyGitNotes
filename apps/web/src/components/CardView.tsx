import { NoteMoveButton } from './NoteMoveButton.js';
import React from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { NoteTagActions, NoteTags } from './NoteTags.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { noteUpdatedTime } from '../lib/note-sort.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { type NoteBrowseFocusMode, pointerMovesNotes, startNoteDrag } from '../lib/note-drag.js';
import { HighlightText } from './HighlightText.js';
import { type BrowseKind, NotesEmptyState } from './NotesEmptyState.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteZoomButton } from './NoteZoomButton.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';
import type { NoteGroupOf } from '../lib/note-groups.js';
import { NoteGroupHeading } from './NoteGroupHeading.js';

interface CardViewProps {
  notes: NoteListItem[];
  /** Staged drafts the server cannot return yet; shown above the committed cards. */
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
  onNewNote: () => void;
  /** What the list shows, so its empty state offers to create the same kind. */
  newKind?: BrowseKind;
  onUpdateNoteStatus: (note: NoteListItem, status: string) => void;
  tagActions?: NoteTagActions;
  /** Present while a Focus is displayed: cards get a zoom button and can be dragged into a pane. */
  focusMode?: NoteBrowseFocusMode;
  /** Active search text: highlights matches in the title and shows a matched-content snippet when present. */
  highlightQuery?: string;
  /** `noteRefKey`s of the notes selected for bulk actions; a checkbox only appears on cards while this is non-empty. */
  selectedKeys?: Set<string>;
  /** Modifier-click (or the checkbox, once shown) toggles a card's membership; a plain click still opens it. */
  onToggleSelect?: (note: NoteListItem) => void;
  /** Present while the notes come grouped by folder: a heading starts each folder. */
  groupOf?: NoteGroupOf;
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
}

export const CardView: React.FC<CardViewProps> = ({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onNewNote, newKind, onUpdateNoteStatus, tagActions, focusMode, highlightQuery = '', selectedKeys, onToggleSelect, groupOf, collapsedGroups, onToggleGroup }) => {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(onToggleSelect, !readOnly && Boolean(onMoveNote));
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = [...uncommitted, ...notes].find(n => noteRefKey(n) === path);
    if (note) onDeleteNote(note);
  });

  const isEmpty = !loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries;

  if (isEmpty) {
    return <NotesEmptyState readOnly={readOnly} kind={newKind} onNewNote={onNewNote} />;
  }

  const renderCard = (note: NoteListItem, draft = false) => {
    const updated = noteUpdatedTime(note);
    const formattedDate = updated ? new Date(updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
    const canDrag = !!focusMode?.canDrag(note);
    const canMove = !readOnly && Boolean(onMoveNote) && pointerMovesNotes();
    const selectionActive = !draft && Boolean(selectedKeys?.size);
    const selected = !draft && (selectedKeys?.has(noteRefKey(note)) ?? false);

    return (
      <div key={noteRefKey(note)} {...touchSelection.itemProps(note, onOpenNote, !draft)} title={draft || selectionActive ? undefined : t('notes.multiSelectHint')} draggable={canDrag || canMove} onDragStart={canDrag || canMove ? event => startNoteDrag(event, note, { focus: canDrag, move: canMove }) : undefined} style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-line)' }} className='note-card rounded-lg border hover:border-primary px-3 py-2.5 flex flex-col gap-1.5 transition cursor-pointer group'>
        <div className='flex items-start justify-between gap-2'>
          <h3 className='font-semibold text-fg text-sm leading-snug transition flex items-start gap-1.5 min-w-0'>
            {selectionActive && <NoteSelectBox title={note.title} checked={selected} onToggle={() => onToggleSelect?.(note)} />}
            <span className='line-clamp-2 break-words'>
              <HighlightText text={note.title} query={highlightQuery} />
            </span>
            {note.path.endsWith('.mdx') && <span className='shrink-0 text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/40 leading-none'>MDX</span>}
          </h3>
          <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={(status) => onUpdateNoteStatus(note, status)} />
        </div>
        {note.matchSnippet && (
          <p className='text-xs text-muted line-clamp-2 leading-relaxed'>
            <HighlightText text={note.matchSnippet} query={highlightQuery} />
          </p>
        )}
        <div className='note-card-footer flex items-center gap-2 text-xs text-muted'>
          <div className='min-w-0 flex-1'>{note.tags.length > 0 && <NoteTags tags={note.tags} oneLine tagActions={tagActions} className='note-card-tags' />}</div>
          <span className='flex items-center gap-1 text-[11px] shrink-0'>
            <Clock className='w-3 h-3' />
            {formattedDate}
          </span>
          <div className='flex items-center gap-1 shrink-0' onClick={(e) => e.stopPropagation()}>
            {focusMode && <NoteZoomButton onClick={() => focusMode.onZoomNote(note)} />}
            {!readOnly && onMoveNote && <NoteMoveButton onClick={() => onMoveNote(note)} />}
            {!readOnly && canDelete && (
              <button
                type='button'
                onClick={() => requestDelete(noteRefKey(note))}
                title={pendingDeletePath === noteRefKey(note) ? t('notes.confirmDelete') : t('notes.delete')}
                className={pendingDeletePath === noteRefKey(note) ? 'p-1 text-on-danger bg-danger hover:bg-danger/90 transition rounded' : 'p-1 text-muted hover:text-danger transition rounded'}
              >
                <Trash2 className='w-3.5 h-3.5' />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const gridClassName = 'note-card-grid';

  return (
    <>
      {uncommitted.length > 0 && (
        <section className='note-card-uncommitted mb-4'>
          <h3 className='mb-2 text-xs uppercase font-semibold text-warning'>{t('notes.uncommitted')}</h3>
          <div className={gridClassName}>{uncommitted.map(note => renderCard(note, true))}</div>
        </section>
      )}
      <div className={gridClassName}>
        {notes.map((note, index) => {
          const group = groupOf?.(note);
          const header = group && (index === 0 || groupOf!(notes[index - 1]).key !== group.key) ? <NoteGroupHeading group={group} collapsed={collapsedGroups?.has(group.key) ?? false} onToggle={onToggleGroup} /> : null;
          if (group && collapsedGroups?.has(group.key)) return header ? <React.Fragment key={noteRefKey(note)}>{header}</React.Fragment> : null;
          return header ? <React.Fragment key={noteRefKey(note)}>{header}{renderCard(note)}</React.Fragment> : renderCard(note);
        })}
      </div>
    </>
  );
};
