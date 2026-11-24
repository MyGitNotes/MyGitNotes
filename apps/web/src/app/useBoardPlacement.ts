import { useEffect, useRef } from 'react';
import { type BoardPlacement, boardPlacement, type BrowsePresentation } from '../lib/browse-columns.js';
import { useKanbanPrefs } from '../lib/kanban-prefs.js';

export interface BoardPlacementState {
  /** Where the board stands; undefined while the list shows instead. */
  placement: BoardPlacement | undefined;
  /** 「開進 Focus」 beside the board: folds it into the list column. */
  fold: () => void;
  /** 「展開看板」: the board back beside the Focus; absent while the Focus has more than one pane, which keeps it folded. */
  unfold?: () => void;
}

/**
 * The board beside the Focus or folded into the list column. Folding is the person's choice beside a one-pane Focus, kept on this device so a
 * reload keeps it, and given up once the Focus shows no note again: the next card opened from the board opens beside it. A Focus of more panes
 * always folds the board; merging them back to one returns it to where the person left it.
 */
export function useBoardPlacement({ presentation, focusOpen, panes }: { presentation: BrowsePresentation; focusOpen: boolean; panes: number; }): BoardPlacementState {
  const [prefs, updatePrefs] = useKanbanPrefs();
  const wasOpen = useRef(focusOpen);
  useEffect(() => {
    if (wasOpen.current && !focusOpen && prefs.folded) updatePrefs({ folded: false });
    wasOpen.current = focusOpen;
  }, [focusOpen, prefs.folded, updatePrefs]);
  return { placement: presentation === 'kanban' ? boardPlacement({ focusOpen, panes, folded: prefs.folded }) : undefined, fold: () => updatePrefs({ folded: true }), unfold: panes > 1 ? undefined : () => updatePrefs({ folded: false }) };
}
