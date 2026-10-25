import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Folder, FolderInput, Maximize2, Trash2 } from 'lucide-react';
import { noteDirectory, type NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { noteCreatedTime, noteUpdatedTime } from '../lib/note-sort.js';
import { noteExcerpt } from '../lib/note-excerpt.js';
import type { HoverCardTarget } from '../lib/use-note-hover-card.js';
import { NoteStatusSelect } from './NoteStatusSelect.js';
import { NoteTags } from './NoteTags.js';
import './focus-list.css';

const CARD_WIDTH = 320;
const GAP = 8;
const MARGIN = 8;

export interface NoteHoverCardProps {
  target: HoverCardTarget;
  cardRef: RefObject<HTMLDivElement>;
  cardProps: object;
  statuses: string[];
  readOnly: boolean;
  /** Reads the note body for the excerpt; without it (or when it fails) the card shows no excerpt. */
  readNote?: (note: NoteListItem) => Promise<{ content: string; }>;
  onUpdateStatus: (note: NoteListItem, status: string) => void;
  /** Present while a Focus is displayed. */
  onZoom?: (note: NoteListItem) => void;
  onMove?: (note: NoteListItem) => void;
  /** Absent when the note cannot be deleted from here. Answers whether the note was deleted, as opposed to waiting for a second click. */
  onDelete?: (note: NoteListItem) => boolean;
  deleteArmed: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Called after an action that leaves the card with nothing to show. */
  onDone: () => void;
}

/** The excerpt of `note`, read once the card is open; the note itself when its body is already at hand. */
function useExcerpt(note: NoteListItem, readNote: NoteHoverCardProps['readNote']): { text: string; loading: boolean; } {
  const [read, setRead] = useState<{ key: string; text: string; } | null>(null);
  const key = `${note.notebookId}:${note.path}:${note.revision ?? note.mtime ?? ''}`;
  const known = typeof note.content === 'string' ? noteExcerpt(note.content, note.title) : undefined;
  useEffect(() => {
    if (known !== undefined || !readNote) return;
    let current = true;
    readNote(note).then(item => current && setRead({ key, text: noteExcerpt(item.content ?? '', note.title) }), () => current && setRead({ key, text: '' }));
    return () => {
      current = false;
    };
    // Reading again for the same revision of the same note would show the same text.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (known !== undefined) return { text: known, loading: false };
  if (!readNote) return { text: '', loading: false };
  return read?.key === key ? { text: read.text, loading: false } : { text: '', loading: true };
}

/** Where the card goes: beside the dock the row is in (never over the list), at the row's height, kept inside the window. */
export function hoverCardPosition(target: Pick<HoverCardTarget, 'rowRect' | 'dockRect'>, size: { width: number; height: number; }, viewport: { width: number; height: number; }): { left: number; top: number; } {
  const beside = target.dockRect?.right ?? target.rowRect.right;
  const left = Math.max(MARGIN, Math.min(beside + GAP, viewport.width - size.width - MARGIN));
  const top = Math.max(MARGIN, Math.min(target.rowRect.top, viewport.height - size.height - MARGIN));
  return { left, top };
}

const Field = ({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode; }) => (
  <div className='note-hover-field'>
    <dt>
      {icon}
      <span>{label}</span>
    </dt>
    <dd>{children}</dd>
  </div>
);

/** A note's full information beside the narrow list: status, every tag, dates, folder, an excerpt, and its actions. */
export function NoteHoverCard({ target, cardRef, cardProps, statuses, readOnly, readNote, onUpdateStatus, onZoom, onMove, onDelete, deleteArmed, onMenuOpenChange, onDone }: NoteHoverCardProps) {
  const { t, language } = useTranslation();
  const { note } = target;
  const excerpt = useExcerpt(note, readNote);
  const [position, setPosition] = useState<{ left: number; top: number; }>();
  const measured = useRef('');
  // Placed after it renders, when its height is known; measured again when its content changes height.
  useLayoutEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const next = hoverCardPosition(target, { width: width || CARD_WIDTH, height }, { width: window.innerWidth, height: window.innerHeight });
      const signature = `${next.left}:${next.top}`;
      if (signature !== measured.current) {
        measured.current = signature;
        setPosition(next);
      }
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, cardRef, excerpt.text, note.tags.length]);

  const date = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const created = noteCreatedTime(note);
  const updated = noteUpdatedTime(note);
  const folder = noteDirectory(note.path);

  return createPortal(
    <div ref={cardRef} role='group' aria-label={t('focusList.cardLabel', { title: note.title })} className='note-hover-card' style={position ? { left: position.left, top: position.top } : { left: -9999, top: 0 }} {...cardProps}>
      <h3 className='note-hover-title'>{note.title}</h3>
      <div className='note-hover-status'>
        <NoteStatusSelect statuses={statuses} status={note.status} readOnly={readOnly} label={t('notes.statusFor', { title: note.title })} onChange={status => onUpdateStatus(note, status)} onOpenChange={onMenuOpenChange} />
      </div>
      {note.tags.length > 0 && <NoteTags tags={note.tags} className='note-hover-tags' />}
      <dl className='note-hover-fields'>
        <Field icon={<Calendar aria-hidden='true' />} label={t('focusList.created')}>{created ? <time dateTime={new Date(created).toISOString()}>{date.format(created)}</time> : '—'}</Field>
        <Field icon={<Calendar aria-hidden='true' />} label={t('focusList.updated')}>{updated ? <time dateTime={new Date(updated).toISOString()}>{date.format(updated)}</time> : '—'}</Field>
        <Field icon={<Folder aria-hidden='true' />} label={t('focusList.folder')}>
          <span className='note-hover-path'>{folder || '/'}</span>
        </Field>
      </dl>
      {(excerpt.text || excerpt.loading) && <p className='note-hover-excerpt' aria-busy={excerpt.loading || undefined}>{excerpt.text || t('focusList.excerptLoading')}</p>}
      <div className='note-hover-actions'>
        {onZoom && (
          <button type='button' className='ui-button ui-button-small' onClick={() => (onZoom(note), onDone())}>
            <Maximize2 aria-hidden='true' />
            {t('focus.zoomNote')}
          </button>
        )}
        {!readOnly && onMove && (
          <button type='button' className='ui-button ui-button-small' onClick={() => (onMove(note), onDone())}>
            <FolderInput aria-hidden='true' />
            {t('files.moveNote')}
          </button>
        )}
        {!readOnly && onDelete && (
          <button type='button' className={`ui-button ui-button-small ${deleteArmed ? 'ui-button-danger' : ''}`} onClick={() => onDelete(note) && onDone()}>
            <Trash2 aria-hidden='true' />
            {deleteArmed ? t('notes.confirmDelete') : t('notes.delete')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
