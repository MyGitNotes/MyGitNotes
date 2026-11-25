import { type KeyboardEvent, useMemo, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import { linkedCandidates, linkedOffBoard } from '../../lib/board/drawer.js';
import type { PlacedCard } from '../../lib/board/placement.js';
import { boardToScreen, type Camera } from '../../lib/board/zoom.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { useNoteGraph, useNoteLookup } from '../../lib/use-note-queries.js';
import './board-drawer.css';

/** The menu's keys are its own: the board under it must not move its selection on an arrow key. */
const own = (event: KeyboardEvent) => event.stopPropagation();

/**
 * 「＋N 相連」 on the corner of the one selected note card: how many notes link to or from its note, in either
 * direction, that the board does not show (same repository, not hidden). Pressing it lists them with check boxes,
 * all checked; 「加入」 adds the checked ones beside the card (`onAdd`). Nothing shows while there are none.
 */
export function BoardLinked({ card, note, camera, shown, onAdd }: { card: PlacedCard; note: NoteRef; camera: Camera; shown: ReadonlySet<string>; onAdd: (notes: NoteRef[]) => void; }) {
  const { t } = useTranslation();
  const graph = useNoteGraph(true);
  const links = graph.graph?.links;
  const candidates = useMemo(() => links ? linkedCandidates(links, note, shown) : [], [links, note, shown]);
  const lookup = useNoteLookup(candidates, false);
  const offered = links ? linkedOffBoard(links, note, shown, lookup.notes) : [];
  // Unchecked ones are remembered; a note offered later starts checked.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  if (!offered.length) return null;
  const checked = offered.filter(candidate => !unchecked.has(noteRefKey(candidate)));
  const corner = boardToScreen(camera, { x: card.rect.x + card.rect.w, y: card.rect.y });
  const toggle = (key: string) => {
    const next = new Set(unchecked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setUnchecked(next);
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className='board-linked' data-board-control='' style={{ left: corner.x, top: corner.y }} aria-label={t('board.linkedLabel', { count: String(offered.length) })} onKeyDown={own}>{t('board.linked', { count: String(offered.length) })}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className='focus-menu board-linked-menu' align='end' sideOffset={4} collisionPadding={8} onKeyDown={own}>
          <DropdownMenu.Label className='board-linked-title'>{t('board.linkedTitle')}</DropdownMenu.Label>
          {offered.map(candidate => {
            const key = noteRefKey(candidate);
            return (
              <DropdownMenu.CheckboxItem key={key} checked={!unchecked.has(key)} onCheckedChange={() => toggle(key)} onSelect={event => event.preventDefault()}>
                <span className='board-linked-check' aria-hidden='true'>
                  <DropdownMenu.ItemIndicator>
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span>{candidate.title || candidate.path}</span>
              </DropdownMenu.CheckboxItem>
            );
          })}
          <DropdownMenu.Separator className='board-linked-separator' />
          <DropdownMenu.Item className='board-linked-add' disabled={!checked.length} onSelect={() => onAdd(checked.map(candidate => ({ notebookId: candidate.notebookId, path: candidate.path })))}>{t('board.linkedAdd', { count: String(checked.length) })}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
