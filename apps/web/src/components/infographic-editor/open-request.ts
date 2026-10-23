import { StateEffect, StateField } from '@codemirror/state';

/** Asks the live editor to open the data editor of the infographic block that starts at this position; null withdraws the request. */
export const openInfographicEditor = StateEffect.define<number | null>();

/** The block start a request names, kept in place as the text around it changes until a widget takes it up. */
export const infographicEditorRequest = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    let next = value === null ? null : transaction.changes.mapPos(value, 1);
    for (const effect of transaction.effects) if (effect.is(openInfographicEditor)) next = effect.value;
    return next;
  },
});
