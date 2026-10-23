import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorState } from '../../lib/infographics/editor-state.js';

/** An open data editor's draft, which outlives the widget CodeMirror draws it in. */
export interface InfographicDraft {
  /** Where the block starts now; kept in place as the text before it changes. */
  from: number;
  /** The block's text the draft was made from; the draft is dropped when the text under it no longer matches. */
  source: string;
  /** The draft as of the last time the widget gave it up. */
  state: EditorState;
  /** Reads the live draft while the editor is mounted, with the cell being typed folded in. */
  read: (() => EditorState) | null;
}

/**
 * The drafts of the data editors open in one live editor. CodeMirror destroys a widget that scrolls out of the
 * viewport and builds it again when it scrolls back, so the draft cannot live in the widget: it lives here, per
 * view, and a rebuilt widget for the same unchanged block opens its editor from it. Updated before the view redraws,
 * so a widget that is destroyed in the same update still finds its draft at the block's new place.
 */
class InfographicDrafts {
  private drafts: InfographicDraft[] = [];

  update(update: ViewUpdate) {
    if (!update.docChanged) return;
    this.drafts = this.drafts.flatMap(draft => {
      draft.from = update.changes.mapPos(draft.from, 1);
      // Text changed underneath (typed in the source, undone, replaced): the draft no longer belongs to this block.
      return update.state.sliceDoc(draft.from, draft.from + draft.source.length) === draft.source ? [draft] : [];
    });
  }

  find(from: number, source: string): InfographicDraft | undefined {
    return this.drafts.find(draft => draft.from === from && draft.source === source);
  }

  /** Records the draft of the editor just opened on the block at `from`, or returns the one already kept for it. */
  open(from: number, source: string, state: EditorState): InfographicDraft {
    const kept = this.find(from, source);
    if (kept) return kept;
    const draft: InfographicDraft = { from, source, state, read: null };
    this.drafts.push(draft);
    return draft;
  }

  /** Forgets a draft: the editor was saved, cancelled or can no longer be shown. */
  discard(draft: InfographicDraft) {
    this.drafts = this.drafts.filter(kept => kept !== draft);
  }
}

export const infographicDrafts = ViewPlugin.fromClass(InfographicDrafts);

export const draftsOf = (view: EditorView): InfographicDrafts | null => view.plugin(infographicDrafts);
