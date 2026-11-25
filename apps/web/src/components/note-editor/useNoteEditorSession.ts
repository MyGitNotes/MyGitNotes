import { noteRefKey } from '@mygitnotes/core/note-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { mergeNote, NoteDraft, sameValue } from '../../lib/merge-note.js';
import { ApiError, isNetworkFailure } from '../../lib/api.js';
import { isLivePendingPath } from '../../lib/live-api.js';
import { NoteItem } from '../../lib/types.js';
import { onWorkspaceFilesChanged } from '../../lib/workspace-changes.js';
import { REMOTE_CHECK_INTERVAL_MS, REMOTE_CHECK_INTERVAL_READONLY_MS } from '../../lib/remote-check-interval.js';
import { clearLocalDraft, dismissConflictDraftNotice, getDismissedConflictDraftNoticeAt, getLocalDraft, saveLocalDraft } from '../../lib/storage.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { useTranslation } from '../../lib/i18n/index.js';
import type { TranslationKey } from '../../lib/i18n/index.js';
import { useWorkspaceLinks } from '../WorkspaceLinks.js';
import { useEditorRegistry } from '../../lib/note-editing.js';
import type { NoteEditorSession, NoteEditorSharedProps } from './types.js';
import type { NewVersionRequest } from '../../lib/history-api.js';
import { externalEditCount, subscribeExternalEdits } from '../../lib/external-note-edits.js';
import { isNoteMoving } from '../../lib/moving-notes.js';
import { COMMIT_CONFLICT, COMMIT_MOVED_OR_DELETED, readStoredWorkingNotes } from '../../lib/working-notes.js';

/**
 * Why a session is blocked, which its one notice says: the note lies at `to` now, it was deleted, it is gone and a read
 * has yet to say which (a stored draft records only that), the remote conflicts with the draft, or a reason stored as text.
 */
export type BlockReason = { kind: 'moved'; to: string; } | { kind: 'deleted'; } | { kind: 'gone'; } | { kind: 'conflict'; } | { kind: 'other'; reason: string; };

const MOVED_OR_DELETED: TranslationKey = 'editor.remoteNoteMovedOrDeleted';
const REMOTE_CONFLICT: TranslationKey = 'editor.remoteConflict';
/** The block a stored draft's reason opens the session with. */
function storedBlock(reason: string | undefined): BlockReason | null {
  if (!reason) return null;
  if (reason === MOVED_OR_DELETED || reason === COMMIT_MOVED_OR_DELETED) return { kind: 'gone' };
  if (reason === REMOTE_CONFLICT || reason === COMMIT_CONFLICT) return { kind: 'conflict' };
  return { kind: 'other', reason };
}

/** Server-managed on every save; excluded when deciding whether there is a new edit to save. */
function sameIgnoringTimestamps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = ({ created: _created, updated: _updated, ...rest }: Record<string, unknown>) => rest;
  return sameValue(strip(a), strip(b));
}

/** `onCommitFile` commits this note's saved file alone; absent when the note cannot be committed from the editor. */
export interface UseNoteEditorSessionParams extends Pick<NoteEditorSharedProps, 'remoteBase' | 'conflictReason' | 'onMarkConflict' | 'onSave' | 'onReadRemote' | 'onMoved' | 'onRestoreFile' | 'onCommitFile' | 'branch' | 'draftScope'> {
  note: NoteItem;
  readOnly: boolean;
  autoSave: boolean;
  draftMode: boolean;
  propIsDirty: boolean;
  onClose?: () => void;
  onSession?: (session: NoteEditorSession | null) => void;
  /** Live text saves on its own server. Leaving waits only if the editor asks for a decision. */
  beforeLeave?: () => Promise<boolean> | undefined;
}

