import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { List } from 'lucide-react';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import { type BookChapter as Chapter, bookChapters, bookEntries, type BookEntry, slotAnchor } from '../lib/book-chapters.js';
import { chapterOfAnchor, type PageStep, resolvePage } from '../lib/book-paging.js';
import { useBookReadingMode, writeBookReadingMode } from '../lib/book-reading.js';
import { useCompilationEditingContext, useHeldNotes, useHeldOrder } from '../lib/compilation-editing.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useScrollSpy } from '../lib/scroll-spy.js';
import { useBookPageInput } from '../lib/use-book-page-input.js';
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
  // The page is a chapter's id, so a reorder or a chapter that arrives does not move the reader to another chapter; the index is where the chapter was, for one that leaves.
  const [position, setPosition] = useState<{ id: string | null; index: number; }>({ id: null, index: 0 });
  const pageIndex = resolvePage(chapters, position.id, position.index);
  const page = chapters.at(pageIndex);
  const shown = paged && page ? [page] : chapters;
  const editingShown = editingEntry && entries.some(entry => entry.anchor === editingEntry) ? editingEntry : null;
  const active = editingShown ?? (paged ? page?.anchor ?? null : spied);
  const writable = !header.readOnly;
  // The position is kept in step before paint, not by a state update while rendering (an external-store re-render does not survive one). Reading continuously it
  // follows the chapter in view, or the one that edits, so switching to paged, whoever switches it, opens that chapter and no editor is unmounted by the switch (P7).
  // The scroll position only says which chapter is in view once the reader has scrolled since the mode changed; a page turn does not move it.
  const [scrolled, setScrolled] = useState(false);
  // Where the book's own jump left the scroll position: scroll events at that position are the jump's, not the reader's.
  const jumped = useRef<number | null>(null);
  useEffect(() => {
    if (!body || paged) return;
    const note = () => {
      if (jumped.current !== null && Math.abs(body.scrollTop - jumped.current) < 1) return;
      jumped.current = null;
      setScrolled(true);
    };
    body.addEventListener('scroll', note, { passive: true });
    return () => body.removeEventListener('scroll', note);
  }, [body, paged]);
  useLayoutEffect(() => {
    setScrolled(false);
  }, [paged]);
  useLayoutEffect(() => {
    const inView = !paged && (editingShown || scrolled) ? chapterOfAnchor(chapters, editingShown ?? spied ?? '') : undefined;
    const current = paged ? page : inView ?? page;
    if (current && (position.id !== current.id || position.index !== chapters.indexOf(current))) setPosition({ id: current.id, index: chapters.indexOf(current) });
  }, [paged, page, position, chapters, editingShown, spied, scrolled]);
  // What to do with the body once a new page has rendered: show its top, and for a page turn focus the heading or reveal the section the contents chose.
  const arrival = useRef<{ anchor: string; focus: boolean; } | null>(null);
  const turning = useRef(false);
  const shownBefore = useRef(readingMode);
  // A paged book mounts one chapter at a time, so a folder that leaves keeps its lines in the contents until its chapter does.
  const pagedNow = useRef(paged);
  // Written in a layout effect, which runs before the passive clean-up of a folder that the switch unmounts.
  useLayoutEffect(() => {
    pagedNow.current = paged;
  }, [paged]);

  const onEntries = useCallback((chapterId: string, next: BookEntry[], leaving = false) => {
    if (leaving && pagedNow.current) return;
    setSections(current => {
      const same = (current.get(chapterId) ?? []).length === next.length && next.every((entry, index) => current.get(chapterId)![index].anchor === entry.anchor && current.get(chapterId)![index].title === entry.title);
      if (same || (!next.length && !current.has(chapterId))) return current;
      const copy = new Map(current);
      if (next.length) copy.set(chapterId, next);
      else copy.delete(chapterId);
      return copy;
    });
  }, []);
  const chapterIds = chapters.map(chapter => chapter.id).join('\n');
  useEffect(() => {
    const present = new Set(chapterIds.split('\n'));
    setSections(current => {
      const gone = [...current.keys()].filter(id => !present.has(id));
      if (!gone.length) return current;
      const copy = new Map(current);
      for (const id of gone) copy.delete(id);
      return copy;
    });
  }, [chapterIds]);
  const onLiveTitle = useCallback((anchor: string, title: string | undefined) => {
    setLiveTitles(current => {
      if (current.get(anchor) === title) return current;
      const copy = new Map(current);
      if (title === undefined) copy.delete(anchor);
      else copy.set(anchor, title);
      return copy;
    });
  }, []);

  // A jump puts the heading at the top of the body, smoothly unless the reader asked for less motion, and focuses it where it is unless `focus` is off.
  const jump = (anchor: string, behavior: 'smooth' | 'auto' = 'smooth', focus = true) => {
    const heading = headings(body, anchor);
    if (!body || !heading) return;
    const top = body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.scrollTo({ top, behavior: reduced ? 'auto' : behavior });
    if (focus) heading.focus({ preventScroll: true });
  };
  // A page turn leaves a section that edits only once it is saved (P5); a failed save keeps the reader on the page with the editor's notice. False when the page did not turn.
  const goToPage = async (chapter: Chapter | undefined, anchor = chapter?.anchor) => {
    if (!chapter || !anchor || turning.current) return false;
    if (chapter.id === page?.id) return true;
    turning.current = true;
    try {
      if (editing && !await finish()) return false;
      arrival.current = { anchor, focus: true };
      setPosition({ id: chapter.id, index: chapters.indexOf(chapter) });
      return true;
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
  const jumpTo = async (anchor: string) => {
    const chapter = paged ? chapterOfAnchor(chapters, anchor) : undefined;
    if (!chapter || chapter.id === page?.id) {
      jump(anchor);
      return true;
    }
    return goToPage(chapter, anchor);
  };
  useEffect(() => {
    if (!body) return;
    const modeChanged = shownBefore.current !== readingMode;
    shownBefore.current = readingMode;
    const pending = arrival.current;
    arrival.current = null;
    if (!paged) {
      // Back to continuous, the reader is at the chapter the page showed, with focus left where it was.
      if (modeChanged && page) {
        jump(page.anchor, 'auto', false);
        jumped.current = body.scrollTop;
      }
      return;
    }
    if (modeChanged || pending) body.scrollTop = 0;
    if (!pending) return;
    // The page's own heading is there at once, and takes focus; a folder's note section arrives with the folder's notes, and takes it then.
    if (page && pending.anchor !== page.anchor) headings(body, page.anchor)?.focus({ preventScroll: true });
    const reveal = () => {
      const heading = headings(body, pending.anchor);
      if (!heading) return false;
      if (pending.anchor === page?.anchor) heading.focus({ preventScroll: true });
      else jump(pending.anchor, 'auto');
      return true;
    };
    if (reveal()) return;
    const observer = new MutationObserver(() => reveal() && observer.disconnect());
    observer.observe(body, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 5000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
    // `jump` reads only the body and the anchor; the effect runs when the page or the mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, paged, body]);
  // Reaching the last loaded page of a dynamic compilation loads the next batch, so Next stays available until every member is reachable.
  useEffect(() => {
    if (paged && chapters.length && pageIndex >= chapters.length - 1 && laneNotes.hasMore && !laneNotes.loadingMore && !laneNotes.loading && !laneNotes.error) laneNotes.loadMore();
    // `loadMore` is a new function each render; the page, the chapter count and the loading flags say when to ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, pageIndex, chapters.length, laneNotes.hasMore, laneNotes.loadingMore, laneNotes.loading, laneNotes.error]);
  const swipe = useBookPageInput({ active: paged, book, editing: Boolean(editing), onStep: step });
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
        <BookReadingToggle mode={readingMode} onChange={writeBookReadingMode} />
      </div>
      <div className='compilation-book-layout'>
        <BookContents {...contents} onJump={anchor => void jumpTo(anchor)} />
        <div {...swipe} ref={setBody} className='compilation-book' aria-label={`${row.name} · ${t('screen.items')}`}>{shown.map(chapter => <BookChapter key={chapter.id} chapter={chapter} assets={assets} writable={writable} onOpen={onOpen} onLiveTitle={onLiveTitle} onEntries={onEntries} />)} {laneNotes.error && <p role='alert' className='screen-error'>{laneNotes.error}</p>} {laneNotes.loading && <LoadingStatus className='screen-lane-empty'>{t('notes.loading')}</LoadingStatus>} {!paged && <NoteListSentinel hasMore={laneNotes.hasMore} loading={laneNotes.loadingMore} error={laneNotes.error} onLoadMore={laneNotes.loadMore} className='screen-lane-sentinel' />} {!chapters.length && !laneNotes.loading && <div className='screen-lane-empty'>{t(row.kind === 'custom' ? 'screen.emptyCustom' : 'screen.emptyDynamic')}</div>}</div>
      </div>
      {paged && chapters.length > 0 && <BookPager index={pageIndex} total={chapters.length} hasMore={laneNotes.hasMore} loadingMore={laneNotes.loadingMore} onStep={step} />}
      {drawer && book && (
        <BookDrawer
          {...contents}
          container={book}
          onJump={anchor => {
            setDrawer(false);
            // A page that stayed (a save that failed) leaves the reader where the drawer opened from.
            void jumpTo(anchor).then(turned => turned || opener.current?.focus());
          }}
          onClose={closeDrawer}
        />
      )}
    </section>
  );
}
