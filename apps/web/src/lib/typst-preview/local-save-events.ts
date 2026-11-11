import type { PreviewNote } from './preview-target.js';

const listeners = new Set<(note: PreviewNote) => void>();

/** Says a note was just written to the local worktree; the Typst preview compiles again when it belongs to the project on screen. */
export function notifyLocalSave(note: PreviewNote): void {
  for (const listener of listeners) listener(note);
}

export function onLocalSave(listener: (note: PreviewNote) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
