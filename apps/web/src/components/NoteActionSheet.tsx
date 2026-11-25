import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Check, CircleCheck, ExternalLink, FolderInput, ListChecks, Trash2 } from 'lucide-react';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useStatusDotClass, useStatusLabel } from '../lib/status-color.js';
import { useLiveLock } from './live/live-drafts.js';
import { PhoneSheet } from './PhoneSheet.js';
import './note-action-sheet.css';

export type NoteSheetMode = 'menu' | 'status' | 'delete';

/** What a list row or a whiteboard card asks the sheet for, after a hold or a tap on one of its revealed actions. */
export interface NoteSheetRequest {
  note: NoteListItem;
  /** The page the sheet opens on: the menu, the status picker, or the delete confirmation. */
  mode?: NoteSheetMode;
  /** Opens the note where the place that asked opens notes. */
  open: () => void;
  /** The statuses the place offers for the note (a list shows its notebook's); the notebook's configured ones otherwise. */
  statuses?: readonly string[];
  /** Adds the note to the list's selection, where the list has one. */
  select?: () => void;
  /** Where it was asked: on a whiteboard the delete item says it deletes the note itself, not only its card. */
  source?: 'list' | 'board';
}

/** The page's own note actions, the same ones its desktop rows, cards and menus call. */
export interface NoteSheetActions {
  statusesOf: (notebookId: string) => readonly string[];
  writable: (note: NoteListItem) => boolean;
  updateStatus: (note: NoteListItem, status: string) => void;
  /** The move dialog's opener for a note it can move (`useNoteMove`'s `moveNote`). */
  move: (note: NoteListItem) => (() => void) | undefined;
  /** Deletes the note as the page's delete does (to the trash, or a discard for a live draft). */
  remove: (note: NoteListItem) => void;
}

interface NoteSheetContext {
  show: (request: NoteSheetRequest) => void;
}

const Context = createContext<NoteSheetContext | null>(null);

/** The phone's note menu, or null where the page offers none (wider screens). */
export function useNoteActionSheet(): NoteSheetContext | null {
  return useContext(Context);
}

/** Holds the one note menu a phone's list rows and whiteboard cards share; `actions` absent, nothing asks for it. */
export function NoteActionSheetProvider({ actions, children }: { actions?: NoteSheetActions; children: ReactNode; }) {
  const [request, setRequest] = useState<NoteSheetRequest | null>(null);
  const show = useCallback((next: NoteSheetRequest) => setRequest(next), []);
  const enabled = Boolean(actions);
  const value = useMemo(() => enabled ? { show } : null, [enabled, show]);
  return <Context.Provider value={value}>{children}{actions && request && <NoteActionSheet key={`${request.note.notebookId}:${request.note.path}:${request.mode ?? 'menu'}`} request={request} actions={actions} onClose={() => setRequest(null)} />}</Context.Provider>;
}

/**
 * The bottom sheet of one note: 開啟, 變更狀態, 移動筆記, (選取,) 刪除筆記, titled with the note. 變更狀態 turns the sheet into the note's
 * notebook's status picker; 刪除筆記 asks again before it deletes. Actions a read-only notebook or a note being edited live (編輯中) refuses
 * are disabled, with the reason under them.
 */
export function NoteActionSheet({ request, actions, onClose }: { request: NoteSheetRequest; actions: NoteSheetActions; onClose: () => void; }) {
  const { t } = useTranslation();
  const liveLock = useLiveLock();
  const labelOf = useStatusLabel();
  const dotClass = useStatusDotClass();
  const { note } = request;
  const [mode, setMode] = useState<NoteSheetMode>(request.mode ?? 'menu');
  const writable = actions.writable(note);
  const statusLock = note.frontmatterInvalid ? t('editor.frontmatterInvalidShort') : liveLock(note, 'other');
  const moveLock = liveLock(note, 'move');
  const deleteLock = liveLock(note, 'delete');
  const move = writable && !moveLock ? actions.move(note) : undefined;
  const board = request.source === 'board';
  const done = (run: () => void) => () => {
    onClose();
    run();
  };
  // Opened on the status picker or the confirmation, the sheet goes back by closing; opened on the menu, back to the menu.
  const back = () => request.mode && request.mode !== 'menu' ? onClose() : setMode('menu');
  const reason = (text: string | undefined) => text && <span className='note-action-reason'>{text}</span>;

  let body: ReactNode;
  if (mode === 'status') {
    const statuses = request.statuses ?? actions.statusesOf(note.notebookId);
    const current = note.status ?? '';
    const values = ['', ...statuses, ...(current && !statuses.includes(current) ? [current] : [])];
    body = (
      <div className='note-action-list' role='group' aria-label={t('noteActions.status')}>
        {values.map(value => (
          <button key={value || '-'} type='button' className='note-action-item' aria-pressed={value === current} disabled={!writable || Boolean(statusLock)} onClick={done(() => actions.updateStatus(note, value))}>
            <span className={value ? `status-dot ${dotClass(value)}` : 'status-dot status-dot-empty'} aria-hidden='true' />
            <span className='note-action-label'>{value ? labelOf(value) : t('notes.noStatus')}</span>
            {value === current && <Check className='note-action-check' aria-hidden='true' />}
          </button>
        ))}
        {reason(statusLock)}
        <button type='button' className='note-action-item note-action-back' onClick={back}>{t('common.cancel')}</button>
      </div>
    );
  } else if (mode === 'delete') {
    body = (
      <div className='note-action-confirm' role='group' aria-label={t('notes.delete')}>
        <p className='note-action-question'>{t('noteActions.deleteConfirm', { title: note.title })}</p>
        {board && <p className='note-action-hint'>{t('noteActions.deleteFromBoardHint')}</p>}
        <div className='note-action-buttons'>
          <button type='button' className='note-action-button' onClick={back}>{t('common.cancel')}</button>
          <button type='button' className='note-action-button note-action-danger' onClick={done(() => actions.remove(note))}>{t('common.delete')}</button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className='note-action-list'>
        <button type='button' className='note-action-item' onClick={done(request.open)}>
          <ExternalLink aria-hidden='true' />
          <span className='note-action-label'>{t('noteActions.open')}</span>
        </button>
        <button type='button' className='note-action-item' disabled={!writable || Boolean(statusLock)} onClick={() => setMode('status')}>
          <CircleCheck aria-hidden='true' />
          <span className='note-action-label'>{t('noteActions.status')}</span>
          {writable && reason(statusLock)}
        </button>
        <button type='button' className='note-action-item' disabled={!move} onClick={move && done(move)}>
          <FolderInput aria-hidden='true' />
          <span className='note-action-label'>{t('noteActions.move')}</span>
          {writable && reason(moveLock)}
        </button>
        {request.select && (
          <button type='button' className='note-action-item' onClick={done(request.select)}>
            <ListChecks aria-hidden='true' />
            <span className='note-action-label'>{t('noteActions.select')}</span>
          </button>
        )}
        <button type='button' className='note-action-item note-action-danger' disabled={!writable || Boolean(deleteLock)} onClick={() => setMode('delete')}>
          <Trash2 aria-hidden='true' />
          <span className='note-action-label'>{t('notes.delete')}</span>
          {writable && reason(deleteLock)}
        </button>
      </div>
    );
  }
  return <PhoneSheet title={note.title} onClose={onClose} className='note-action-sheet'>{body}</PhoneSheet>;
}
