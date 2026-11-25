import { useMemo } from 'react';
import type { TextMatch } from '../../lib/note-navigation.js';
import { type LineColumn, positionsOfOffsets } from '../../lib/overview-rail/landmarks.js';
import { useNoteViewPreferences } from '../../lib/editor-preferences.js';
import { usePhone } from '../../lib/use-phone.js';
import type { OverviewRailOptions } from './OverviewRail.js';

const NO_MATCHES: readonly TextMatch[] = [];
const NO_PLACES: readonly LineColumn[] = [];

/**
 * The scroll overview a note editor's frame shows: in zoom and in a Focus pane on a desktop, while the view setting has it on, in
 * live and source modes alike. `matches` are find's in `content`, passed while the find panel is open; `lineOffset` is how many lines
 * the editor holds before `content` (the collab editor's frontmatter).
 */
export function useOverviewRail(frame: 'zoom' | 'pane' | 'inline', content: string, matches: readonly TextMatch[] | null, lineOffset = 0): OverviewRailOptions | undefined {
  const { overviewRail } = useNoteViewPreferences();
  const phone = usePhone();
  const shown = overviewRail && !phone && (frame === 'zoom' || frame === 'pane');
  const found = matches ?? NO_MATCHES;
  const places = useMemo(() => shown && found.length ? positionsOfOffsets(content, found.map(match => match.from)).map(place => ({ line: place.line + lineOffset, column: place.column })) : NO_PLACES, [shown, content, found, lineOffset]);
  return useMemo(() => shown ? { matches: places } : undefined, [shown, places]);
}
