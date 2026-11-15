import { useLayoutEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateNoteQueries, noteLookupOptions, resetStaleNoteQueries, setNoteQueryScope, useNoteQueryScope, useStaleNoteQueries } from '../lib/use-note-queries.js';
import { notebookRepositories, revisionSet } from '../lib/workspace-repositories.js';
import { composeCommitted } from '../lib/draft-overlay.js';
import { NO_COMMITTED, useCommittedLayer } from '../lib/use-committed-layer.js';
import { noteRefKey } from '@mygitnotes/core/note-query';
import type { NoteItem } from '../lib/types.js';
import type { NoteRef } from '@mygitnotes/core/note-query';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  sourceId: WorkspaceState['sourceId'];
  repositories: WorkspaceState['repositories'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  remote: WorkspaceState['remote'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  readDraft: WorkspaceState['readDraft'];
  t: I18nContextValue['t'];
}

export function useWorkspaceNotes({ sourceId, repositories, activeWorkingNotes, remote, refreshWorkspace, readDraft, t }: Params) {
  // Every note query is answered for the revisions of the repositories it reads; staged drafts are overlaid on top.
  const queryClient = useQueryClient();
  const revisions = useMemo(() => revisionSet(repositories), [repositories]);
  const notebooks = useMemo(() => notebookRepositories(repositories), [repositories]);
  const members = repositories.map(repository => repository.id).join('\n');
  // Repositories whose notes are edited in a live editor, whose reads go stale without any commit.
  const live = repositories.filter(repository => repository.live).map(repository => repository.id).join('\n');
  // A demo workspace's local commits are overlaid under the working changes; any other workspace has none.
  const committed = useCommittedLayer(repositories);
  const drafts = useMemo(() => composeCommitted(committed, activeWorkingNotes), [committed, activeWorkingNotes]);
  useLayoutEffect(() => {
    setNoteQueryScope({ sourceId, revisions, repositories: notebooks, members, drafts, ...(live ? { live: live.split('\n') } : {}), ...(committed === NO_COMMITTED ? {} : { committed }) });
  }, [sourceId, revisions, notebooks, members, drafts, committed, live]);
  const queryScope = useNoteQueryScope();
  const invalidateNotes = () => {
    void invalidateNoteQueries(queryClient);
  };
  // Staged drafts are overlaid on remote answers; only local saves change what the note queries return.
  const refreshNotes = async () => {
    if (!remote) await invalidateNoteQueries(queryClient);
  };
  // The server answers from each branch head: a rejected revision or cursor means this client is
  // behind, so the workspace is refreshed and the lists reading a stale repository restart from their first page.
  const [staleNotice, setStaleNotice] = useState('');
  useStaleNoteQueries((_message, stale) => {
    setStaleNotice(t('notes.repositoryChanged'));
    void refreshWorkspace(true).then(() => resetStaleNoteQueries(queryClient, stale));
  });
  const revisionKey = JSON.stringify(revisions);
  const [previousRevisions, setPreviousRevisions] = useState(revisionKey);
  if (previousRevisions !== revisionKey) {
    setPreviousRevisions(revisionKey);
    setStaleNotice('');
  }
  /** The committed note, ignoring any staged draft, for use as a merge base. */
  /** The committed note at `ref`, or null when the repository has none there. */
  /** `fresh` reads a live repository's note past the cache: a checkout (編輯中) changes what it answers without moving its revision. */
  const findCommittedNote = async (ref: NoteRef, options: { fresh?: boolean; } = {}): Promise<NoteItem | null> => {
    const local = committed[noteRefKey(ref)];
    if (local) return local.deleted ? null : local.note;
    const live = options.fresh && queryScope.live?.includes(queryScope.repositories[ref.notebookId]);
    const result = await queryClient.fetchQuery({ ...noteLookupOptions(queryScope, [ref], true), ...(live ? { staleTime: 0 } : {}) });
    const note = result.notes[0];
    return note && typeof note.content === 'string' ? note as NoteItem : null;
  };
  const readCommittedNote = async (ref: NoteRef): Promise<NoteItem> => {
    const note = await findCommittedNote(ref);
    if (!note) throw new Error(t('notes.readFailed', { path: ref.path }));
    return note;
  };
  /** The note a change must be applied to: the staged draft when there is one, else the committed note. */
  const readNoteForChange = async (ref: NoteRef): Promise<NoteItem> => {
    const pending = remote ? readDraft(ref.notebookId, ref.path) : undefined;
    return pending ? pending.note : readCommittedNote(ref);
  };

  return { queryClient, queryScope, invalidateNotes, refreshNotes, staleNotice, findCommittedNote, readCommittedNote, readNoteForChange };
}
