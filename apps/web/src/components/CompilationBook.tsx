import { type ReactNode, type TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { List } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { type BookChapter as Chapter, bookChapters, bookEntries, type BookEntry, slotAnchor } from '../lib/book-chapters.js';
import { chapterOfAnchor, hasSelection, type PageStep, pagingKey, resolvePage, swipeStartsHere, swipeStep } from '../lib/book-paging.js';
import { type BookReadingMode, useBookReadingMode, writeBookReadingMode } from '../lib/book-reading.js';
import { useCompilationEditingContext, useHeldNotes, useHeldOrder } from '../lib/compilation-editing.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useScrollSpy } from '../lib/scroll-spy.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { BookChapter } from './BookChapter.js';
import { BookPager } from './BookPager.js';
import { BookReadingToggle } from './BookReadingToggle.js';
import { BookContents } from './BookContents.js';
import { BookDrawer } from './BookDrawer.js';
import { Button } from './Button.js';
import type { CompilationContentProps } from './CompilationCard.js';
import { CompilationHeader, type CompilationHeaderProps } from './CompilationHeader.js';
import { LoadingStatus } from './LoadingStatus.js';
import { NoteListSentinel } from './NoteListSentinel.js';

type BookHeader = Omit<CompilationHeaderProps, 'row' | 'count' | 'notebooks' | 'scrollButton'>;

/** The compilation is narrower than this and the contents list moves into a drawer; the same number is in the book's container query in `workspace.css`. */
const BOOK_DRAWER_BELOW = 720;

const headings = (root: HTMLElement | null, anchor: string) => [...(root?.querySelectorAll<HTMLElement>('[data-book-anchor]') ?? [])].find(element => element.dataset.bookAnchor === anchor);

/**
 * The book arrangement: a contents list beside every item in order as one long document. Notes show their
 * full Markdown and edit in place; assets show a preview, YouTube the player and folders their notes as
 * sub-sections. The body scrolls inside the compilation and the contents follow it.
 */
export function CompilationBook({ row, notebooks, assets, onOpen, study, facets, extra, ...header }: Omit<CompilationContentProps, 'notes'> & BookHeader & { row: CompilationRow; study: StudyController; facets?: Record<string, NotebookFacets>; extra?: ReactNode; }) {
  const { t } = useTranslation();
  const laneNotes = useLaneNotes(row, { content: true });
  const ordinaryRow = { ...row, study: { ...row.study, filter: 'all' as const, dueFirst: false } };
  // While a section edits, its autosaves must not move or drop anything: the notes keep the copies they had, the items their order.
  const notes = useHeldNotes(laneNotes.notes);
  const items = useHeldOrder(studyRowItems(compilationRowItems(row, notes, assets, notebooks), ordinaryRow, notes, study.study));
  const chapters = bookChapters(items, notes, assets, laneNotes.loading);
  const [sections, setSections] = useState<ReadonlyMap<string, readonly BookEntry[]>>(new Map());
  const [liveTitles, setLiveTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const entries = bookEntries(chapters, sections, liveTitles);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [book, setBook] = useState<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const spied = useScrollSpy(body, entries.map(entry => entry.anchor).join('\n'));
  // While a section edits, the contents name it wherever the reader has scrolled; scrolling decides again once editing ends (B12).
  const { editing, finish } = useCompilationEditingContext();
  const editingEntry = editing ? slotAnchor(editing.slot, chapters) : null;
  const readingMode = useBookReadingMode();
  const paged = readingMode === 'paged';
  // The page is a chapter's id, so a reorder or a chapter that arrives does not move the reader to another chapter.
  const [pageId, setPageId] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const pageIndex = resolvePage(chapters, pageId, lastIndex.current);
  const page = chapters.at(pageIndex);
  const shown = paged && page ? [page] : chapters;
  const editingShown = editingEntry && entries.some(entry => entry.anchor === editingEntry) ? editingEntry : null;
  const active = editingShown ?? (paged ? page?.anchor ?? null : spied);
  const writable = !header.readOnly;
  // What to do with the body once a new page or mode has rendered: show the top of the page (and focus its heading for a page turn), or the chapter the reader was in.
  const arrival = useRef<{ anchor: string; focus: boolean; } | null>(null);
  const turning = useRef(false);
  useEffect(() => {
    lastIndex.current = pageIndex;
  }, [pageIndex]);

  const onEntries = useCallback((chapterId: string, next: BookEntry[]) => {
    setSections(current => {
      const same = (current.get(chapterId) ?? []).length === next.length && next.every((entry, index) => current.get(chapterId)![index].anchor === entry.anchor && current.get(chapterId)![index].title === entry.title);
      if (same || (!next.length && !current.has(chapterId))) return current;
      const copy = new Map(current);
      if (next.length) copy.set(chapterId, next);
      else copy.delete(chapterId);
      return copy;
    });
  }, []);
  const onLiveTitle = useCallback((anchor: string, title: string | undefined) => {
    setLiveTitles(current => {
      if (current.get(anchor) === title) return current;
      const copy = new Map(current);
      if (title === undefined) copy.delete(anchor);
      else copy.set(anchor, title);
      return copy;
    });
  }, []);

  // A jump puts the heading at the top of the body, smoothly unless the reader asked for less motion, and focuses it where it is.
  const jump = (anchor: string, behavior: 'smooth' | 'auto' = 'smooth') => {
    const heading = headings(body, anchor);
    if (!body || !heading) return;
    const top = body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top, behavior: reduced ? 'auto' : behavior });
    heading.focus({ preventScroll: true });
  };
  // A page turn leaves a section that edits only once it is saved (P5); a failed save keeps the reader on the page with the editor's notice.
  const goToPage = async (chapter: Chapter | undefined) => {
    if (!chapter || turning.current || chapter.id === page?.id) return;
    turning.current = true;
    try {
      if (editing && !await finish()) return;
      arrival.current = { anchor: chapter.anchor, focus: true };
      setPageId(chapter.id);
    } finally {
      turning.current = false;
    }
  };
  const step = (direction: PageStep) => {
    if (direction === 'previous') {
      if (pageIndex > 0) void goToPage(chapters[pageIndex - 1]);
    } else if (pageIndex < chapters.length - 1) void goToPage(chapters[pageIndex + 1]);
    // The last loaded page: the next chapters are fetched before Next gives up (P6).
    else if (laneNotes.hasMore && !laneNotes.loadingMore) laneNotes.loadMore();
  };
  const jumpTo = (anchor: string) => {
    const chapter = paged ? chapterOfAnchor(chapters, anchor) : undefined;
    if (paged && chapter && chapter.id !== page?.id) void goToPage(chapter);
    else jump(anchor);
  };
  // Switching modes keeps the reader at the same chapter: paged opens the chapter in view (the one editing, if any), continuous scrolls to the page's chapter (P7).
  const changeMode = (next: BookReadingMode) => {
    if (next === readingMode) return;
    if (next === 'paged') {
      const chapter = chapterOfAnchor(chapters, editingShown ?? spied ?? '') ?? page;
      if (chapter) {
        setPageId(chapter.id);
        arrival.current = { anchor: chapter.anchor, focus: false };
      }
    } else if (page) arrival.current = { anchor: page.anchor, focus: false };
    writeBookReadingMode(next);
  };
  useEffect(() => {
    const pending = arrival.current;
    if (!pending || !body) return;
    arrival.current = null;
    if (paged) {
      body.scrollTop = 0;
      if (pending.focus) headings(body, pending.anchor)?.focus({ preventScroll: true });
    } else jump(pending.anchor, 'auto');
    // `jump` reads only the body and the anchor; the effect runs when the page or the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, paged, body]);
  // Reaching the last loaded page of a dynamic compilation loads the next batch, so Next stays available until every member is reachable.
  useEffect(() => {
    if (paged && chapters.length && pageIndex >= chapters.length - 1 && laneNotes.hasMore && !laneNotes.loadingMore && !laneNotes.loading && !laneNotes.error) laneNotes.loadMore();
    // `loadMore` is a new function each render; the page, the chapter count and the loading flags say when to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, pageIndex, chapters.length, laneNotes.hasMore, laneNotes.loadingMore, laneNotes.loading, laneNotes.error]);
  // ← and → turn the page while focus is on the book or on nothing, not in an editor, an input or a widget that moves with the arrows (P3).
  const turn = useRef(step);
  useEffect(() => {
    turn.current = step;
  });
  useEffect(() => {
    if (!paged || !book) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target !== document.body && !(target instanceof Node && book.contains(target))) return;
      // A dialog over the book, the contents drawer included, owns the arrow keys; the dialog the book itself sits in does not.
      if ([...document.querySelectorAll('[aria-modal="true"]')].some(dialog => !dialog.contains(book))) return;
      const direction = pagingKey(event);
      if (!direction) return;
      event.preventDefault();
      turn.current(direction);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [paged, book]);
  // A horizontal swipe on the page turns it, except while a section edits or text is selected (P3).
  const touch = useRef<{ x: number; y: number; at: number; } | null>(null);
  const swipe = paged
    ? {
      onTouchStart: (event: TouchEvent<HTMLElement>) => {
        const point = event.touches[0];
        touch.current = event.touches.length === 1 && !editing && body && swipeStartsHere(event.target, body) ? { x: point.clientX, y: point.clientY, at: performance.now() } : null;
      },
      onTouchMove: (event: TouchEvent<HTMLElement>) => {
        if (event.touches.length > 1) touch.current = null;
      },
      onTouchCancel: () => void (touch.current = null),
      onTouchEnd: (event: TouchEvent<HTMLElement>) => {
        const start = touch.current;
        touch.current = null;
        const point = event.changedTouches[0];
        if (!start || editing || hasSelection()) return;
        const direction = swipeStep(point.clientX - start.x, point.clientY - start.y, performance.now() - start.at);
        if (direction) step(direction);
      },
    }
    : {};
  const closeDrawer = () => {
    setDrawer(false);
    opener.current?.focus();
  };
  // A drawer left open while the compilation widens would cover a list that is now beside the book.
  useEffect(() => {
    if (!drawer || !book || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width >= BOOK_DRAWER_BELOW) setDrawer(false);
    });
    observer.observe(book);
    return () => observer.disconnect();
  }, [drawer, book]);
  const contents = { entries, active, hasMore: laneNotes.hasMore, loadingMore: laneNotes.loadingMore, onLoadMore: laneNotes.loadMore };

  return (
    <section ref={setBook} id={`screen-lane-${row.id}`} className='screen-lane compilation-book-view' data-reading={readingMode} aria-label={row.name}>
      <CompilationHeader row={row} count={chapters.length} notebooks={notebooks} facets={facets} extra={extra} {...header} />
      <div className='compilation-book-bar'>
        <Button ref={opener} type='button' className='compilation-book-contents-button' aria-label={t('book.showContents')} title={t('book.showContents')} aria-haspopup='dialog' aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <List size={14} aria-hidden='true' />
          <span>{t('book.contents')}</span>
        </Button>
        <BookReadingToggle mode={readingMode} onChange={changeMode} />
      </div>
      <div className='compilation-book-layout'>
        <BookContents {...contents} onJump={jumpTo} />
        <div ref={setBody} className='compilation-book' aria-label={`${row.name} · ${t('screen.items')}`} {...swipe}>{shown.map(chapter => <BookChapter key={chapter.id} chapter={chapter} assets={assets} writable={writable} onOpen={onOpen} onLiveTitle={onLiveTitle} onEntries={onEntries} />)} {laneNotes.error && <p role='alert' className='screen-error'>{laneNotes.error}</p>} {laneNotes.loading && <LoadingStatus className='screen-lane-empty'>{t('notes.loading')}</LoadingStatus>} {!paged && <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className='screen-lane-sentinel' />} {!chapters.length && !laneNotes.loading && <div className='screen-lane-empty'>{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}</div>}</div>
      </div>
      {paged && chapters.length > 0 && <BookPager index={pageIndex} total={chapters.length} hasMore={laneNotes.hasMore} loadingMore={laneNotes.loadingMore} onStep={step} />}
      {drawer && book && (
        <BookDrawer
          {...contents}
          container={book}
          onJump={anchor => {
            setDrawer(false);
            jumpTo(anchor);
          }}
          onClose={closeDrawer}
        />
      )}
    </section>
  );
}
