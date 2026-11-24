import type { NoteListItem } from '@mygitnotes/core/note-query';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { type CSSProperties, useLayoutEffect, useRef } from 'react';
import { useIdle } from '../lib/use-idle.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';
import { Tooltip } from './Tooltip.js';

export interface FoldedNoteDotsProps {
  /** The notes the folded list holds, in its order. */
  notes: readonly NoteListItem[];
  /** The path of the note open in the Focus, marked among the dots. */
  openPath: string | null | undefined;
  onOpenNote: (note: NoteListItem) => void;
}

/** How long the page sits untouched before the dots start to dance. */
export const DOTS_IDLE_MS = 90_000;
/** The band of the column, as fractions of its height, the open note's dot is kept in; outside it the column scrolls it to {@link DOT_REST}. */
const DOT_BAND = [0.1, 0.45] as const;
const DOT_REST = 0.25;

/** Where the column's scroll goes so the open dot sits in the upper part of it, or null where it already does. */
export function dotScrollTarget(dot: { top: number; height: number; }, column: { top: number; height: number; scrollTop: number; }): number | null {
  const center = dot.top + dot.height / 2 - column.top;
  if (center >= column.height * DOT_BAND[0] && center <= column.height * DOT_BAND[1]) return null;
  return Math.max(0, column.scrollTop + center - column.height * DOT_REST);
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The folded note list kept as a column of status dots under the toggle that brings it back: one dot per note, in the list's order, its
 * title and status in a tooltip, and a press opens it as a row of the list would. The open note's dot is kept in the upper part of the
 * column, and after {@link DOTS_IDLE_MS} untouched the dots dance in a wave until the next touch.
 */
export function FoldedNoteDots({ notes, openPath, onOpenNote }: FoldedNoteDotsProps) {
  const { t } = useTranslation();
  const dotClass = useStatusDotClass();
  const labelOf = useStatusLabel();
  const idle = useIdle(DOTS_IDLE_MS);
  const list = useRef<HTMLUListElement>(null);
  const hasNotes = notes.length > 0;
  // The open note's dot is brought to the upper part of the column when the open note changes or the column appears.
  useLayoutEffect(() => {
    const column = list.current, dot = column?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!column || !dot || typeof column.scrollTo !== 'function') return;
    const columnBox = column.getBoundingClientRect(), dotBox = dot.getBoundingClientRect();
    const top = dotScrollTarget({ top: dotBox.top, height: dotBox.height }, { top: columnBox.top, height: column.clientHeight, scrollTop: column.scrollTop });
    if (top !== null) column.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [openPath, hasNotes]);
  if (!hasNotes) return null;
  return (
    <ul ref={list} className='browse-folded-notes' aria-label={t('browse.foldedNotes')} data-idle={idle || undefined}>
      {notes.map((note, index) => {
        const status = note.status ?? '';
        const title = note.title || note.path;
        const { live } = note;
        const state = live?.pending ? 'pending' : live && live.activeEditors > 0 ? 'editing' : live?.changed ? 'changed' : undefined;
        const liveLabel = state === 'pending' ? t('live.pending') : state === 'editing' ? t('live.badge', { count: live!.activeEditors }) : state === 'changed' ? t('live.badgeQuiet') : undefined;
        const statusLabel = status ? labelOf(status) : t('notes.noStatus');
        return (
          <li key={noteRefKey(note)} style={{ '--dot-index': index % 16 } as CSSProperties}>
            <Tooltip label={title} detail={liveLabel ? `${statusLabel} · ${liveLabel}` : statusLabel} side='right'>
              <button type='button' className='browse-folded-note' data-live={state} aria-label={title} aria-current={openPath === note.path ? 'true' : undefined} onClick={() => onOpenNote(note)}>
                <span className={status ? `status-dot ${dotClass(status)}` : 'status-dot status-dot-empty'} aria-hidden='true' />
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
