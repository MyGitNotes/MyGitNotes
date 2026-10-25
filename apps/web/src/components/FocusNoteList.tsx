import React, { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { GalleryHorizontalEnd } from 'lucide-react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { pointerMovesNotes, startNoteDrag } from '../lib/note-drag.js';
import { useDeleteConfirm } from '../lib/use-delete-confirm.js';
import { useNoteHoverCard } from '../lib/use-note-hover-card.js';
import { useNoteTouchSelection } from '../lib/use-note-touch-selection.js';
import { HighlightText } from './HighlightText.js';
import { NoteGroupHeading } from './NoteGroupHeading.js';
import { NoteHoverCard } from './NoteHoverCard.js';
import { NoteSelectBox } from './NoteSelectBox.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { NotesEmptyState } from './NotesEmptyState.js';
import type { ListViewProps } from './ListView.js';
import './focus-list.css';

/** A row stays one height whatever its title: the title always reserves two lines. */
const TITLE_LINES = 2;

/**
 * The notes of a list that sits in the narrow dock beside a Focus: a status dot and a title of up to two lines per row, the rest of
 * what a card shows (every tag, both dates, the folder, an excerpt, and the actions) in a hover card beside the dock.
 */
export function FocusNoteList({ notes, uncommitted = [], hasFolderEntries = false, loading = false, statuses, readOnly = false, canDelete = true, confirmDelete = false, onOpenNote, onDeleteNote, onMoveNote, onUpdateNoteStatus, onNewNote, newKind, focusMode, leading, highlightQuery = '', selectedKeys, onToggleSelect, groupOf, collapsedGroups, onToggleGroup }: ListViewProps) {
  const { t } = useTranslation();
  const touchSelection = useNoteTouchSelection(onToggleSelect, !readOnly && Boolean(onMoveNote));
  const list = useRef<HTMLDivElement>(null);
  const hover = useNoteHoverCard();
  const { pendingDeletePath, requestDelete } = useDeleteConfirm(confirmDelete, path => {
    const note = [...uncommitted, ...notes].find(n => noteRefKey(n) === path);
    if (note) onDeleteNote(note);
  });

  if (!loading && notes.length === 0 && uncommitted.length === 0 && !hasFolderEntries) {
    return <NotesEmptyState readOnly={readOnly} kind={newKind} onNewNote={onNewNote} />;
  }

  const canMove = !readOnly && Boolean(onMoveNote) && pointerMovesNotes();
  const selectionActive = Boolean(selectedKeys?.size);

  /** Arrow keys move between rows; Enter or Space opens the one focused. */
  const onRowKeyDown = (note: NoteListItem, event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenNote(note);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-focus-row]') ?? []);
    const next = rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const renderRow = (note: NoteListItem, draft = false) => {
    const key = noteRefKey(note);
    const canDrag = !!focusMode?.canDrag(note);
    const selected = !draft && (selectedKeys?.has(key) ?? false);
    const open = focusMode?.openPath === note.path;
    const hovered = hover.target?.note && noteRefKey(hover.target.note) === key;
    const rowHandlers = hover.rowProps(note);
    return (
      <div
        key={key}
        role='listitem'
        data-focus-row=''
        data-open={open || undefined}
        data-selected={selected || undefined}
        data-hovered={hovered || undefined}
        tabIndex={0}
        aria-current={open ? 'true' : undefined}
        draggable={canDrag || canMove}
        onDragStart={canDrag || canMove
          ? event => startNoteDrag(event, note, { focus: canDrag, move: canMove })
          : undefined}
        className='focus-row'
        {...touchSelection.itemProps(note, onOpenNote, !draft)}
        {...rowHandlers}
        onKeyDown={event => {
          rowHandlers.onKeyDown(event);
          if (!event.defaultPrevented) onRowKeyDown(note, event);
        }}
      >
        {selectionActive && !draft && <NoteSelectBox title={note.title} checked={selected} onToggle={() => onToggleSelect?.(note)} className='focus-row-check' />}
        <NoteStatusSelect dotOnly statuses={statuses} status={note.status} readOnly={readOnly || draft} label={t('notes.statusFor', { title: note.title })} onChange={status => onUpdateNoteStatus(note, status)} />
        <span className='focus-row-title' style={{ ['--title-lines' as string]: TITLE_LINES }}>
          {isCompilationPath(note.path) && <GalleryHorizontalEnd className='focus-row-kind' aria-hidden='true' />}
          <HighlightText text={note.title} query={highlightQuery} />
        </span>
      </div>
    );
  };

  const deleteNote = (note: NoteListItem) => {
    const key = noteRefKey(note);
    const fires = !confirmDelete || pendingDeletePath === key;
    requestDelete(key);
    return fires;
  };

  return (
    <div ref={list} className='focus-note-list'>
      {leading && <div className='note-collection-leading'>{leading}</div>}
      {uncommitted.length > 0 && (
        <section className='focus-list-uncommitted'>
          <h3>{t('notes.uncommitted')}</h3>
          <div role='list'>{uncommitted.map(note => renderRow(note, true))}</div>
        </section>
      )}
      <div role='list' className='focus-list-rows'>
        {notes.map((note, index) => {
          const group = groupOf?.(note);
          const header = group && (index === 0 || groupOf!(notes[index - 1]).key !== group.key) ? <NoteGroupHeading group={group} collapsed={collapsedGroups?.has(group.key) ?? false} onToggle={onToggleGroup} /> : null;
          if (group && collapsedGroups?.has(group.key)) return header ? <React.Fragment key={noteRefKey(note)}>{header}</React.Fragment> : null;
          return header ? <React.Fragment key={noteRefKey(note)}>{header}{renderRow(note)}</React.Fragment> : renderRow(note);
        })}
      </div>
      {hover.target && <NoteHoverCard key={noteRefKey(hover.target.note)} target={hover.target} cardRef={hover.card} cardProps={hover.cardProps} statuses={statuses} readOnly={readOnly} readNote={focusMode?.readNote} onUpdateStatus={onUpdateNoteStatus} onZoom={focusMode?.onZoomNote} onMove={onMoveNote} onDelete={canDelete ? deleteNote : undefined} deleteArmed={pendingDeletePath === noteRefKey(hover.target.note)} onMenuOpenChange={hover.holdOpen} onDone={() => hover.close()} />}
    </div>
  );
}