/** A note's editing session: content, frontmatter, drafts, autosave, conflicts, crash recovery and save/restore/close actions. */
export function useNoteEditorSession({ note, readOnly, autoSave, draftMode, remoteBase, conflictReason, onMarkConflict, onSave, onReadRemote, onMoved, onRestoreFile, onCommitFile, propIsDirty, branch, draftScope, onClose, onSession, beforeLeave }: UseNoteEditorSessionParams) {
  const { t } = useTranslation();
  const [content, setContent] = useState(note.content);
  const sessionKey = JSON.stringify([note.notebookId, note.path, draftScope, branch, readOnly]);
  const [readyKey, setReadyKey] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyResetTimer = useRef<ReturnType<typeof setTimeout>>();
  const [metadata, setMetadata] = useState<Record<string, unknown>>(note.metadata || {});
  const [isSaving, setIsSaving] = useState(false);
  // Set while `commitNote` runs, so the status names the commit rather than a save.
  const [committing, setCommitting] = useState(false);
  // A message beside the note's text: a failed write or read. Why the session is blocked is `blockReason`'s, said once.
  const [saveError, setSaveError] = useState('');
  // Translated at render time alongside saveError, so a raw error message doesn't get frozen
  // in whatever language was active when it was caught.
  const [saveErrorParams, setSaveErrorParams] = useState<Record<string, string> | undefined>(undefined);
  // Set while the shown message is a failed write's (save, autosave, commit): a read neither replaces nor clears it, since a read does not save the note; the next write that succeeds does.
  const writeFailed = useRef(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [baseNote, setBaseNote] = useState(remoteBase || note);
  const [blocked, setBlocked] = useState(Boolean(conflictReason));
  const [blockReason, setBlockReason] = useState<BlockReason | null>(() => storedBlock(conflictReason));
  /** Whether the session is blocked by the stored draft it opened on, rather than by what it met itself. */
  const storedBlockOpen = useRef(Boolean(conflictReason));
  const [remoteNotice, setRemoteNoticeState] = useState('');
  // A new remote-notice event always starts undismissed; only dismiss() should set this true.
  const [remoteNoticeDismissed, setRemoteNoticeDismissed] = useState(false);
  const setRemoteNotice = (value: string) => {
    setRemoteNoticeState(value);
    setRemoteNoticeDismissed(false);
  };
  const [conflictDraft, setConflictDraft] = useState<NoteDraft | null>(() => getLocalDraft(`${draftScope || branch}:conflict`, note.path));
  // Identifies which persisted conflict draft the "preserved draft" notice is for, so a dismissal
  // survives reopening the note but a later, different conflict draft is shown again.
  const [conflictDraftSavedAt, setConflictDraftSavedAt] = useState<number | null>(() => getLocalDraft(`${draftScope || branch}:conflict`, note.path)?.savedAt ?? null);
  const [conflictNoticeDismissedAt, setConflictNoticeDismissedAt] = useState<number | null>(() => getDismissedConflictDraftNoticeAt(`${draftScope || branch}:conflict`, note.path));
  const operation = useRef(false);
  // Set only around the debounced disk autosave; kept separate from `operation` so a routine
  // background save never trips the navigate/close/persist guards that flag was written for.
  const autosaving = useRef(false);
  // The last autosaved draft: the `note` prop reaches it only after the notes refetch.
  const lastSaved = useRef<{ content: string; metadata: Record<string, unknown>; } | null>(null);
  // The states this session has held as saved, newest last: a `note` prop that only echoes one of them is not news.
  const savedStates = useRef<{ content: string; metadata: Record<string, unknown>; }[]>([]);
  // The note being adopted until the state has caught up with it, so the save effect does not take the state it replaces for an edit.
  const adopting = useRef<{ content: string; metadata: Record<string, unknown>; } | null>(null);
  /**
   * The draft a save was refused for because the note's frontmatter cannot be read (`frontmatter-invalid`): autosave does
   * not send it again, as the same text and metadata are refused the same way; a changed draft, or an explicit save, is tried.
   */
  const refusedDraft = useRef<{ content: string; metadata: Record<string, unknown>; } | null>(null);
  const markSaved = (saved: { content: string; metadata: Record<string, unknown>; }) => {
    refusedDraft.current = null;
    lastSaved.current = saved;
    savedStates.current = [...savedStates.current.slice(-7), saved];
  };
  const closing = useRef(false);
  const nextRemoteCheck = useRef(0);
  const mounted = useRef(true);
  const onMovedRef = useRef(onMoved);
  useEffect(() => {
    onMovedRef.current = onMoved;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useRef({ content, metadata, baseNote, blocked });
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  current.current = { content, metadata, baseNote, blocked };
  /* eslint-enable react/refs */
  /** Whether the session holds typing or metadata edits that no save has taken yet. */
  const hasUnsaved = () => {
    const saved = lastSaved.current, state = current.current;
    return !(saved && state.content === saved.content && sameIgnoringTimestamps(state.metadata, saved.metadata));
  };
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  const locked = readOnly || blocked || closing.current || (!autoSave && isSaving);
  /* eslint-enable react/refs */
  /** Blocks the session for `reason`: nothing is saved over the preserved draft until the person picks what to keep. */
  const block = (reason: BlockReason) => {
    storedBlockOpen.current = false;
    current.current.blocked = true;
    setBlocked(true);
    setBlockReason(reason);
  };
  const preserveConflict = () => {
    const key = `${draftScope || branch}:conflict`;
    const draft = { content: current.current.content, metadata: current.current.metadata };
    saveLocalDraft(key, note.path, draft.content, draft.metadata);
    setConflictDraft(draft);
    setConflictDraftSavedAt(getLocalDraft(key, note.path)?.savedAt ?? null);
  };
  const dismissNotice = () => {
    if (remoteNotice) setRemoteNoticeDismissed(true);
    if (conflictDraftSavedAt != null) {
      dismissConflictDraftNotice(`${draftScope || branch}:conflict`, note.path, conflictDraftSavedAt);
      setConflictNoticeDismissedAt(conflictDraftSavedAt);
    }
  };
  const applyRemote = (latest: NoteItem) => {
    const state = current.current;
    if (state.blocked) return null;
    // No local edit means nothing of the user's needs merging; adopt the remote version quietly.
    const hasLocalEdits = state.content !== state.baseNote.content || !sameValue(state.metadata, state.baseNote.metadata);
    const result = mergeNote(state.baseNote, state, latest);
    if (result.conflict) {
      preserveConflict();
      block({ kind: 'conflict' });
      onMarkConflict?.(REMOTE_CONFLICT, { ...note, content: state.content, metadata: state.metadata }, state.baseNote);
      return null;
    }
    if (hasLocalEdits && (latest.content !== state.baseNote.content || !sameValue(latest.metadata, state.baseNote.metadata))) {
      setRemoteNotice('editor.remoteChangesMerged');
    } else if (!hasLocalEdits) {
      // A clean pass-through adoption: the new content is itself already "saved" for this
      // session, so the debounce below must not mistake it for a fresh edit to persist.
      markSaved({ content: result.draft.content, metadata: result.draft.metadata });
    }
    current.current = { ...state, ...result.draft, baseNote: latest };
    setBaseNote(latest);
    setContent(result.draft.content);
    setMetadata(result.draft.metadata);
    return { ...result.draft, revision: latest.revision };
  };
  /** `during` says what failed: a read of the note, a save of it, or another call. */
  const handleRemoteFailure = (error: unknown, during: 'read' | 'save' | 'other') => {
    if (!mounted.current) return;
    if (error instanceof ApiError && (error.retryAfter || error.status === 429)) {
      nextRemoteCheck.current = Date.now() + (error.retryAfter || 60) * 1000;
    }
    // A note this page just moved is not deleted: the editor of its old path is on its way out.
    if (error instanceof ApiError && error.status === 404 && isNoteMoving(noteRefKey(note))) return;
    // A live note that lies elsewhere now (filed, or moved by someone else) is followed there by an editor that holds nothing
    // of the person's own, as a live note's never does; one that holds text, read-only or not (an offline merge conflict
    // held), keeps it as a conflict below (review3 F001). A pending note gone without saying where is the route's.
    const state = current.current;
    const untouched = state.content === state.baseNote.content && sameValue(state.metadata, state.baseNote.metadata);
    if (error instanceof ApiError && error.status === 404 && error.movedTo && untouched) {
      onMovedRef.current?.(error.movedTo);
      return;
    }
    if (error instanceof ApiError && error.status === 404 && (error.movedTo !== undefined || isLivePendingPath(note.path)) && readOnly && untouched) return;
    // Kept where it is, the notice still says where the note lies now when the server tells, and offers to open it there.
    if (error instanceof ApiError && error.status === 404) {
      preserveConflict();
      block(error.movedTo ? { kind: 'moved', to: error.movedTo } : { kind: 'deleted' });
      onMarkConflict?.(MOVED_OR_DELETED, { ...note, content: current.current.content, metadata: current.current.metadata }, current.current.baseNote);
    } else {
      // The browser's own words for a fetch that reached no server ("Failed to fetch") are said in the app's. A read's
      // clears with the next read; a save's stays until a save succeeds, since a read does not save the note.
      if (during === 'save') showWriteFailure(error);
      else if (during === 'other') setSaveError((error as Error).message);
      else if (!writeFailed.current) setSaveError(isNetworkFailure(error) ? 'editor.remoteUnreachable' : (error as Error).message);
    }
  };
  /** A save refused because the note's frontmatter cannot be read: its own 409, which no merge of the remote note resolves. */
  const isFrontmatterRefusal = (error: unknown) => error instanceof ApiError && error.code === 'frontmatter-invalid';
  /** Shows why a write failed, in the app's words when it reached no server, until a write succeeds. */
  const showWriteFailure = (error: unknown) => {
    if (!mounted.current) return;
    writeFailed.current = true;
    setSaveError(isNetworkFailure(error) ? 'editor.saveUnreachable' : (error as Error).message);
  };
  /** A write succeeded: the failure of an earlier one no longer holds. */
  const clearWriteFailure = () => {
    if (!writeFailed.current) return;
    writeFailed.current = false;
    if (mounted.current) setSaveError('');
  };
  /** `now` skips the interval: the workspace said files changed, so this note may have. */
  const checkRemote = async (now = false) => {
    if (!onReadRemote || current.current.blocked) return;
    if (now && (operation.current || autosaving.current)) {
      // A save or read in flight may predate the change; look again once it settles.
      window.setTimeout(() => mounted.current && void checkRemoteRef.current(true), 300);
      return;
    }
    if (operation.current || autosaving.current || (!now && Date.now() < nextRemoteCheck.current)) return;
    nextRemoteCheck.current = Date.now() + (readOnly ? REMOTE_CHECK_INTERVAL_READONLY_MS : REMOTE_CHECK_INTERVAL_MS);
    operation.current = true;
    try {
      const latest = await onReadRemote(note.path);
      if (mounted.current) {
        applyRemote(latest);
        setSaveError(shown => shown === 'editor.remoteUnreachable' ? '' : shown);
      }
    } catch (error) {
      handleRemoteFailure(error, 'read');
    } finally {
      operation.current = false;
    }
  };
  // A stored draft says only that its note was moved or deleted, perhaps long ago: one read says which, or that the note
  // is back where it was, which leaves the draft and the remote to compare.
  /* eslint-disable react-hooks/exhaustive-deps -- Read once per note the session opens on, as its stored block is. */
  useEffect(() => {
    if (!onReadRemote || storedBlock(conflictReason)?.kind !== 'gone') return;
    let open = true;
    const learnt = (reason: BlockReason) => {
      if (open) setBlockReason(shown => (shown?.kind === 'gone' ? reason : shown));
    };
    onReadRemote(note.path).then(() => learnt({ kind: 'conflict' }), error => {
      if (error instanceof ApiError && error.status === 404) learnt(error.movedTo ? { kind: 'moved', to: error.movedTo } : { kind: 'deleted' });
    });
    return () => {
      open = false;
    };
  }, [note.notebookId, note.path]);
  /* eslint-enable react-hooks/exhaustive-deps */
  // Opened where the note lies now (開啟新位置), the session is that note's: the block of its old path stays with the draft kept there.
  const movedTo = blockReason?.kind === 'moved' ? blockReason.to : null;
  const openMoved = movedTo && onMoved ? () => onMovedRef.current?.(movedTo) : undefined;
  useEffect(() => {
    if (!movedTo || note.path !== movedTo) return;
    current.current.blocked = false;
    /* eslint-disable react/set-state-in-effect -- Following the note to its new path ends the block its old path had. */
    setBlocked(false);
    setBlockReason(null);
    setConflictDraft(null);
    setConflictDraftSavedAt(null);
    /* eslint-enable react/set-state-in-effect */
  }, [note.path, movedTo]);
  const checkRemoteRef = useRef(checkRemote);
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  checkRemoteRef.current = checkRemote;
  /* eslint-enable react/refs */
  useEffect(() => {
    if (!onReadRemote) return;
    void checkRemoteRef.current();
    const check = () => {
      if (document.visibilityState === 'visible') void checkRemoteRef.current();
    };
    const timer = window.setInterval(check, readOnly ? REMOTE_CHECK_INTERVAL_READONLY_MS : REMOTE_CHECK_INTERVAL_MS);
    // Back online, the note is read at once rather than at the next interval.
    const online = () => void checkRemoteRef.current(true);
    window.addEventListener('focus', check);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', check);
    const stopListening = onWorkspaceFilesChanged(() => void checkRemoteRef.current(true));
    return () => {
      stopListening();
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [onReadRemote, note.path, readOnly]);
  const refreshRemote = async () => {
    if (!onReadRemote || operation.current) return;
    operation.current = true;
    setIsSaving(true);
    try {
      if (draftMode && current.current.blocked) preserveConflict();
      const latest = draftMode ? await onRestoreFile(note.path) : await onReadRemote(note.path);
      if (!mounted.current || !latest) return;
      setBaseNote(latest);
      setContent(latest.content);
      setMetadata(latest.metadata);
      markSaved({ content: latest.content, metadata: latest.metadata });
      current.current = { ...latest, baseNote: latest, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setRecoveredDraft(null);
      setBlocked(false);
      setBlockReason(null);
      writeFailed.current = false;
      setSaveError('');
      setHasUnsavedChanges(false);
      setRemoteNotice('editor.remoteVersionRefreshed');
    } catch (error) {
      handleRemoteFailure(error, draftMode ? 'other' : 'read');
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  const downloadConflictDraft = () => {
    if (!conflictDraft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(conflictDraft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${note.path.split('/').pop()}.draft.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Note is considered dirty if it has uncommitted edits on disk OR unsaved session edits
  const isDirty = Boolean(propIsDirty || hasUnsavedChanges);
  const editorState: 'saving' | 'pending' | 'saved' = isSaving ? 'saving' : isDirty ? 'pending' : 'saved';
  // A remote commit writes to the repository itself; a local one stays in the worktree until synced.
  const editorStatus = isSaving ? t(committing ? draftMode ? 'editor.pushing' : 'editor.committing' : draftMode ? 'editor.savingLocally' : autoSave ? 'editor.autoSavingToDisk' : 'editor.savingToGitHub') : isDirty ? t(draftMode ? hasUnsavedChanges ? 'editor.unsavedLocalChanges' : 'editor.savedLocallyPendingCommit' : autoSave ? 'editor.uncommittedChanges' : 'editor.unsavedChanges') : t(readOnly ? 'editor.readOnly' : draftMode ? 'editor.noPendingChanges' : autoSave ? 'editor.cleanSavedToDisk' : 'editor.savedToGitHub');
  const title = String(metadata.title || note.title || '');

  const sessionCallback = useRef(onSession);
  /* eslint-disable react/refs -- The editor keeps current draft and event callbacks in refs for async saves and imperative keyboard handlers. */
  sessionCallback.current = onSession;
  /* eslint-enable react/refs */
  useEffect(() => {
    sessionCallback.current?.({ content, title, dirty: hasUnsavedChanges, locked });
  }, [content, title, hasUnsavedChanges, locked]);
  useEffect(() => () => sessionCallback.current?.(null), []);

  // Crash recovery state
  const [recoveredDraft, setRecoveredDraft] = useState<{ content: string; metadata: Record<string, unknown>; savedAt: number; } | null>(null);

  // Check local draft on note open
  /* eslint-disable react-hooks/exhaustive-deps -- Only editor identity opens a session; incoming note or base snapshots must not overwrite the active draft or restart crash recovery. */
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Session opening reads persisted recovery state and updates the saved baseline before the autosave effect; preserve this ordering. */
    setBaseNote(remoteBase || note);
    setReadyKey(sessionKey);
    /* eslint-enable react/set-state-in-effect */
    setContent(note.content);
    setMetadata(note.metadata || {});
    setHasUnsavedChanges(false);
    setCopyState('idle');
    // `note` already reflects whatever is durably persisted for this session (the file on disk in
    // local mode, or the currently staged working draft in draftMode); treat it as already-saved so
    // opening a note never re-triggers a save of content it did not actually change.
    markSaved({ content: note.content, metadata: note.metadata || {} });

    const draft = readOnly ? null : getLocalDraft(draftScope || branch, note.path);
    if (draft && (draft.content !== note.content || !sameValue(draft.metadata, note.metadata))) {
      setRecoveredDraft(draft);
    } else {
      setRecoveredDraft(null);
    }
  }, [note.notebookId, note.path, branch, draftScope, readOnly]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // The agent changed this note's working change: show it, as what is now saved. It refuses a note with unsaved typing, so nothing is lost here.
  const externalEdits = useSyncExternalStore(subscribeExternalEdits, () => externalEditCount(noteRefKey(note)));
  useEffect(() => {
    if (!externalEdits || !draftScope) return;
    const entry = readStoredWorkingNotes(draftScope)[note.path];
    if (!entry || entry.deleted) return;
    /* eslint-disable react/set-state-in-effect -- An edit made outside the editor arrives through this store; the editor takes it as its saved text. */
    setContent(entry.note.content);
    setMetadata(entry.note.metadata || {});
    setHasUnsavedChanges(false);
    /* eslint-enable react/set-state-in-effect */
    markSaved({ content: entry.note.content, metadata: entry.note.metadata || {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only an outside edit reloads; the note's identity is the session's own reset.
  }, [externalEdits]);

  // The stored draft the session opened blocked on is gone (discarded, here or in Changes): nothing is held for it any
  // more, so the session takes the note as it is now. Before the adoption below, which a block would skip.
  /* eslint-disable react-hooks/exhaustive-deps -- Only the stored reason going away matters; the session reads its own state through refs. */
  useEffect(() => {
    if (conflictReason || !storedBlockOpen.current) return;
    storedBlockOpen.current = false;
    current.current.blocked = false;
    const key = `${draftScope || branch}:conflict`;
    /* eslint-disable react/set-state-in-effect -- The block ends with the draft that set it. */
    setBlocked(false);
    setBlockReason(null);
    setConflictDraft(getLocalDraft(key, note.path));
    setConflictDraftSavedAt(getLocalDraft(key, note.path)?.savedAt ?? null);
    /* eslint-enable react/set-state-in-effect */
  }, [conflictReason]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // A note that changed under a session with nothing unsaved (a rename that retitled it, a change staged elsewhere) is the
  // session's note now: the editor shows it, and no later save writes the older text back over it.
  /* eslint-disable react-hooks/exhaustive-deps -- Only a change of the incoming note matters; the session reads its own state through refs. */
  useEffect(() => {
    const saved = lastSaved.current;
    if (readOnly || !saved || sameIgnoringTimestamps(note.metadata || {}, saved.metadata) && note.content === saved.content) return;
    if (savedStates.current.some(state => state.content === note.content && sameIgnoringTimestamps(state.metadata, note.metadata || {}))) return;
    if (hasUnsaved() || current.current.blocked || operation.current || autosaving.current || closing.current) return;
    markSaved({ content: note.content, metadata: note.metadata || {} });
    adopting.current = { content: note.content, metadata: note.metadata || {} };
    current.current = { ...current.current, content: note.content, metadata: note.metadata || {}, baseNote: remoteBase || note };
    /* eslint-disable react/set-state-in-effect -- Adopting the changed note replaces the session's text and baseline in one step. */
    setBaseNote(remoteBase || note);
    setContent(note.content);
    setMetadata(note.metadata || {});
    setHasUnsavedChanges(false);
    /* eslint-enable react/set-state-in-effect */
    clearLocalDraft(draftScope || branch, note.path);
  }, [note]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // A commit made outside this session (the Changes dialog) leaves the committed note holding the text the session holds: that note
  // is its base now. Left on the note the session opened on, a later restore of an older text would be merged with the commit,
  // which in the demo, where the head never moves, brought an earlier commit's lines back into the restored text.
  /* eslint-disable react-hooks/exhaustive-deps -- Only a change of the committed note matters; the session reads its own state through refs. */
  useEffect(() => {
    const state = current.current;
    if (readOnly || !remoteBase || state.blocked || state.baseNote.revision === remoteBase.revision && state.baseNote.content === remoteBase.content) return;
    // Text not yet saved (an undo back to an older save) stays unsaved even when a late read of that older save matches it.
    if (hasUnsaved() || operation.current || autosaving.current || closing.current) return;
    // The commit stamped its own timestamps on the note, so only the rest of the metadata has to match.
    if (state.content !== remoteBase.content || !sameIgnoringTimestamps(state.metadata, remoteBase.metadata || {})) return;
    const metadata = remoteBase.metadata || {};
    markSaved({ content: state.content, metadata });
    current.current = { ...state, metadata, baseNote: remoteBase };
    /* eslint-disable react/set-state-in-effect -- The session's base, and the timestamps its text carries, follow the committed note it now equals. */
    setBaseNote(remoteBase);
    setMetadata(metadata);
    /* eslint-enable react/set-state-in-effect */
  }, [remoteBase]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Debounced auto-save directly to disk on edit
  useEffect(() => {
    if (readOnly || closing.current) return;
    // `lastSaved` tracks whatever is already durably persisted for this session (synced on note
    // open, after a successful save, and on a clean remote pass-through); comparing against it
    // directly - rather than against `baseNote` or the parent's possibly-stale `note` prop - is
    // what correctly separates a real edit from content that already matches what was saved.
    if (adopting.current) {
      if (content !== adopting.current.content || !sameValue(metadata, adopting.current.metadata)) return;
      adopting.current = null;
    }
    const saved = lastSaved.current;
    const isDifferent = !(saved && content === saved.content && sameIgnoringTimestamps(metadata, saved.metadata));

    if (isDifferent) {
      setHasUnsavedChanges(true);

      // Save local draft for crash recovery
      saveLocalDraft(draftScope || branch, note.path, content, metadata);

      if (!autoSave || blocked) return;
      const refused = refusedDraft.current;
      if (refused && refused.content === content && sameValue(refused.metadata, metadata)) return;

      // Timestamps are stamped server-side on every save; absorb them so the next
      // comparison against the refreshed `note`/`baseNote` prop doesn't see a
      // spurious difference and re-save in a loop.
      const absorbTimestamps = (saved: NoteItem) => setMetadata(current => (current.created === saved.metadata.created && current.updated === saved.metadata.updated ? current : { ...current, created: saved.metadata.created, updated: saved.metadata.updated }));

      if (draftMode) {
        /* eslint-disable react/set-state-in-effect -- The committed draft starts an asynchronous save; its saving indicator must follow the same lifecycle as completion, failure and cancellation. */
        setIsSaving(true);
        /* eslint-enable react/set-state-in-effect */
        void onSave({ path: note.path, content, metadata, baseNote }).then(saved => {
          if (!mounted.current) return;
          markSaved({ content, metadata });
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          setHasUnsavedChanges(false);
          writeFailed.current = false;
          setSaveError('');
        }).catch(error => {
          if (mounted.current) {
            setSaveError('editor.localSaveFailed');
            setSaveErrorParams({ message: error.message });
          }
        }).finally(() => {
          if (mounted.current) setIsSaving(false);
        });
        return;
      }

      // Debounced auto-save to disk
      let cancelled = false;
      const timer = setTimeout(async () => {
        // Defer to an in-flight checkRemote/save/restore, or to the previous autosave, rather than racing it:
        // two overlapping autosaves leave the newer write on disk while the older one becomes the base, so a remote check reads it as an external change.
        while ((operation.current || autosaving.current) && !cancelled) await new Promise(resolve => setTimeout(resolve, 50));
        // A newer effect run (e.g. a remote merge, or further typing) superseded this one
        // while it waited; its own debounce now owns saving the current draft.
        if (cancelled || !mounted.current) return;
        setIsSaving(true);
        // Held for the save's duration so a concurrent remote check (focus/interval)
        // can't read this same write back mid-flight and mistake it for an external change.
        autosaving.current = true;
        try {
          const saved = await onSave({ path: note.path, content, metadata });
          markSaved({ content, metadata });
          clearLocalDraft(draftScope || branch, note.path);
          absorbTimestamps(saved);
          // The file on disk now matches this draft; adopt it as the base so a later
          // remote check does not treat the app's own write as an external change.
          current.current = { ...current.current, baseNote: saved };
          setBaseNote(saved);
          setHasUnsavedChanges(false);
          clearWriteFailure();
        } catch (err) {
          if (isFrontmatterRefusal(err)) refusedDraft.current = { content, metadata };
          showWriteFailure(err);
        } finally {
          autosaving.current = false;
          setIsSaving(false);
        }
      }, 750);

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    } else {
      setHasUnsavedChanges(false);
      // Edits undone after a save leave nothing newer than it to recover.
      if (saved) clearLocalDraft(draftScope || branch, note.path);
    }
  }, [content, metadata, note, branch, draftScope, onSave, readOnly, autoSave, baseNote, blocked, draftMode]);

  /** Saves the note by hand; resolves whether it saved, so `:wq` closes only a saved note. */
  const handleExplicitSave = async (): Promise<boolean> => {
    if (locked || operation.current) return false;
    operation.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      let draft = { content: current.current.content, metadata: current.current.metadata, revision: current.current.baseNote.revision };
      if (onReadRemote) {
        const latest = await onReadRemote(note.path);
        if (!mounted.current) return false;
        const merged = applyRemote(latest);
        if (!merged) return false;
        draft = merged;
      }
      const saved = await onSave({ path: note.path, ...draft });
      if (!mounted.current) return false;
      setBaseNote(saved);
      setContent(saved.content);
      setMetadata(saved.metadata);
      markSaved({ content: saved.content, metadata: saved.metadata });
      current.current = { ...saved, baseNote: saved, blocked: false };
      clearLocalDraft(draftScope || branch, note.path);
      setHasUnsavedChanges(false);
      setRemoteNotice('');
      clearWriteFailure();
      return true;
    } catch (error) {
      // Refused because the frontmatter cannot be read: said as such, with nothing read back, since no remote change
      // merged into the draft would let it through.
      if (isFrontmatterRefusal(error)) {
        refusedDraft.current = { content: current.current.content, metadata: current.current.metadata };
        showWriteFailure(error);
      } else if (error instanceof ApiError && error.status === 409 && onReadRemote) {
        try {
          const latest = await onReadRemote(note.path);
          if (mounted.current && applyRemote(latest)) setSaveError('editor.remoteChangedDuringSave');
        } catch (readError) {
          handleRemoteFailure(readError, 'save');
        }
      } else handleRemoteFailure(error, 'save');
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  /** Saves any pending edit, then commits this note alone, resolving whether it did; with `version`, the commit also records it as a new version. Rethrows for a caller that waits on it. */
  const commitNote = async (version?: NewVersionRequest): Promise<boolean> => {
    if (!onCommitFile || locked || operation.current) return false;
    operation.current = true;
    setIsSaving(true);
    setCommitting(true);
    setSaveError('');
    try {
      const state = current.current;
      const saved = lastSaved.current;
      if (!saved || state.content !== saved.content || !sameIgnoringTimestamps(state.metadata, saved.metadata)) {
        const written = await onSave({ path: note.path, content: state.content, metadata: state.metadata, baseNote: state.baseNote });
        if (!mounted.current) return false;
        // Adopting the written note supersedes a pending autosave of the same edit.
        markSaved({ content: written.content, metadata: written.metadata });
        current.current = { ...current.current, content: written.content, metadata: written.metadata, baseNote: written };
        setBaseNote(written);
        setContent(written.content);
        setMetadata(written.metadata);
        clearLocalDraft(draftScope || branch, note.path);
        setHasUnsavedChanges(false);
      }
      await onCommitFile(note.path, version);
      clearWriteFailure();
      return true;
    } catch (error) {
      showWriteFailure(error);
      if (version) throw error;
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) {
        setIsSaving(false);
        setCommitting(false);
      }
    }
  };
  /** Discards this note's uncommitted changes, on disk or in the draft store, and the session's unsaved edits. */
  /** Reads this note's latest version now: adopted as is without local edits, merged into them otherwise. */
  const pullLatest = async () => {
    if (!onReadRemote || operation.current || autosaving.current || current.current.blocked) return;
    operation.current = true;
    setIsSaving(true);
    // A read does not save the note: a failed save's message stays until a save succeeds.
    setSaveError(shown => writeFailed.current ? shown : '');
    try {
      const latest = await onReadRemote(note.path);
      if (mounted.current) applyRemote(latest);
    } catch (error) {
      handleRemoteFailure(error, 'read');
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };
  const restoreNote = async () => {
    if (readOnly || operation.current) return;
    operation.current = true;
    setIsSaving(true);
    setSaveError('');
    try {
      const restored = await onRestoreFile(note.path);
      clearLocalDraft(draftScope || branch, note.path);
      if (!mounted.current || !restored) return;
      markSaved({ content: restored.content, metadata: restored.metadata });
      current.current = { content: restored.content, metadata: restored.metadata, baseNote: restored, blocked: false };
      setBaseNote(restored);
      setContent(restored.content);
      setMetadata(restored.metadata);
      setRecoveredDraft(null);
      setBlocked(false);
      setBlockReason(null);
      setHasUnsavedChanges(false);
      writeFailed.current = false;
    } catch (error) {
      if (mounted.current) setSaveError((error as Error).message);
    } finally {
      operation.current = false;
      if (mounted.current) setIsSaving(false);
    }
  };

  const { registerBeforeNavigate } = useWorkspaceLinks();
  const registerEditor = useEditorRegistry();
  useEffect(() => {
    const persist = async () => {
      // An autosave under way writes first: two writes of one note must not race.
      while (autosaving.current) await new Promise(resolve => setTimeout(resolve, 50));
      // Text typed while a save is under way is newer than what that save writes, so it is saved too before the editor may go,
      // and its recovery draft stays until it is.
      while (hasUnsaved()) {
        const draft = current.current;
        saveLocalDraft(draftScope || branch, note.path, draft.content, draft.metadata);
        autosaving.current = true;
        try {
          const saved = await onSave({ path: note.path, content: draft.content, metadata: draft.metadata, baseNote: draft.baseNote });
          // What was just written is what is persisted: without this, the draft effect compares the next `note` refresh against an older save and writes the draft back.
          markSaved({ content: draft.content, metadata: draft.metadata });
          // The written note is the new base, so the next remote check does not take the app's own write for an external change; a draft is not a committed base.
          if (mounted.current && !draftMode) {
            current.current = { ...current.current, baseNote: saved };
            setBaseNote(saved);
          }
          clearWriteFailure();
        } catch (error) {
          showWriteFailure(error);
          return false;
        } finally {
          autosaving.current = false;
        }
      }
      // Nothing newer than what was saved is left to recover; an autosave that finished while the editor was going away leaves its draft behind.
      // The session writes only what it changed itself, so it cannot put older text over a note that was staged or retitled elsewhere.
      clearLocalDraft(draftScope || branch, note.path);
      return true;
    };
    // A concurrent operation (e.g. a just-mounted checkRemote) is read-only in effect by the time it
    // finishes, so navigation/hiding waits it out instead of racing it or dropping the flush entirely.
    const waitForOperation = async () => {
      while (operation.current) await new Promise(resolve => setTimeout(resolve, 50));
    };
    // Navigation waits for a conflict to be resolved; hiding the editor keeps the preserved draft, as closing zoom does.
    const beforeNavigate = async () => {
      if (readOnly) return beforeLeave?.() ?? true;
      await waitForOperation();
      return !mounted.current || (!current.current.blocked && await persist());
    };
    const beforeHide = async () => {
      if (readOnly) return beforeLeave?.() ?? true;
      await waitForOperation();
      return !mounted.current || current.current.blocked || await persist();
    };
    const unregister = [registerBeforeNavigate(beforeNavigate), registerEditor(noteRefKey(note), beforeHide)];
    return () => unregister.forEach(release => release());
  }, [registerBeforeNavigate, registerEditor, readOnly, note, onSave, draftScope, branch, draftMode, beforeLeave]);

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    // A mount or window focus can start a remote read just before the click. Honor the close after it settles.
    while (operation.current && mounted.current) await new Promise(resolve => setTimeout(resolve, 50));
    if (!mounted.current) return;
    const allowed = beforeLeave?.();
    if (allowed && (!await allowed || !mounted.current)) {
      closing.current = false;
      return;
    }
    if (autoSave && !readOnly && !current.current.blocked && hasUnsaved()) {
      setIsSaving(true);
      try {
        const saved = await onSave({ path: note.path, content: current.current.content, metadata: current.current.metadata, baseNote: current.current.baseNote });
        // A borrowed editor stays mounted after this close, so what it just wrote must count as persisted or the draft effect writes the draft back.
        markSaved({ content: current.current.content, metadata: current.current.metadata });
        clearLocalDraft(draftScope || branch, note.path);
        if (mounted.current && !draftMode) {
          current.current = { ...current.current, baseNote: saved };
          setBaseNote(saved);
        }
      } catch (error) {
        closing.current = false;
        setIsSaving(false);
        setSaveError('editor.localSaveFailed');
        setSaveErrorParams({ message: (error as Error).message });
        return;
      }
    }
    closing.current = false;
    if (!autoSave && !readOnly && hasUnsavedChanges && !window.confirm(t('editor.confirmCloseUnsaved'))) return;
    setIsSaving(false);
    onClose?.();
  };
  const copyNote = async () => {
    const ok = await copyToClipboard(current.current.content);
    if (!mounted.current) return;
    clearTimeout(copyResetTimer.current);
    setCopyState(ok ? 'copied' : 'error');
    copyResetTimer.current = setTimeout(() => {
      if (mounted.current) setCopyState('idle');
    }, 2000);
  };

  const handleRestoreDraft = () => {
    if (recoveredDraft && !locked) {
      setContent(recoveredDraft.content);
      setMetadata(recoveredDraft.metadata);
      setRecoveredDraft(null);
    }
  };

  const handleDiscardDraft = () => {
    clearLocalDraft(draftScope || branch, note.path);
    setRecoveredDraft(null);
  };

  const conflictDraftDismissed = conflictDraftSavedAt != null && conflictNoticeDismissedAt === conflictDraftSavedAt;
  const showRemoteNotice = Boolean(remoteNotice) && (blocked || !remoteNoticeDismissed);
  const showConflictDraftNotice = Boolean(conflictDraft) && (blocked || !conflictDraftDismissed);

  return { ready: readyKey === sessionKey, content, setContent, metadata, setMetadata, copyState, copyNote, isSaving, saveError, saveErrorParams, hasUnsavedChanges, baseNote, blocked, blockReason, openMoved, locked, isDirty, editorState, editorStatus, title, recoveredDraft, handleRestoreDraft, handleDiscardDraft, conflictDraft, showRemoteNotice, remoteNotice, showConflictDraftNotice, dismissNotice, refreshRemote, downloadConflictDraft, handleExplicitSave, commitNote, restoreNote, pullLatest, close };
}

/** Everything a note editing session exposes to the editor parts that render it. */
export type NoteEditorSessionState = ReturnType<typeof useNoteEditorSession>;
