import { noteRefKey } from '@mygitnotes/core/note-query';
import { type RefObject, useEffect } from 'react';
import type { EditorMode } from '../../lib/editor-mode-url.js';
import type { NoteItem } from '../../lib/types.js';
import type { MarkdownEditorHandle } from '../MarkdownEditor.js';
import type { ZoomNavigation } from './types.js';

type SelectionEditor = Pick<MarkdownEditorHandle, 'ready' | 'getSelection' | 'revealRange'>;

export function useZoomToggle({ navigation, note, frame, active, mode, editor, collabEditor, collabShown }: {
  navigation: ZoomNavigation | undefined;
  note: NoteItem;
  frame: string;
  active: boolean;
  mode: EditorMode;
  editor: RefObject<SelectionEditor | null>;
  collabEditor: RefObject<SelectionEditor | null>;
  collabShown: boolean;
}) {
  const key = noteRefKey(note);
  const transfer = navigation?.selection;
  const editorInUse = collabShown ? collabEditor : editor;
  useEffect(() => {
    const saved = transfer?.current;
    if (!active || !transfer || saved?.key !== key || saved.frame !== frame) return;
    // Live Preview can be lazy when the destination mounts; wait for its editor, not just its outer frame.
    const deadline = performance.now() + 2000;
    let request = requestAnimationFrame(function restore() {
      if (transfer.current !== saved) return;
      const target = editorInUse.current;
      if (target?.ready()) {
        transfer.current = null;
        target.revealRange(saved.from, saved.to, true);
      } else if (performance.now() < deadline) request = requestAnimationFrame(restore);
      else transfer.current = null;
    });
    return () => cancelAnimationFrame(request);
  }, [active, editorInUse, frame, key, transfer]);

  const move = frame === 'pane' ? navigation?.open : frame === 'zoom' ? navigation?.returnToFocus : undefined;
  if (!move) return undefined;
  return async () => {
    const range = editorInUse.current?.getSelection();
    const saved = range ? { ...range, key, frame: frame === 'pane' ? 'zoom' as const : 'pane' as const } : null;
    if (transfer) transfer.current = saved;
    let moved = false;
    try {
      moved = await move(mode);
    } finally {
      if (!moved && transfer?.current === saved) transfer.current = null;
    }
  };
}
