/**
 * Whether Enter pressed on `target` expands or collapses the graph's selected nodes.
 * A graph zoomed in a compilation dialog is itself inside a dialog. A key from a note editor that zoom borrowed from a card
 * reaches the graph's React handler, though its element sits outside the graph, so only a key from inside the graph counts;
 * a form control, an editable text and a dialog the graph holds (its save dialog) keep Enter for themselves.
 */
export function graphOwnsEnter(graph: Element, target: Element): boolean {
  if (!graph.contains(target)) return false;
  if (target.closest('button,input,textarea,select,[contenteditable="true"]')) return false;
  const dialog = target.closest('dialog,[role="dialog"]');
  return !(dialog && graph.contains(dialog));
}
