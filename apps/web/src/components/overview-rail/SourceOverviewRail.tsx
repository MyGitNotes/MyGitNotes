import { type RefObject, useEffect, useState } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { type RailAdapter, textareaRailAdapter } from './adapter.js';
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
  const page = t('editor.page');
  const [adapter, setAdapter] = useState<RailAdapter | null>(null);
  useEffect(() => {
    const element = area.current;
    setAdapter(element ? textareaRailAdapter(element, slides, { page, block: (key, params) => t(key, params) }) : null);
  }, [area, slides, page, t]);
  return adapter && <OverviewRail adapter={adapter} matches={matches} revision={content} />;
}
