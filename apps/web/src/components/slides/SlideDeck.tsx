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
  /** The note's `slideOptions.structure` (`slideStructureOf`): `headings` plays it by its headings. */
  structure?: string;
  /** The lines the frontmatter takes above the text, so a failure names the line the editor shows. */
  lineNumberOffset?: number;
  /** `deck` plays the slides, starting on the outline; `notes` opens the speaker notes as a scrolling script. */
  view: SlideDeckView;
  onClose: () => void;
}

type Status = { state: 'loading'; } | { state: 'open'; } | { state: 'failed'; message: string; line?: number; };

/**
 * A slide note played over the whole window by contour-deck. The deck and everything it needs load when this mounts; while they do, and
 * when contour-deck refuses the note, a plain screen stands in its place with the reason and the line. Leaving the deck (Esc on the
 * outline, its close button) or the note's page closes it.
 */
export function SlideDeck({ content, path, notebookId, title, structure, lineNumberOffset = 0, view, onClose }: SlideDeckProps) {
  const { t, language } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  // The deck plays the note as it was when it opened, and leaves through the latest handler.
  const opened = useRef({ content, path, notebookId, title, structure, lineNumberOffset, view, t, language });
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useNoteYouTubeEmbed(host);

  useEffect(() => {
    const source = opened.current;
    // Focus goes back to whatever opened the deck.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let left = false;
    let closeDeck: (() => void) | undefined;
    void import('../../lib/slides/deck-runtime.js').then(runtime => {
      if (left || !host.current) return;
      const html = renderNote(source.content, source.path, source.t('preview.scrollableTable'), youtubeLabels(source.t), source.notebookId, { slides: 'deck', structure: source.structure });
      closeDeck = runtime.openDeck(host.current, { html, title: source.title, structure: source.structure, view: source.view, language: source.language, t: source.t, onExit: () => close.current() });
      setStatus({ state: 'open' });
    }).catch((error: unknown) => {
      if (left) return;
      if (error instanceof EmptyDeckError) setStatus({ state: 'failed', message: source.t('slides.empty') });
      else if (error instanceof SlideDeckError) setStatus({ state: 'failed', message: error.message, line: error.line === undefined ? undefined : error.line + source.lineNumberOffset });
      else setStatus({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      left = true;
      closeDeck?.();
      opener?.focus();
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
    <div className='slide-deck' data-source-notebook={notebookId}>
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
    </div>,
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
