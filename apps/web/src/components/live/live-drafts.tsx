import { createContext, useCallback, useContext } from 'react';
import type { LiveNoteState } from '@mygitnotes/core';
import { safeFileName } from '@mygitnotes/core/note-template';
import { type I18nContextValue, type TranslationKey, useTranslation } from '../../lib/i18n/index.js';
import { discardLive, hasLiveEdits, type LiveDiscardAnswer } from '../../lib/live-api.js';

/*
 * Pending live notes (未歸檔) in the lists and dialogs (docs/specs/2026-11-15-builtin-live-editor §19, §20): where the
 * repository's live editor can discard one, every delete entry discards it; where it can retarget one, move and rename
 * set where its check-in files it. Elsewhere a live note stays locked until it is checked in, as in 0.19.
 */

/** What the live editors of the workspace's repositories can do with a pending note, by its notebook. */
export interface LiveDrafts {
  discards: (notebookId: string) => boolean;
  retargets: (notebookId: string) => boolean;
}

const NONE: LiveDrafts = { discards: () => false, retargets: () => false };
const LiveDraftsContext = createContext<LiveDrafts>(NONE);
export const LiveDraftsProvider = LiveDraftsContext.Provider;
export const useLiveDrafts = () => useContext(LiveDraftsContext);

/** What a list entry does to a note. */
export type LiveNoteAction = 'delete' | 'move' | 'other';

/** Whether `action` is refused for a live note, given what its editor can do: a pending note may be discarded or moved. */
export function liveActionLocked(note: { notebookId: string; live?: LiveNoteState; }, action: LiveNoteAction, drafts: LiveDrafts): boolean {
  if (!note.live) return false;
  if (!note.live.pending) return true;
  if (action === 'delete') return !drafts.discards(note.notebookId);
  if (action === 'move') return !drafts.retargets(note.notebookId);
  return true;
}

/** The reason a list entry shows on a refused action of a live note, or undefined where it is allowed. */
export function useLiveLock(): (note: { notebookId: string; live?: LiveNoteState; }, action: LiveNoteAction) => string | undefined {
  const { t } = useTranslation();
  const drafts = useLiveDrafts();
  return useCallback((note, action) => (liveActionLocked(note, action, drafts) ? t('live.checkedOut') : undefined), [t, drafts]);
}

/** Where a pending note files, as its badge says: 「歸檔到：<folder>/<name>」, the rule's placeholders kept. */
export const liveDestination = (live: LiveNoteState | undefined): string | undefined => (live?.pending && live.pathRule ? live.pathRule : undefined);

const TITLE = /\{\{\s*title\s*\}\}/g;
/**
 * Where a pending note files, as its rule renders with its title now (`{{title}}.md` → `Untitled.md`), and whether the
 * name follows the title; undefined where the live editor does not tell. Other placeholders are filled at check-in.
 */
export const liveDestinationPreview = (live: LiveNoteState | undefined, title: string | undefined): { path: string; followsTitle: boolean; } | undefined => {
  const rule = liveDestination(live);
  if (!rule) return undefined;
  const name = safeFileName(title ?? '');
  return { path: name ? rule.replace(TITLE, name) : rule, followsTitle: /\{\{\s*title\s*\}\}/.test(rule) };
};

/** The folder of a pending note's destination, relative to the notebook root; null for the root, as the folder picker takes it. */
export const liveDestinationFolder = (live: LiveNoteState | undefined): string | null => {
  const rule = liveDestination(live);
  const slash = rule ? rule.lastIndexOf('/') : -1;
  return rule && slash > 0 ? rule.slice(0, slash) : null;
};

const KEPT: Record<string, TranslationKey> = { active: 'live.reason.active', changed: 'live.reason.changed', 'not-synced': 'live.reason.not-synced', leased: 'live.reason.leased', released: 'live.reason.released' };
/** Why a draft was kept, as a sentence. */
export const keptReason = (answer: Exclude<LiveDiscardAnswer, { discarded: true; }>, t: I18nContextValue['t']) => t('live.notDiscarded', { reason: t(KEPT[answer.reason] ?? 'live.reason.changed') });

/**
 * 「捨棄草稿」: discards a pending note at once when nobody typed content in it; otherwise asks 「捨棄這份草稿？內容不會存進
 * Git。」 (`ask`, the browser's confirm by default; one that already confirmed answers true) and, confirmed, asks again
 * with `confirm`. Null when the person kept the draft.
 */
export async function discardDraft(notebookId: string, path: string, t: I18nContextValue['t'], ask: (question: string) => boolean | Promise<boolean> = question => window.confirm(question)): Promise<LiveDiscardAnswer | null> {
  try {
    return await discardLive(notebookId, path);
  } catch (error) {
    if (!hasLiveEdits(error)) throw error;
    if (!await ask(t('live.discardConfirm'))) return null;
    return discardLive(notebookId, path, true);
  }
}
