import { ChangeSet, type ChangeSpec, EditorSelection, EditorState, type Extension, Transaction, type TransactionSpec } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { ySyncAnnotation } from 'y-codemirror.next';
import { noteFrontmatterSpan } from '@mygitnotes/core/frontmatter';

/** Frontmatter longer than this is not looked for: a note's metadata is a few lines. */
const MAX_FRONTMATTER = 64 * 1024;

/** A collab text's leading frontmatter, as core's `parseNoteContent` reads it. */
export interface CollabFrontmatter {
  /** Just past the closing fence. */
  end: number;
  /** Past the blank separator line too: where the body starts. */
  bodyStart: number;
  /** The YAML parses to a map: the block is hidden; otherwise it shows raw. */
  valid: boolean;
}

/** The leading frontmatter of the editor's text, or null without one. */
export function collabFrontmatter(state: EditorState): CollabFrontmatter | null {
  const span = noteFrontmatterSpan(state.doc.sliceString(0, Math.min(state.doc.length, MAX_FRONTMATTER)));
  return span && { end: span.end, bodyStart: span.bodyStart, valid: !('invalid' in span) };
}

/** Where the note's leading frontmatter ends, or 0 when it has none. */
export const frontmatterEnd = (state: EditorState): number => {
  const block = collabFrontmatter(state);
  return block ? (block.valid ? block.bodyStart : block.end) : 0;
};

/** The hidden block: no height, no line number. */
export class HiddenFrontmatter extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const element = document.createElement('div');
    element.className = 'live-md-frontmatter-hidden';
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
  get estimatedHeight() {
    return 0;
  }
  ignoreEvent() {
    return true;
  }
}

const line = Decoration.line({ class: 'live-md-frontmatter' });
const hidden = Decoration.replace({ block: true, widget: new HiddenFrontmatter() });

/**
 * The collab editor holds the whole file, frontmatter included, where the direct editor shows only the body. A block that
 * parses to a map is hidden through its blank separator line, its fields read and written in the document panel instead;
 * one that does not parse keeps none of the body's decorations and its lines are marked `live-md-frontmatter`, drawn as
 * plain monospace text to fix by hand.
 */
export function withFrontmatter(state: EditorState, decorations: DecorationSet): DecorationSet {
  const block = collabFrontmatter(state);
  if (!block) return decorations;
  if (block.valid) {
    // The replaced range ends at the last hidden line's end, so the body's first line stays a line of its own.
    const to = Math.max(0, block.bodyStart - 1);
    return decorations.update({ filter: from => from >= block.bodyStart, add: [hidden.range(0, to)], sort: true });
  }
  const last = state.doc.lineAt(block.end - 1).number;
  const lines = [];
  for (let number = 1; number <= last; number++) lines.push(line.range(state.doc.line(number).from));
  return decorations.update({ filter: from => from >= block.end, add: lines, sort: true });
}

/** Moves a position out of the hidden range. */
const clamp = (position: number, bodyStart: number) => Math.max(position, bodyStart);

/**
 * Keeps this view's own changes (typing, paste, select-all and delete, Vim, format commands, inserts from the agent panel)
 * out of a hidden frontmatter block: each change is cut to the body, an insertion before it moves to the body's start.
 * The binding's transactions (another tab, the panel's writes through the `Y.Text`) pass untouched.
 */
const keepOutOfFrontmatter = (transaction: Transaction): Transaction | TransactionSpec | readonly TransactionSpec[] => {
  if (transaction.annotation(ySyncAnnotation) !== undefined) return transaction;
  const block = collabFrontmatter(transaction.startState);
  if (!block?.valid || block.bodyStart === 0) return transaction;
  const { bodyStart } = block;
  let touched = false;
  transaction.changes.iterChangedRanges(fromA => {
    if (fromA < bodyStart) touched = true;
  });
  const selection = transaction.selection;
  const selectionInside = selection?.ranges.some(range => range.from < bodyStart);
  if (!touched && !selectionInside) return transaction;
  if (!touched) {
    const docLength = transaction.newDoc.length;
    return [{ selection: EditorSelection.create(selection!.ranges.map(range => EditorSelection.range(Math.min(clamp(range.anchor, bodyStart), docLength), Math.min(clamp(range.head, bodyStart), docLength))), selection!.mainIndex), effects: transaction.effects, scrollIntoView: transaction.scrollIntoView }];
  }
  const changes: ChangeSpec[] = [];
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = clamp(fromA, bodyStart), to = clamp(toA, bodyStart);
    if (from === to && inserted.length === 0) return;
    changes.push({ from, to, insert: inserted });
  });
  const set = ChangeSet.of(changes, transaction.startState.doc.length);
  const end = changes.length ? set.mapPos((changes[changes.length - 1] as { from: number; }).from, 1) : bodyStart;
  const userEvent = transaction.annotation(Transaction.userEvent);
  return [{ changes: set, selection: { anchor: clamp(end, bodyStart) }, effects: transaction.effects, scrollIntoView: true, ...(userEvent ? { userEvent } : {}) }];
};

/** The collab editor's hidden frontmatter: atomic for the caret, protected from local edits. */
export function collabFrontmatterGuard(decorations: (view: EditorView) => DecorationSet): Extension {
  return [EditorView.atomicRanges.of(view => decorations(view).update({ filter: (_from, _to, decoration) => decoration.spec.widget instanceof HiddenFrontmatter })), EditorState.transactionFilter.of(keepOutOfFrontmatter)];
}
