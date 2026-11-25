import { useCallback, useState } from 'react';
import type { TagOperationPlan } from '@mygitnotes/core/tag-ops';
import type { TranslationKey } from './i18n/index.js';

export type TagOperationKind = 'rename' | 'merge' | 'delete' | 'add' | 'remove';

/** A toast label kept untranslated so it renders in the language active when it is shown. */
export interface TagOperationLabel {
  key: TranslationKey;
  params: Record<string, string | number>;
}

export interface TagOperationRecord {
  id: string;
  kind: TagOperationKind;
  label: TagOperationLabel;
  plan: TagOperationPlan;
}

let nextRecordId = 0;

/** Prepend a record built from a just-applied plan. Pure, so it is easy to test without React. */
export function pushTagOperationRecord(history: TagOperationRecord[], kind: TagOperationKind, label: TagOperationLabel, plan: TagOperationPlan): TagOperationRecord[] {
  return [{ id: `tag-op-${++nextRecordId}`, kind, label, plan }, ...history];
}

/**
 * Session-lifetime history of tag operations, each independently undoable until page reload.
 * A record is only dismissed once its undo has actually been applied (see useTagWorkspaceOperations'
 * handleUndoTagOperation) — a failed or partial undo keeps what it did not restore so the user can retry.
 */
export function useTagOperations() {
  const [history, setHistory] = useState<TagOperationRecord[]>([]);

  const record = useCallback((kind: TagOperationKind, label: TagOperationLabel, plan: TagOperationPlan) => {
    setHistory(previous => pushTagOperationRecord(previous, kind, label, plan));
  }, []);

  const dismiss = useCallback((id: string) => {
    setHistory(previous => previous.filter(entry => entry.id !== id));
  }, []);

  /** Narrows a record to the part of its plan an undo has yet to restore. */
  const narrow = useCallback((id: string, plan: TagOperationPlan) => {
    setHistory(previous => previous.map(entry => entry.id === id ? { ...entry, plan } : entry));
  }, []);

  return { history, record, dismiss, narrow };
}
