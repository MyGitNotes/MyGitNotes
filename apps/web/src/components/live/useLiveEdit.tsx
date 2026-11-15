import { noteRefKey } from '@mygitnotes/core/note-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from '../../lib/i18n/index.js';
import { checkOutLive, keepsDirectEditor, type LiveCheckoutView, type LiveNoteEditing, requestLiveEdit, takeLiveEditRequest } from '../../lib/live-api.js';
import type { LiveTheme } from '../../lib/live-message.js';
import { getThemeChoice, resolveMode, subscribeThemeChoice } from '../../lib/themes.js';
import type { NoteItem } from '../../lib/types.js';
import { EditorNotice } from '../EditorNotice.js';
import { LoadingStatus } from '../LoadingStatus.js';

/** The app's light or dark mode now, which the framed editor follows. */
export function useLiveTheme(): LiveTheme {
  const choice = useSyncExternalStore(subscribeThemeChoice, getThemeChoice);
  const [system, setSystem] = useState(() => resolveMode('system'));
  useEffect(() => {
    if (choice.mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [choice.mode]);
  return choice.mode === 'system' ? system : resolveMode(choice.mode);
}

interface LiveEditState {
  checkout?: LiveCheckoutView;
  busy?: boolean;
  error?: string;
  /** Why the note opens in the direct editor instead: the live editor refused it. */
  direct?: string;
}

/**
 * A note editor's live editing (spec §8): while the note's repository has a live editor the note is read-only, and 編輯
 * checks it out and frames the editor in zoom; elsewhere 編輯 opens zoom, which checks it out on arrival. A pending note
 * opens its frame at once in zoom. A note the editor refuses (too large, or not a kind it takes) gets the direct editor.
 * `refetch` reads the note again after the live text changed or the note was checked in.
 */
export function useLiveEdit({ note, live, frame, refetch }: { note: NoteItem; live?: LiveNoteEditing; frame: string; refetch: () => void; }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LiveEditState>({});
  const zoom = frame === 'zoom';
  const key = noteRefKey(note);
  const latest = useRef({ refetch, live, notebookId: note.notebookId, path: note.path });
  useEffect(() => {
    latest.current = { refetch, live, notebookId: note.notebookId, path: note.path };
  });

  const checkOut = useCallback(async () => {
    const { notebookId, path } = latest.current;
    setState({ busy: true });
    try {
      const { checkout } = await checkOutLive(notebookId, path);
      setState({ checkout });
      latest.current.live?.onRefetch();
    } catch (error) {
      setState(keepsDirectEditor(error) ? { direct: t((error as { code?: string; }).code === 'too-large' ? 'live.tooLarge' : 'live.notLive') } : { error: (error as Error).message });
    }
  }, [t]);

  // Zoom checks out a note a pane asked to edit, and frames a pending note at once, each once per arrival.
  const pending = Boolean(note.live?.pending);
  const arrived = useRef(false);
  useEffect(() => {
    if (!live || !zoom) {
      arrived.current = false;
      return;
    }
    if (arrived.current) return;
    arrived.current = true;
    /* eslint-disable react/set-state-in-effect -- Arriving in zoom starts a checkout request; its busy state is that request's. */
    if (takeLiveEditRequest(key) || pending) void checkOut();
    /* eslint-enable react/set-state-in-effect */
  }, [live, zoom, key, pending, checkOut]);

  // Only zoom frames the editor; a note zoom hands back to its pane shows the read view there.
  if (!zoom && state.checkout) setState({});

  const active = Boolean(live) && !state.direct;
  const edit = !active || state.busy || state.checkout ? undefined : () => {
    if (zoom) return void checkOut();
    requestLiveEdit(key);
    live?.openZoom?.();
  };
  const close = () => setState({});
  const conflict = note.live?.conflict;
  const notices = <>{state.busy && <LoadingStatus className='editor-notice'>{t('live.checkingOut')}</LoadingStatus>}{state.error && <EditorNotice tone='error'>{state.error}</EditorNotice>}{state.direct && <EditorNotice>{state.direct}</EditorNotice>}{active && conflict && !state.checkout && <EditorNotice>{t('live.conflict', { commit: conflict.overwritten.slice(0, 7) })}</EditorNotice>}</>;
  return { active, checkout: zoom ? state.checkout : undefined, edit, close, notices, refetch: () => latest.current.refetch() };
}
