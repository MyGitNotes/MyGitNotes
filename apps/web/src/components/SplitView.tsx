import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { renderNote } from '../lib/markdown.js';
import { mapScroll, type ScrollPoint, scrollPoints } from '../lib/split-scroll.js';
import { youtubeLabels } from '../lib/youtube-embed.js';
import { NoteHtml } from './NoteHtml.js';

/** How long typing pauses before the preview is drawn again. */
const RENDER_DELAY_MS = 150;
/** Where the session keeps whether the panes scroll together: on by default, off once the person unlinks them. */
const SYNC_STORAGE_KEY = 'mygitnotes:split-scroll-sync';

const readSync = () => {
  try {
    return sessionStorage.getItem(SYNC_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};
const writeSync = (on: boolean) => {
  try {
    sessionStorage.setItem(SYNC_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage refused: the choice lasts while this view does.
  }
};

/** `value` once it stopped changing for `delay` ms; the first value at once. */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, settled, delay]);
  return settled;
}

type Pane = keyof ScrollPoint;

interface SplitViewProps {
  /** The source editor, drawn in the left pane. */
  source: ReactNode;
  /** The source editor's scrolling text area, whose lines are one line height each. */
  sourceScroller: RefObject<HTMLTextAreaElement | null>;
  content: string;
  path: string;
  notebookId?: string;
  slides?: boolean;
}

/**
 * Split view: the source editor on the left and the note rendered by the app's own pipeline on the right, drawn again
 * once the typing pauses. The divider holds the scroll sync switch; while it is on, a scroll of either pane brings the
 * other to the same place, by the source line each rendered block starts on.
 */
export function SplitView({ source, sourceScroller, content, path, notebookId, slides = false }: SplitViewProps) {
  const { t } = useTranslation();
  const [sync, setSync] = useState(readSync);
  const settled = useSettled(content, RENDER_DELAY_MS);
  const tableLabel = t('preview.scrollableTable');
  const html = useMemo(() => renderNote(settled, path, tableLabel, youtubeLabels(t), notebookId, { sourceLines: true, ...slides ? { slides: 'preview' as const } : {} }), [settled, path, tableLabel, t, notebookId, slides]);
  const preview = useRef<HTMLDivElement>(null);
  const syncRef = useRef(sync);
  useLayoutEffect(() => {
    syncRef.current = sync;
  });
  // The map is measured when a scroll needs it, and measured again after the preview or either pane changed size.
  const points = useRef<ScrollPoint[] | null>(null);
  // The offset a scroll set on a pane: the scroll event it fires is the echo, not the person, and is not followed back.
  const echo = useRef<{ pane: Pane; top: number; } | null>(null);

  const measure = (): ScrollPoint[] | null => {
    const textarea = sourceScroller.current, scroller = preview.current;
    if (!textarea || !scroller) return null;
    if (points.current) return points.current;
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 22.75;
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop + (parseFloat(getComputedStyle(scroller).paddingTop) || 0);
    const anchors = [...scroller.querySelectorAll<HTMLElement>('[data-source-line]')].map(element => ({ source: (Number(element.dataset.sourceLine) - 1) * lineHeight, preview: element.getBoundingClientRect().top - top }));
    points.current = scrollPoints(anchors, { source: textarea.scrollHeight - textarea.clientHeight, preview: scroller.scrollHeight - scroller.clientHeight });
    return points.current;
  };
  const elementOf = (pane: Pane) => pane === 'source' ? sourceScroller.current : preview.current;
  /** Brings the other pane to the place `from` scrolled to. */
  const follow = (from: Pane) => {
    const map = measure(), target = elementOf(from === 'source' ? 'preview' : 'source'), origin = elementOf(from);
    if (!map || !target || !origin) return;
    const top = Math.round(mapScroll(map, origin.scrollTop, from));
    if (Math.abs(target.scrollTop - top) < 1) return;
    target.scrollTop = top;
    echo.current = { pane: from === 'source' ? 'preview' : 'source', top: target.scrollTop };
  };
  const followRef = useRef(follow);
  useLayoutEffect(() => {
    followRef.current = follow;
  });
  const onScroll = (pane: Pane) => {
    const element = elementOf(pane), last = echo.current;
    if (last?.pane === pane) {
      echo.current = null;
      if (element && Math.abs(element.scrollTop - last.top) <= 1) return;
    }
    if (syncRef.current) followRef.current(pane);
  };
  const onScrollRef = useRef(onScroll);
  useLayoutEffect(() => {
    onScrollRef.current = onScroll;
  });

  // The source text area is the editor's own, rebuilt for another note.
  useEffect(() => {
    const textarea = sourceScroller.current;
    if (!textarea) return;
    const listener = () => onScrollRef.current('source');
    textarea.addEventListener('scroll', listener, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
        // An image or a diagram drawn late moves the blocks: the map is measured again and the preview kept on the source's place.
        points.current = null;
        if (syncRef.current) followRef.current('source');
      }) : null;
    resize?.observe(textarea);
    if (preview.current) resize?.observe(preview.current);
    if (preview.current?.firstElementChild) resize?.observe(preview.current.firstElementChild);
    return () => {
      textarea.removeEventListener('scroll', listener);
      resize?.disconnect();
    };
  }, [sourceScroller, path]);
  // A new rendering moves the blocks: the preview follows the source to keep the place being edited in view.
  useLayoutEffect(() => {
    points.current = null;
    if (syncRef.current) followRef.current('source');
  }, [html]);

  const toggle = () => {
    const next = !sync;
    setSync(next);
    writeSync(next);
    if (next) {
      points.current = null;
      follow('source');
    }
  };
  const label = t('editor.scrollSync');
  return (
    <div className='note-split-view' data-split-view>
      <div className='note-split-pane' data-split-part='source'>{source}</div>
      <div className='note-split-divider' data-split-part='divider'>
        <button type='button' className='ui-icon-button note-split-sync' aria-label={label} aria-pressed={sync} title={t(sync ? 'editor.scrollSyncOn' : 'editor.scrollSyncOff')} onClick={toggle}>
          {sync ? <Link2 aria-hidden='true' /> : <Link2Off aria-hidden='true' />}
        </button>
      </div>
      <div ref={preview} className='note-split-preview' data-split-part='preview' data-split-preview onScroll={() => onScrollRef.current('preview')}>
        <NoteHtml className='prose-custom screen-markdown' html={html} notebookId={notebookId} />
      </div>
    </div>
  );
}
