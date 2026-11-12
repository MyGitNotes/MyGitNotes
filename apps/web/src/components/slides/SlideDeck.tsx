import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useTranslation } from '../../lib/i18n/index.js';
import { renderNote } from '../../lib/markdown.js';
import { EmptyDeckError, SlideDeckError } from '../../lib/slides/errors.js';
import { useNoteYouTubeEmbed } from '../../lib/use-note-youtube-embed.js';
import { youtubeLabels } from '../../lib/youtube-embed.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';
import './slide-deck.css';

export type SlideDeckView = 'deck' | 'notes';

export interface SlideDeckProps {
  /** The note's text, without its frontmatter, as it is when the deck opens. */
  content: string;
  path: string;
  notebookId?: string;
  /** The note's title, shown over the outline. */
  title: string;
  /** The lines the frontmatter takes above the text, so a failure names the line the editor shows. */
  lineNumberOffset?: number;
  /** `deck` plays the slides, starting on the outline; `notes` opens the speaker notes as a scrolling script. */
  view: SlideDeckView;
  /** The control that opened the deck, which takes the focus back when it closes; without one, whatever had the focus does. */
  opener?: HTMLElement | null;
  onClose: () => void;
}

type Status = { state: 'loading'; } | { state: 'open'; } | { state: 'failed'; message: string; line?: number; };

/**
 * A slide note played over the whole window by contour-deck. The deck and everything it needs load when this mounts; while they do, and
 * when contour-deck refuses the note, a plain screen stands in its place with the reason and the line. Leaving the deck (Esc on the
 * outline, its close button) or the note's page closes it.
 *
 * The deck is a modal dialog: the app behind it is inert, Tab stays in it, and the note's own key handlers, which stand aside for an open
 * dialog, leave its keys to contour-deck.
 */
export function SlideDeck({ content, path, notebookId, title, lineNumberOffset = 0, view, opener, onClose }: SlideDeckProps) {
  const { t, language } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  // The deck plays the note as it was when it opened, and leaves through the latest handler.
  const opened = useRef({ content, path, notebookId, title, lineNumberOffset, view, opener, t, language });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useNoteYouTubeEmbed(host);

  useEffect(() => {
    const source = opened.current;
    // Focus goes back to whatever opened the deck.
    const returnTo = source.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const modal = dialog.current!;
    modal.showModal();
    // The app's chords (quick open, help, search) would open their panels under the deck; contour-deck reads no chord, so none goes past it.
    const holdChords = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) event.stopPropagation();
    };
    window.addEventListener('keydown', holdChords, true);
    let left = false;
    let closeDeck: (() => void) | undefined;
    void import('../../lib/slides/deck-runtime.js').then(runtime => {
      if (left || !host.current) return;
      const html = renderNote(source.content, source.path, source.t('preview.scrollableTable'), youtubeLabels(source.t), source.notebookId, { slides: 'deck' });
      closeDeck = runtime.openDeck(host.current, { html, title: source.title, view: source.view, language: source.language, t: source.t, onExit: () => close.current() });
      setStatus({ state: 'open' });
    }).catch((error: unknown) => {
      if (left) return;
      if (error instanceof EmptyDeckError) setStatus({ state: 'failed', message: source.t('slides.empty') });
      else if (error instanceof SlideDeckError) setStatus({ state: 'failed', message: error.message, line: error.line === undefined ? undefined : error.line + source.lineNumberOffset });
      else setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      left = true;
      window.removeEventListener('keydown', holdChords, true);
      closeDeck?.();
      modal.close();
      returnTo?.focus();
    };
  }, []);

  const routed = useInRouterContext();

  // The screens that stand in for the deck answer Esc the way its outline does.
  const standingIn = status.state !== 'open';
  useEffect(() => {
    if (!standingIn) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [standingIn]);

  return createPortal(
    <dialog
      ref={dialog}
      className='slide-deck'
      aria-label={title}
      data-source-notebook={notebookId}
      // contour-deck answers Escape itself; the dialog never closes on its own.
      onCancel={event => event.preventDefault()}
    >
      <div ref={host} className='slide-deck-host' />
      {routed && <LeavesWithThePage onLeave={() => close.current()} />}
      {status.state === 'loading' && <LoadingStatus as='div' className='slide-deck-status'>{t('slides.loading')}</LoadingStatus>}
      {status.state === 'failed' && (
        <div className='slide-deck-status' role='alertdialog' aria-modal='true' aria-labelledby='slide-deck-failed'>
          <h2 id='slide-deck-failed'>{t('slides.failed')}</h2>
          <p className='slide-deck-error-message'>{status.message}</p>
          {status.line !== undefined && <p className='slide-deck-error-line'>{t('slides.failedLine', { line: status.line })}</p>}
          <Button variant='primary' autoFocus onClick={onClose}>{t('slides.back')}</Button>
        </div>
      )}
    </dialog>,
    document.body,
  );
}

/** A link in a slide that opens another page of the app takes the reader there: the deck goes. */
function LeavesWithThePage({ onLeave }: { onLeave: () => void; }) {
  const location = useLocation();
  const arrivedAt = useRef(location.key);
  const leave = useRef(onLeave);
  useEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);
  useEffect(() => {
    if (location.key !== arrivedAt.current) leave.current();
  }, [location.key]);
  return null;
}
