/** The query parameter of a note address that asks to edit the note in the live editor on arrival. */
export const LIVE_EDIT_PARAM = 'edit';

/** Whether the query asks to edit the note live: `edit`, bare or with any value. */
export function asksLiveEdit(_search: string): boolean {
  return false;
}

/** `search` without `edit`, every other part kept as written; `?…`, or an empty string when nothing is left. */
export function searchWithoutLiveEdit(search: string): string {
  return search;
}
