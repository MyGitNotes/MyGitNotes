import { queryPartName } from './editor-mode-url.js';

/**
 * The query parameter of a note address that asks to edit the note in the live editor on arrival, as 編輯 would: an
 * app that created the note links to `<note address>?edit` (or `?zoom&edit`) so the person lands in co-editing.
 */
export const LIVE_EDIT_PARAM = 'edit';

const parts = (search: string) => search.replace(/^\?/, '').split('&').filter(Boolean);

/** Whether the query asks to edit the note live: `edit`, bare or with any value. */
export function asksLiveEdit(search: string): boolean {
  return parts(search).some(part => queryPartName(part) === LIVE_EDIT_PARAM);
}

/** `search` without `edit`, every other part kept as written; `?…`, or an empty string when nothing is left. */
export function searchWithoutLiveEdit(search: string): string {
  const kept = parts(search).filter(part => queryPartName(part) !== LIVE_EDIT_PARAM);
  return kept.length ? `?${kept.join('&')}` : '';
}
