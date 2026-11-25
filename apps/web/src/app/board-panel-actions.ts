import type { useNavigate } from 'react-router-dom';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { BoardPanelActions } from '../components/board/useBoardPanel.js';
import { focusErrorMessage } from '../lib/focus-error-message.js';
import { CURRENT_FOCUS } from '../lib/focus-view.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { notebookRoute } from '../lib/routes.js';
import type { NoteFocus } from '../lib/use-note-focus.js';

interface Params {
  noteFocus: Pick<NoteFocus, 'shown' | 'view' | 'focuses' | 'entryOf' | 'place'>;
  selectedNotebookId: string;
  flushEditors: () => Promise<boolean>;
  navigate: ReturnType<typeof useNavigate>;
  handleOpenNote: (note: NoteListItem) => unknown;
  /** Closes a zoom the panel sat in, as the Add to Focus picker does once it placed a note. */
  closeZoomState: () => void;
  showFocus: () => void;
  setActionError: (message: string) => void;
  t: I18nContextValue['t'];
}

/**
 * The page's answers to a board's side panel: 「開進 Focus」 adds the note as a tab of the active pane of the notebook's
 * current Focus (the one the Notes page shows, else the one it showed last) and goes to the Notes page there;
 * 「全螢幕」 opens the note in zoom.
 */
export function boardPanelActions({ noteFocus, selectedNotebookId, flushEditors, navigate, handleOpenNote, closeZoomState, showFocus, setActionError, t }: Params): BoardPanelActions {
  const openInFocus = async (note: NoteListItem) => {
    if (note.notebookId !== selectedNotebookId || !await flushEditors()) return;
    const last = noteFocus.view.last;
    const target = noteFocus.shown ?? (last && (last === CURRENT_FOCUS || noteFocus.focuses.some(focus => focus.id === last)) ? last : CURRENT_FOCUS);
    const entry = noteFocus.entryOf(target);
    try {
      if (!entry || !await noteFocus.place(target, { kind: 'note', path: note.path }, entry.activePane)) return setActionError(t('focus.addFailed'));
    } catch (caught) {
      return setActionError(focusErrorMessage(t, caught));
    }
    closeZoomState();
    showFocus();
    navigate(`${notebookRoute(selectedNotebookId)}?${new URLSearchParams({ focus: target })}`);
  };
  return { focusNotebook: selectedNotebookId, openInFocus: note => void openInFocus(note), fullscreen: note => void handleOpenNote(note) };
}
