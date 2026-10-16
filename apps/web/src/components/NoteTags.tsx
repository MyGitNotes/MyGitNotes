import React, { useLayoutEffect, useRef, useState } from 'react';
import { TagActions } from './TagActions.js';
import { useTranslation } from '../lib/i18n/index.js';

export interface NoteTagActions {
  allTags: string[];
  onPreviewUsage: (tag: string) => Promise<number>;
  onRename: (from: string, to: string) => Promise<void>;
  onMerge: (from: string, into: string) => Promise<void>;
  onDelete: (tag: string) => Promise<void>;
}

/**
 * How many chips, laid out in order, fit in `available` pixels beside a "+N" chip.
 * All of them when they fit without it; otherwise as many as leave room for the "+N" chip (possibly none).
 */
export function fitTagCount(widths: number[], available: number, gap: number, overflowWidth: number): number {
  const total = widths.reduce((sum, width, index) => sum + width + (index ? gap : 0), 0);
  if (total <= available) return widths.length;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + (count ? gap : 0) + width;
    if (next + gap + overflowWidth > available) break;
    used = next;
    count += 1;
  }
  return count;
}

/** Measures the chips of a one-line row and returns how many fit, re-measuring when the row's width or the tags change. */
function useFittedTagCount(tags: string[], enabled: boolean) {
  const row = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState({ key: '', count: tags.length });
  const key = tags.join('\u0000');
  useLayoutEffect(() => {
    const element = row.current;
    if (!enabled || !element) return;
    const measure = () => {
      const chips = Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-tag-chip]'));
      const more = element.querySelector<HTMLElement>(':scope > [data-tag-more]');
      const widths = chips.map(chip => chip.getBoundingClientRect().width);
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 4;
      // The "+N" chip is measured with its current digits; the widest label is the one that counts every tag.
      const shown = Number(more?.dataset.count ?? tags.length);
      const overflowWidth = (more?.getBoundingClientRect().width ?? 0) + 7 * (String(tags.length).length - String(shown).length);
      const count = fitTagCount(widths, element.getBoundingClientRect().width, gap, overflowWidth);
      setFitted(previous => previous.key === key && previous.count === count ? previous : { key, count });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, key, tags.length]);
  return { row, count: enabled && fitted.key === key ? Math.min(fitted.count, tags.length) : tags.length };
}

/**
 * A note's tags inside a list row or card, as tinted text chips; clicks here stay on the tags instead of opening the note.
 * `oneLine` keeps them on one line: the chips that do not fit collapse into a "+N" chip whose tooltip lists them.
 */
export const NoteTags: React.FC<{ tags: string[]; chipClassName?: string; tagActions?: NoteTagActions; className?: string; oneLine?: boolean; children?: React.ReactNode; }> = ({ tags, chipClassName = '', tagActions, className = '', oneLine = false, children }) => {
  const { t } = useTranslation();
  const { row, count } = useFittedTagCount(tags, oneLine);
  const hidden = tags.length - count;
  const rest = tags.slice(count);
  return (
    <div ref={row} className={`note-tags ${oneLine ? 'note-tags-one-line' : 'flex flex-wrap gap-1'} ${className}`} onClick={event => event.stopPropagation()}>
      {tags.map((tag, index) => {
        // A chip past the fit stays rendered, only out of sight and out of reach, so its width can be measured again.
        const overflowing = oneLine && index >= count;
        const attributes = { 'data-tag-chip': '', ...(overflowing ? { 'data-overflow': '', 'aria-hidden': true, inert: '' } : {}) };
        const chip = (extra: object) => (
          <span className={`note-tag-chip ${chipClassName}`} {...extra}>
            <span className='min-w-0 truncate'>{tag}</span>
          </span>
        );
        return tagActions
          ? (
            <div key={tag} className='sidebar-tag-row inline-flex items-center max-w-full' {...attributes}>
              <TagActions tag={tag} {...tagActions}>{chip({})}</TagActions>
            </div>
          )
          : <React.Fragment key={tag}>{chip(attributes)}</React.Fragment>;
      })}
      {oneLine && tags.length > 0 && <span data-tag-more='' data-count={hidden || tags.length} className={`note-tag-chip note-tag-more ${chipClassName}`} title={hidden ? rest.join(', ') : undefined} aria-label={hidden ? t('notes.moreTags', { count: hidden, tags: rest.join(', ') }) : undefined} aria-hidden={hidden ? undefined : true} {...(hidden ? {} : { 'data-overflow': '', inert: '' })}>+{hidden || tags.length}</span>}
      {children}
    </div>
  );
};
