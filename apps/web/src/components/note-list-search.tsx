import type { KeyboardEvent, RefObject } from 'react';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowDownZA, ArrowUpWideNarrow, CalendarArrowDown, CalendarArrowUp, ClockArrowDown, ClockArrowUp, ListOrdered } from 'lucide-react';
import { metadataSortOptions } from '../lib/note-sort-options.js';
import { useTranslation } from '../lib/i18n/index.js';

/** The orders the notes list offers, as the sort menu lists them. */
export const noteSortOptions = (t: ReturnType<typeof useTranslation>['t'], metadataSortFields: readonly string[] = []) => [{ value: 'updated:desc', label: t('sort.updatedDesc'), Icon: ClockArrowDown }, { value: 'updated:asc', label: t('sort.updatedAsc'), Icon: ClockArrowUp }, { value: 'created:desc', label: t('sort.createdDesc'), Icon: CalendarArrowDown }, { value: 'created:asc', label: t('sort.createdAsc'), Icon: CalendarArrowUp }, { value: 'title:asc', label: t('sort.titleAsc'), Icon: ArrowDownAZ }, { value: 'title:desc', label: t('sort.titleDesc'), Icon: ArrowDownZA }, { value: 'status:asc', label: t('sort.status'), Icon: ListOrdered }, ...metadataSortOptions(t, metadataSortFields).map(option => ({ ...option, Icon: option.value.endsWith(':desc') ? ArrowDownWideNarrow : ArrowUpWideNarrow }))];

/** Lets the "Search note text" command reach a note search field, opening it first where it is behind a button. */
export interface NoteSearchHandle {
  focus: () => void;
}

/**
 * A note search's one ✕ (and Esc): it clears a search first, keeping the field and the cursor; on an empty field it closes the field and
 * returns to its button. Where the field is always shown its button is hidden and cannot take focus, so the cursor stays in the field.
 */
export function useClearOrClose({ query, onQueryChange, open, setOpen, input, toggle }: { query: string; onQueryChange: (query: string) => void; open: boolean; setOpen: (open: boolean) => void; input: RefObject<HTMLInputElement | null>; toggle: RefObject<HTMLButtonElement | null>; }) {
  const { t } = useTranslation();
  const hasQuery = query !== '';
  const clearOrClose = () => {
    if (hasQuery) {
      onQueryChange('');
      input.current?.focus();
      return;
    }
    setOpen(false);
    toggle.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && (open || hasQuery)) {
      event.preventDefault();
      clearOrClose();
    }
  };
  return { hasQuery, clearOrClose, closeLabel: hasQuery ? t('header.clearSearch') : t('common.close'), onKeyDown };
}
