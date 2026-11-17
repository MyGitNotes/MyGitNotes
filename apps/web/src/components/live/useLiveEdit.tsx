import { noteRefKey } from '@mygitnotes/core/note-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useLiveEditLink } from '../../app/live-edit-link.js';
import { type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { isNetworkFailure } from '../../lib/api.js';
import { onReachable, RETRY_FIRST_MS, retryOnTimer } from '../../lib/live-reachability.js';
import { createUnifiedDiff } from '../../lib/unified-diff.js';
import { noteFileText } from '../../lib/live-handover.js';
import { checkInLive, checkOutLive, forgetCheckedIn, isNotLive, keepsDirectEditor, type LiveCheckInAnswer, type LiveCheckoutView, type LiveFileActions, type LiveNoteEditing, markCheckedIn, markRefusal, recentCheckIn, recentRefusal, requestLiveEdit, takeLiveEditRequest } from '../../lib/live-api.js';
import type { LiveTheme } from '../../lib/live-message.js';
import { getFamily, getThemeView, resolveMode, subscribeThemeChoice } from '../../lib/themes.js';
import type { NoteItem } from '../../lib/types.js';
import { EditorNotice } from '../EditorNotice.js';
import { Button } from '../Button.js';
import { LoadingStatus } from '../LoadingStatus.js';

/** The app's light or dark mode now, which the framed editor follows. */
export function useLiveTheme(): LiveTheme {
  const { choice, familyId } = useSyncExternalStore(subscribeThemeChoice, getThemeView);
  const fixed = getFamily(familyId).fixedMode;
  const [system, setSystem] = useState(() => resolveMode('system'));
  useEffect(() => {
    if (choice.mode !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [choice.mode]);
  return fixed ?? (choice.mode === 'system' ? system : resolveMode(choice.mode));
}

interface LiveEditState {
  checkout?: LiveCheckoutView;
  busy?: boolean;
  error?: string;
  /** Why the note opens in the direct editor instead: the live editor refused it. */
  direct?: string;
  /** This page checked the note in just before this editor mounted: the read view says 「已簽回」 above the new text. */
  checkedIn?: boolean;
  /** This page's check-in was committed to Git while this many others were still editing, so the note stayed open (§5.5). */
  stillOpen?: number;
  /** Collab-first: the server could not be reached, so the note opens in the direct editor on a browser draft (A1). */
  offline?: boolean;
  /** A deletion from the note's own editor is checking the note in first (A7). */
  releasing?: boolean;
}

/** A file action of a collab-first note's own editor. */
type FileAction = keyof LiveFileActions;
const ACTIVE_REFUSALS = { remove: ['live.activeDelete', 'live.activeDeleteOne'] } as const;
const REASONS: Record<string, TranslationKey> = { active: 'live.reason.active', changed: 'live.reason.changed', 'not-synced': 'live.reason.not-synced', leased: 'live.reason.leased', released: 'live.reason.released', unfiled: 'live.reason.unfiled', uncommittable: 'live.reason.uncommittable' };

/** What a collab-first note's own editor offers for its file actions: a deletion checks the note in first; each answers whether it ran. */
/** A rename may carry the title typed in the note's row or panel, which the rename dialog starts from. */
export type LiveOwnFileActions = { [action in FileAction]?: (title?: string) => Promise<boolean>; };

/**
 * 「尚未簽回：…」 with why: tried again once everyone has left, except when none of the editors may commit, which needs
 * someone to act (cf16-F009); a reason this app does not know reads as the note having changed.
 */
export const notCheckedInText = (t: ReturnType<typeof useTranslation>['t'], reason: string | undefined) => t(reason === 'uncommittable' ? 'live.notCheckedInStuck' : 'live.notCheckedIn', { reason: t(REASONS[reason ?? ''] ?? 'live.reason.changed') });

/** 「已存入 Git；仍有 N 人在編輯」, in the person's number. */
export const stillOpenText = (t: ReturnType<typeof useTranslation>['t'], count: number) => t(count === 1 ? 'live.stillOpenOne' : 'live.stillOpen', { count });

/**
 * A note editor's live editing (spec §8): while the note's repository has a live editor the note is read-only here.
 * Collab-first (docs/specs/2026-11-16-collab-first-self-host A1): where that editor is the built-in one, zoom and a Focus
 * pane (the phone's note screen is one) check the note out once per arrival and show the collab editor, with no 編輯;
 * unreachable, they open the direct editor on a browser draft instead. A framed editor keeps 0.19's way: 編輯 checks the
 * note out and frames the editor in zoom, and elsewhere opens zoom, which checks it out on arrival. A graph card or a
 * compilation's section keeps 編輯, which opens zoom. A pending note opens its editor at once. A note the editor refuses
 * (too large, or not a kind it takes) gets the direct editor. `refetch` reads the note again after the live text changed or
 * the note was checked in.
 */
export function useLiveEdit({ note, live, frame, refetch, hasDraft }: { note: NoteItem; live?: LiveNoteEditing; frame: string; refetch: () => void; /** Whether the direct editor holds typing not in Git, read when the browser is back online. */ hasDraft?: () => boolean; }) {
  const { t } = useTranslation();
  const zoom = frame === 'zoom';
  const collab = live?.editor.kind === 'builtin';
  /** Whether this frame shows the live editor itself: zoom, and with the built-in editor a Focus pane too. */
  const edits = zoom || (collab && frame === 'pane');
  const key = noteRefKey(note);
  const [state, setState] = useState<LiveEditState>(() => {
    const mark = edits && live ? recentCheckIn(key) : undefined;
    return !mark ? {} : mark.stillOpen === undefined ? { checkedIn: true } : { stillOpen: mark.stillOpen };
  });
  // An editor mounted after this page's check-in says it once: a later visit to the note reads it as usual. With the
  // built-in editor the mark stays until it lapses or 編輯 is pressed, so that no editor the check-in's refresh mounts
  // checks the note out again on arrival.
  const [remounted] = useState(() => Boolean(state.checkedIn || state.stillOpen !== undefined));
  useEffect(() => {
    if (remounted && !collab) forgetCheckedIn(key);
  }, [remounted, collab, key]);
  const latest = useRef({ refetch, live, hasDraft, notebookId: note.notebookId, path: note.path });
  useEffect(() => {
    latest.current = { refetch, live, hasDraft, notebookId: note.notebookId, path: note.path };
  });

  /** The collab editor holds typing the server has not stored: a file action would commit without it, and leave it under the old path. */
  const unsavedTyping = useRef(false);
  /** Refuses a file action while others edit the note: said until it is closed or another action runs. */
  const [refusal, showRefusal] = useState<string | null>(() => (live ? recentRefusal(key) : null));
  const setRefusal = (text: string | null) => {
    markRefusal(key, text);
    showRefusal(text);
  };

  const checkOut = useCallback(async () => {
    const { notebookId, path } = latest.current;
    forgetCheckedIn(noteRefKey({ notebookId, path }));
    // Collab-first opens the direct editor offline: the browser knows it before a request fails.
    if (latest.current.live?.editor.kind === 'builtin' && !navigator.onLine) return setState({ offline: true });
    setState({ busy: true });
    try {
      const { checkout } = await checkOutLive(notebookId, path);
      setState({ checkout });
      latest.current.live?.onRefetch();
    } catch (error) {
      if (latest.current.live?.editor.kind === 'builtin' && isNetworkFailure(error)) return setState({ offline: true });
      setState(keepsDirectEditor(error) ? { direct: t((error as { code?: string; }).code === 'too-large' ? 'live.tooLarge' : 'live.notLive') } : { error: (error as Error).message });
    }
  }, [t]);

  // Zoom checks out a note a pane or the address (`?edit`) asked to edit, and frames a pending note at once, each once per
  // arrival; with the built-in editor every editing frame checks its note out on arrival, unless this page checked it in
  // just before the editor mounted, which then says 「已簽回」 with 編輯 instead.
  const pending = Boolean(note.live?.pending);
  const link = useLiveEditLink();
  const claim = link?.claim;
  const arrived = useRef(false);
  useEffect(() => {
    if (!live || !edits) {
      arrived.current = false;
      return;
    }
    if (arrived.current) return;
    arrived.current = true;
    // Both requests are taken, so that neither is left for a later arrival.
    const linked = claim?.(key) ?? false;
    const asked = takeLiveEditRequest(key);
    /* eslint-disable react/set-state-in-effect -- Arriving in zoom starts a checkout request; its busy state is that request's. */
    if (asked || linked || pending || (collab && !remounted)) void checkOut();
    /* eslint-enable react/set-state-in-effect */
  }, [live, edits, collab, remounted, key, pending, checkOut, claim]);
  // The address asks to edit the note this editor shows once it shows it: zoom checks it out, a Focus pane opens zoom as
  // 編輯 does. With the built-in editor the pane edits it itself: the address only loses `edit`, and the note is checked
  // out unless its arrival did so already.
  const linkTarget = link?.target;
  const shown = useRef(state);
  useEffect(() => {
    shown.current = state;
  });
  useEffect(() => {
    if (!live || linkTarget !== key) return;
    if (collab) {
      /* eslint-disable react/set-state-in-effect -- The address's request starts a checkout request; its busy state is that request's. */
      if (edits && claim?.(key) && !shown.current.checkout && !shown.current.busy && !shown.current.offline) void checkOut();
      /* eslint-enable react/set-state-in-effect */
      return;
    }
    if (!(zoom || (frame === 'pane' && live.openZoom)) || !claim?.(key)) return;
    /* eslint-disable react/set-state-in-effect -- The address's request starts a checkout request; its busy state is that request's. */
    if (zoom) return void checkOut();
    /* eslint-enable react/set-state-in-effect */
    requestLiveEdit(key);
    live.openZoom!();
  }, [live, collab, edits, zoom, frame, key, linkTarget, claim, checkOut]);

  // A framed editor shows only in zoom; a note zoom hands back to its pane shows the read view there.
  if (!edits && state.checkout) setState({});
  // The editor's hosts give another note another editor: a note that changes path here is this one, which another person
  // moved or renamed (§20.4) and the page followed there. Its checkout goes on where it lies now, the session with it.
  else if (state.checkout && !state.checkout.pending && state.checkout.notebookId === note.notebookId && state.checkout.path !== note.path) setState({ ...state, checkout: { ...state.checkout, path: note.path } });

  // Back online, the direct editor gives way to the collab editor: at once with nothing typed offline, and once its draft
  // was handed over to the live note (A3.2) otherwise; a draft that could not be handed over stays in the direct editor.
  const offline = Boolean(state.offline);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  /** How long the next timed try waits: kept across the tries that fail, and started afresh once one got through. */
  const backoff = useRef({ wait: RETRY_FIRST_MS });
  useEffect(() => {
    if (state.checkout) backoff.current.wait = RETRY_FIRST_MS;
  }, [state.checkout]);
  // Not only on `online`: a request may have failed while the browser counted itself online, and then none comes (A3.2.1).
  useEffect(() => {
    if (!offline) return;
    let trying = false;
    const back = async () => {
      if (trying) return;
      trying = true;
      try {
        const { hasDraft, live: editing } = latest.current;
        if (!hasDraft?.()) return await checkOut();
        // Read-only while the draft is handed over: the direct editor writes nothing over it, nor marks the merged note a conflict.
        setState({ busy: true });
        const handed = await (editing?.handOver?.() ?? Promise.resolve(false));
        if (!mounted.current) return;
        if (handed) await checkOut();
        else setState({ offline: true });
      } finally {
        trying = false;
      }
    };
    const retry = () => void back();
    const stopEvents = onReachable(retry), stopTimer = retryOnTimer(retry, backoff.current);
    return () => {
      stopEvents();
      stopTimer();
    };
  }, [offline, checkOut]);

  const active = Boolean(live) && !state.direct && !offline;
  const edit = !active || state.busy || state.checkout || state.releasing ? undefined : () => {
    if (edits) return void checkOut();
    requestLiveEdit(key);
    live?.openZoom?.();
  };
  // 「已簽回」 is said until it is closed or the note is edited again.
  const close = () => {
    if (state.checkedIn || state.stillOpen !== undefined) forgetCheckedIn(key);
    setState({});
  };
  /**
   * A move, rename or deletion from the note's own collab editor (A7). A move or rename runs at once and the editor stays:
   * it records where the note goes, and its next check-in, at once when nobody else edits it, moves it there (§20.4 of
   * the built-in editor spec). A deletion closes the editor first, so that this tab no longer counts as editing, then
   * checks the note in, and once it is released deletes it against the revision the check-in answered. A note that was
   * no longer live is deleted at once; one others still edit is refused with how many, and its editor opens again.
   */
  const fileAction = (action: FileAction): ((title?: string) => Promise<boolean>) | undefined => {
    const run = live?.fileActions?.[action];
    if (!run || !collab || !active || pending) return undefined;
    if (action !== 'remove') {
      return async (title?: string) => {
        setRefusal(null);
        if (action === 'rename' && title !== undefined) await live!.fileActions!.rename!(undefined, title);
        else await run();
        return true;
      };
    }
    return async () => {
      const { notebookId, path } = latest.current;
      if (unsavedTyping.current) {
        setRefusal(t('live.unsavedFileAction'));
        return false;
      }
      setRefusal(null);
      flushSync(() => setState({ releasing: true }));
      let answer: LiveCheckInAnswer | undefined;
      try {
        answer = await checkInLive(notebookId, path);
      } catch (error) {
        if (!isNotLive(error)) {
          setState({ error: isNetworkFailure(error) ? t('live.checkInUnreachable') : (error as Error).message });
          return false;
        }
      }
      if (answer && !answer.released) {
        if (answer.committed) latest.current.live?.onCheckedIn?.(answer);
        const count = answer.activeEditors ?? 1;
        const [many, one] = ACTIVE_REFUSALS[action];
        setRefusal(answer.reason === 'active' ? t(count === 1 ? one : many, { count }) : notCheckedInText(t, answer.reason));
        void checkOut();
        return false;
      }
      if (answer) checkedIn(answer);
      else setState({});
      await run(answer?.revision);
      return true;
    };
  };
  const fileActions: LiveOwnFileActions | undefined = live?.fileActions && collab && active && !pending ? { move: fileAction('move'), rename: fileAction('rename'), remove: fileAction('remove') } : undefined;
  /**
   * The frame checked the note in, or heard that it was. A released note leaves the frame for the read view here, whether
   * or not anything remounts this editor (zoom lent by a pane, the phone, a check-in that changed nothing); the mark says
   * 「已簽回」 again in the editor a workspace refresh mounts instead. A check-in committed while others still edit leaves the
   * same way and says 「已存入 Git；仍有 N 人在編輯」. A check-in that moved the head leaves the lists to the app's workspace
   * refresh, since a list read at the old revision is refused; one that did not reads the live state again at once.
   */
  const checkedIn = (answer?: LiveCheckInAnswer) => {
    const { notebookId } = latest.current;
    const keys = [key, ...(answer?.path ? [noteRefKey({ notebookId, path: answer.path })] : [])];
    if (!answer || answer.released) {
      markCheckedIn(keys);
      setState({ checkedIn: true });
    } else if (answer.committed) {
      const count = answer.activeEditors ?? 1;
      markCheckedIn(keys, count);
      setState({ stillOpen: count });
    }
    if (answer && !answer.committed) latest.current.live?.onRefetch();
    latest.current.live?.onCheckedIn?.(answer);
  };
  /** Someone else checked the note in while the editor offers its unsaved text: the app reads the live state again. */
  const released = () => latest.current.live?.onReleased?.();
  /** The pending note was discarded: it is gone, so the editor closes and the app leaves it. */
  const discarded = () => {
    setState({});
    latest.current.live?.onRefetch();
    latest.current.live?.onDiscarded?.();
  };
  const [comparing, setComparing] = useState(false);
  const [copiedMine, setCopiedMine] = useState(false);
  const mergeConflict = live?.mergeConflict;
  const mergeNotice = mergeConflict && (
    <EditorNotice
      actions={
        <>
          <Button
            size='small'
            aria-expanded={comparing}
            onClick={() => setComparing(value => !value)}
          >
            {t(comparing ? 'live.hideCompare' : 'live.compare')}
          </Button>
          <Button size='small' onClick={() => void navigator.clipboard.writeText(mergeConflict.mine).then(() => setCopiedMine(true))}>{t(copiedMine ? 'live.copied' : 'live.copyMine')}</Button>
          <Button size='small' variant='danger' onClick={mergeConflict.discard}>{t('live.discardMine')}</Button>
        </>
      }
    >
      {t('live.mergeConflict')}
      {offline && <>{' '}{t('live.conflictBlocksOffline')}</>}
      {comparing && <pre className='live-merge-diff' aria-label={t('live.mergeDiff')}>{createUnifiedDiff(note.path, note.path, noteFileText(note), mergeConflict.mine)}</pre>}
    </EditorNotice>
  );
  const conflict = note.live?.conflict;
  const conflictShown = active && conflict && !state.checkout;
  const notices = <>{state.busy && <LoadingStatus className='editor-notice'>{t('live.checkingOut')}</LoadingStatus>}{state.releasing && <LoadingStatus className='editor-notice'>{t('live.checkingIn')}</LoadingStatus>}{offline && <EditorNotice>{t('live.offlineDraft')}</EditorNotice>}{refusal && <EditorNotice actions={<Button size='small' onClick={() => setRefusal(null)}>{t('common.close')}</Button>}>{refusal}</EditorNotice>}{state.error && <EditorNotice tone='error'>{state.error}</EditorNotice>}{state.direct && <EditorNotice>{state.direct}</EditorNotice>}{state.checkedIn && <EditorNotice tone='success' actions={<Button size='small' onClick={close}>{t('common.close')}</Button>}>{t('live.checkedIn')}</EditorNotice>}{state.stillOpen !== undefined && <EditorNotice actions={<Button size='small' onClick={close}>{t('common.close')}</Button>}>{stillOpenText(t, state.stillOpen)}</EditorNotice>}{conflictShown && <EditorNotice>{t('live.conflict', { commit: conflict.overwritten.slice(0, 7) })}</EditorNotice>}{mergeNotice}</>;
  const hasNotices = Boolean(state.busy || state.releasing || offline || refusal || state.error || state.direct || state.checkedIn || state.stillOpen !== undefined || conflictShown || mergeNotice);
  // While the editor shows, its bar counts the editors; once the note is checked in it is no longer 編輯中.
  const badgeShown = !(edits && state.checkout) && !state.checkedIn;
  return { active, checkout: edits ? state.checkout : undefined, edit, close, checkedIn, released, discarded, notices, hasNotices, badgeShown, fileActions, refetch: () => latest.current.refetch(), conflictHold: offline && Boolean(mergeConflict), unsavedChange: (unsaved: boolean) => void (unsavedTyping.current = unsaved) };
}
