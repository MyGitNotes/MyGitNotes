import { StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const caretPlaced = StateEffect.define<null>();

/** Whether the editor has had focus since it opened, so its selection marks where the writer was. */
const caretPlacedField = StateField.define<boolean>({ create: () => false, update: (placed, tr) => placed || tr.effects.some(effect => effect.is(caretPlaced)), provide: field => EditorView.editorAttributes.from(field, (placed): Record<string, string> => placed ? { class: 'cm-caret-placed' } : {}) });

/**
 * Keeps a still, dimmed caret where the writer left off while focus is elsewhere (the agent's chat input, a dialog),
 * as `drawSelection` hides its cursor layer the moment the editor blurs. An editor nobody has focused shows none, so
 * a freshly opened note does not claim a position at its start. The focus event dispatches the mark itself:
 * `focusChangeEffect` drops its transaction when the click's selection lands first.
 */
export const restingCaret = [
  caretPlacedField,
  EditorView.domEventHandlers({
    focus: (_event, view) => {
      if (!view.state.field(caretPlacedField)) view.dispatch({ effects: caretPlaced.of(null) });
    },
  }),
  EditorView.theme({ '&.cm-caret-placed:not(.cm-focused) > .cm-scroller > .cm-cursorLayer .cm-cursor.cm-cursor-primary': { display: 'block', borderLeftWidth: '2px', opacity: '0.45' } }),
];
