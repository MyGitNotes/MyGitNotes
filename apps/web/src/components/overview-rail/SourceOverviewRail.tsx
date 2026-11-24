import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { type RailAdapter, textareaRailAdapter } from './adapter.js';
import type { RailLabels } from './landmarks-of.js';
import { OverviewRail, type OverviewRailOptions } from './OverviewRail.js';

interface SourceOverviewRailProps extends OverviewRailOptions {
  /** The source textarea; rendered after it, so the element is there when this mounts. */
  area: RefObject<HTMLTextAreaElement>;
  slides: boolean;
  /** The text the textarea shows: a value set from outside fires no input event. */
  content: string;
}

/** The overview rail of the source editor's textarea. */
export function SourceOverviewRail({ area, slides, content, matches }: SourceOverviewRailProps) {
  const { t } = useTranslation();
  // The labels are read when the landmarks are, through a ref: the adapter follows the textarea alone. Outside the language provider
  // `t` is a new function every render, and an adapter made anew with it would make the rail measure and render again without end.
  const labels = useRef<RailLabels>({ page: '', block: () => '' });
  /* eslint-disable react/refs -- The adapter reads the current labels through the ref. */
  labels.current = { page: t('editor.page'), block: (key, params) => t(key, params) };
  /* eslint-enable react/refs */
  const [adapter, setAdapter] = useState<RailAdapter | null>(null);
  useEffect(() => {
    const element = area.current;
    // eslint-disable-next-line react/set-state-in-effect -- The textarea exists only after mount; its adapter follows that element.
    setAdapter(element ? textareaRailAdapter(element, slides, () => labels.current) : null);
  }, [area, slides]);
  return adapter && <OverviewRail adapter={adapter} matches={matches} revision={content} />;
}
