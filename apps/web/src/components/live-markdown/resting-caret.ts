import { type EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const caretPlaced = StateEffect.define<null>();

/** Whether the editor has had focus since it opened, so its selection marks where the writer was. */
const caretPlacedField = StateField.define<boolean>({ create: () => false, update: (placed, tr) => placed || tr.effects.some(effect => effect.is(caretPlaced)), provide: field => EditorView.editorAttributes.from(field, (placed): Record<string, string> => placed ? { class: 'cm-caret-placed' } : {}) });

/** Whether the writer has placed a caret in the editor, which then marks a position even while focus is elsewhere. */
export const caretPlacedIn = (state: EditorState) => state.field(caretPlacedField, false) ?? false;

/** Whether a replaced range spanning lines, or a block widget, holds the main caret. */
function caretInCollapsedBlock(view: EditorView): boolean {
  const { head } = view.state.selection.main, doc = view.state.doc;
  let covered = false;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === 'function' ? source(view) : source;
    set.between(head, head, (from, to, value) => {
      if (value.point && (value.spec.block || doc.lineAt(from).number !== doc.lineAt(to).number)) covered = true;
      return covered ? false : undefined;
    });
    if (covered) return true;
  }
  return false;
}

/**
 * Keeps a still, dimmed caret where the writer left off while focus is elsewhere (the agent's chat input, a dialog),
 * as `drawSelection` hides its cursor layer the moment the editor blurs. An editor nobody has focused shows none, so
 * a freshly opened note does not claim a position at its start. The focus event dispatches the mark itself:
 * `focusChangeEffect` drops its transaction when the click's selection lands first.
 */
export const restingCaret = [
  caretPlacedField,
  // A blurred editor collapses the block the caret was in (a directive, a table, a diagram) into its rendered card, where
  // the caret would be drawn as a bar the card's full height; the card itself shows where the writer was.
  EditorView.editorAttributes.of(view => view.hasFocus || !caretInCollapsedBlock(view) ? null : { class: 'cm-caret-covered' }),
  EditorView.domEventHandlers({
    focus: (_event, view) => {
      if (!view.state.field(caretPlacedField)) view.dispatch({ effects: caretPlaced.of(null) });
    },
  }),
  EditorView.theme({ '&.cm-caret-placed:not(.cm-focused):not(.cm-caret-covered) > .cm-scroller > .cm-cursorLayer .cm-cursor.cm-cursor-primary': { display: 'block', borderLeftWidth: '2px', opacity: '0.45' } }),
];
