import { noteRefKey } from '@mygitnotes/core/note-query';
import React, { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isCompilationPath } from '@mygitnotes/core/compilation';
import { NoteItem } from '../lib/types.js';
import type { NoteRef } from '@mygitnotes/core/note-query';
import { useTranslation } from '../lib/i18n/index.js';
import { useNoteEditing } from '../lib/note-editing.js';
import { useFollowedKey } from '../lib/note-follows.js';
import { usePanelContext } from '../lib/panel-context.js';
import { NoteEditor } from './NoteEditor.js';
import { useAssistantDockVisible } from './assistant/useAssistantDockVisible.js';
import { LoadingStatus } from './LoadingStatus.js';

interface EditorModalProps {
  note: NoteItem | null;
  /** The committed version of `note` when it carries a staged draft. */
  committed?: NoteItem;
  /** The note's body is still being read; the editor waits instead of opening an empty document. */
  loading?: boolean;
  isOpen: boolean;
  /** The view of the compilation at `path`; a compilation opens here instead of an editor. */
  renderCompilation: (path: string) => ReactNode;
  /** The zoomed compilation this note was opened from, kept mounted and hidden behind the note's zoom. */
  behind?: NoteRef | null;
  /**
   * The page's action error, such as a refused move or rename: the zoom covers the lists where the page says it, so it
   * is said inside the zoom too.
   */
  error?: string;
}

/** Zoom: the full-screen frame around a note's editor. */
export const EditorModal: React.FC<EditorModalProps> = ({ note, committed, loading, isOpen, renderCompilation, behind, error }) => {
  // A note the address follows to where it moved (another person moved or renamed it, §20.4) keeps its zoom and editor.
  const zoomKey = useFollowedKey(note ? noteRefKey(note) : '');
  if (!isOpen) return null;
  const compilation = note && isCompilationPath(note.path) ? note : null;
  // The compilation keeps one place and one key whether it is shown or waits behind a note, so opening a note from it
  // does not unmount its view: editing state, scroll position and a section's editor survive, and zoom can borrow that editor.
  const shown = compilation ?? behind ?? null;
  return <>{shown && <CompilationFrame key={noteRefKey(shown)} hidden={!compilation} error={compilation ? error : undefined}>{renderCompilation(shown.path)}</CompilationFrame>}{!compilation && (note ? <ZoomFrame key={zoomKey} note={note} committed={committed} error={error} /> : loading ? <EditorModalLoading /> : null)}</>;
};

/** The action error above the zoom's content, where the person sees it. */
const ZoomError: React.FC<{ error?: string; }> = ({ error }) => error ? <p role='alert' className='shrink-0 px-4 py-2 text-sm text-danger'>{error}</p> : null;

/**
 * The zoom is a modal dialog, except while the assistant dock is open beside it: the dock stays usable, so assistive
 * technology and focus must be able to reach it, and the zoom stops claiming the rest of the page is inert.
 */
function useModalWithoutDock(): 'true' | undefined {
  return useAssistantDockVisible() ? undefined : 'true';
}

/** Shown while a note's body is read; the editor never starts from a missing body. */
const EditorModalLoading: React.FC = () => {
  const { t } = useTranslation();
  const { setHasOpenNote } = usePanelContext();
  const modal = useModalWithoutDock();
  // Loading is already zoom: the workspace rail hides as it does behind the editor, instead of floating above the overlay.
  useLayoutEffect(() => {
    setHasOpenNote(true);
    return () => setHasOpenNote(false);
  }, [setHasOpenNote]);
  return (
    <div role='dialog' aria-modal={modal} aria-busy='true' aria-label={t('notes.loadingNote')} className='viewport-overlay dock-edge fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-4'>
      <LoadingStatus className='px-6 py-4 rounded-xl text-sm' style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>{t('notes.loadingNote')}</LoadingStatus>
    </div>
  );
};

/** Zoom for a compilation: the same full-screen frame, around its view. */
const CompilationFrame: React.FC<{ children: ReactNode; hidden?: boolean; error?: string; }> = ({ children, hidden = false, error }) => {
  const frame = useRef<HTMLDivElement>(null);
  const modal = useModalWithoutDock();
  const opener = useRef<HTMLElement | null>(null);
  // Behind a note the compilation cannot hold focus; the control that opened the note gets it back when the note closes.
  useLayoutEffect(() => {
    if (hidden) {
      if (frame.current?.contains(document.activeElement)) opener.current = document.activeElement as HTMLElement;
      return;
    }
    const element = opener.current;
    opener.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, [hidden]);
  return (
    <div ref={frame} className='note-overlay viewport-overlay dock-edge fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn' style={hidden ? { visibility: 'hidden' } : undefined} data-behind={hidden || undefined}>
      <div role='dialog' aria-modal={modal} aria-label='Compilation' className='note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors'>
        <ZoomError error={error} />
        {children}
      </div>
    </div>
  );
};

const ZoomFrame: React.FC<{ note: NoteItem; committed?: NoteItem; error?: string; }> = ({ note, committed, error }) => {
  const editing = useNoteEditing();
  const modal = useModalWithoutDock();
  const { setZoom, hosts } = editing;
  // A host that already edits this note lends its editor, so both places keep one session, cursor and undo history.
  useSyncExternalStore(hosts.subscribe, hosts.snapshot);
  const key = noteRefKey(note);
  const editorKey = useFollowedKey(key);
  const [canBorrow] = useState(() => Boolean(hosts.owner(key)));
  const borrowed = canBorrow && Boolean(hosts.owner(key));
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    setZoom({ key, borrowed, slot });
    return () => setZoom(null);
  }, [setZoom, key, borrowed, slot]);
  const props = editing.editorProps(note, committed);
  return (
    <div className='note-overlay viewport-overlay dock-edge fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 animate-fadeIn'>
      <div role='dialog' aria-modal={modal} aria-label='Note editor' className='note-dialog ui-dialog shadow-2xl w-full max-w-none h-full flex flex-col overflow-hidden transition-colors'>
        <ZoomError error={error} />
        {borrowed ? <div ref={setSlot} className='note-editor-slot' /> : <NoteEditor key={`${props.draftScope}:${editorKey}`} {...props} note={note} frame='zoom' active onClose={editing.closeZoom} onMove={editing.moveNote?.(note)} onRename={editing.renameNote?.(note) && (title => editing.renameNote?.({ ...note, title })?.())} />}
      </div>
    </div>
  );
};
