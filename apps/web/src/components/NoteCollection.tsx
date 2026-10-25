import { useLayoutEffect, useRef, useState } from 'react';
import { CardView } from './CardView.js';
import { FocusNoteList } from './FocusNoteList.js';
import { ListView, type ListViewProps } from './ListView.js';

/**
 * Below this width of the region the notes sit in (never the viewport, since a docked panel narrows it without
 * changing the viewport) the notes show as cards: a table row would leave the title only a few characters.
 */
export const NOTE_CARDS_BELOW = 720;

export type NoteCollectionLayout = 'list' | 'card';

export function noteCollectionLayout(width: number): NoteCollectionLayout {
  // An unmeasured region (0, as in tests) keeps the table.
  return width > 0 && width < NOTE_CARDS_BELOW ? 'card' : 'list';
}

/**
 * The flat and folder views' notes: a table where there is room for its columns, cards where there is not, and two-line rows
 * (`FocusNoteList`) in the narrow dock beside a Focus.
 */
export function NoteCollection(props: ListViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<NoteCollectionLayout>('list');
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    setLayout(noteCollectionLayout(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry) setLayout(noteCollectionLayout(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className='note-collection' data-layout={layout}>
      {props.focusMode?.compactRows ? <FocusNoteList {...props} /> : layout === 'list' ? <ListView {...props} /> : (
        <>
          {props.leading && <div className='note-collection-leading'>{props.leading}</div>}
          <CardView {...props} />
        </>
      )}
    </div>
  );
}
