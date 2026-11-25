import type { QueryClient } from '@tanstack/react-query';
import { invertTagOperationPlan, planTagDelete, planTagMerge, planTagRename } from '@mygitnotes/core/tag-ops';
import { type TagOperationKind, type TagOperationLabel, useTagOperations } from '../lib/use-tag-operations.js';
import { applyTagEntries, PartialTagChangeError, skippedTagNotice, wasSkipped } from '../lib/tag-changes.js';
import { repositoryOf, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { noteLookupOptions, notePathsOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

interface UseTagWorkspaceOperationsParams {
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  repositories: WorkspaceRepository[];
  remote: boolean;
  canWrite: boolean;
  t: I18nContextValue['t'];
  invalidateNotes: () => void;
  setRepositoryRevision: (id: string, revision: string) => void;
  setActionError: (message: string) => void;
}

/** Tag management: rename/merge/delete across the whole workspace, one commit per repository,
 * with a session-lifetime undo (kept in `tagOperations.history` until page reload). */
export function useTagWorkspaceOperations({ queryClient, queryScope, repositories, remote, canWrite, t, invalidateNotes, setRepositoryRevision, setActionError }: UseTagWorkspaceOperationsParams) {
  const tagOperations = useTagOperations();
  const readNotePaths = async (query: Parameters<typeof notePathsOptions>[1]) => (await queryClient.fetchQuery(notePathsOptions(queryScope, query))).notes;
  /** Every note carrying `tag`, in every notebook, hidden ones included: the exact set the server will rewrite. */
  const notesWithTag = async (tag: string) => {
    const notes = await readNotePaths({ notebookId: 'all', tags: [tag], showHidden: true, kind: 'all' });
    if (!notes.length) return [];
    const result = await queryClient.fetchQuery(noteLookupOptions(queryScope, notes, false));
    return result.notes;
  };
  const previewTagUsage = async (tag: string): Promise<number> => (await readNotePaths({ notebookId: 'all', tags: [tag], showHidden: true, kind: 'all' })).length;
  const applyEntries = (entries: { path: string; notebookId: string; tags: string[]; }[], message: string) =>
    applyTagEntries(repositories, entries, message, (repository, revision) => {
      if (remote && revision) setRepositoryRevision(repository.id, revision);
    });
  const runTagOperation = async (kind: TagOperationKind, plan: ReturnType<typeof planTagDelete>, label: TagOperationLabel) => {
    if (plan.affected.length === 0) throw new Error(t('sidebar.tagNoNotesAffected'));
    const entries = plan.affected.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
    let skipped: Awaited<ReturnType<typeof applyEntries>>;
    try {
      skipped = await applyEntries(entries, t(label.key, label.params));
    } catch (error) {
      // Repositories committed before the failure keep their change, so their part stays undoable.
      if (error instanceof PartialTagChangeError) {
        tagOperations.record(kind, label, { ...plan, affected: plan.affected.filter(entry => error.committed.includes(repositoryOf(repositories, entry.notebookId)?.id ?? '') && !wasSkipped(error.skipped, entry)) });
        if (error.skipped.length) setActionError(skippedTagNotice(t, error.skipped));
      }
      throw error;
    } finally {
      if (!remote) invalidateNotes();
    }
    // A compilation the server skipped kept its tags: the undo leaves it alone, and the page names it.
    const written = plan.affected.filter(entry => !wasSkipped(skipped, entry));
    if (written.length) tagOperations.record(kind, label, { ...plan, affected: written });
    if (skipped.length) setActionError(skippedTagNotice(t, skipped));
  };
  const handleRenameTag = async (from: string, to: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagRename(await notesWithTag(from), from, to);
    await runTagOperation('rename', plan, { key: 'sidebar.tagRenamedLabel', params: { from, to, count: plan.affected.length } });
  };
  const handleMergeTag = async (from: string, into: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagMerge(await notesWithTag(from), from, into);
    await runTagOperation('merge', plan, { key: 'sidebar.tagMergedLabel', params: { from, to: into, count: plan.affected.length } });
  };
  const handleDeleteTag = async (tag: string) => {
    if (!canWrite) throw new Error(t('folder.readOnly'));
    const plan = planTagDelete(await notesWithTag(tag), tag);
    await runTagOperation('delete', plan, { key: 'sidebar.tagDeletedLabel', params: { tag, count: plan.affected.length } });
  };
  const handleUndoTagOperation = async (id: string) => {
    const record = tagOperations.history.find(entry => entry.id === id);
    if (!record) return;
    try {
      const inverted = invertTagOperationPlan(record.plan);
      const existing = (await queryClient.fetchQuery(noteLookupOptions(queryScope, inverted.affected, false))).notes;
      const validEntries = inverted.affected.filter(entry => existing.some(note => note.path === entry.path && note.notebookId === entry.notebookId));
      if (validEntries.length === 0) {
        tagOperations.dismiss(id);
        return;
      }
      const entries = validEntries.map(({ path, notebookId, nextTags }) => ({ path, notebookId, tags: nextTags }));
      let skipped: Awaited<ReturnType<typeof applyEntries>>;
      let failure: PartialTagChangeError | undefined;
      try {
        skipped = await applyEntries(entries, `${t('common.undo')}: ${t(record.label.key, record.label.params)}`);
      } catch (error) {
        // Repositories committed before the failure restored their part; the rest stays in the record below.
        if (!(error instanceof PartialTagChangeError)) throw error;
        failure = error;
        skipped = error.skipped;
      } finally {
        if (!remote) invalidateNotes();
      }
      // What a committed repository wrote is restored; a skipped compilation and a repository that failed stay undoable.
      const restored = (entry: { path: string; notebookId: string; }) => (!failure || failure.committed.includes(repositoryOf(repositories, entry.notebookId)?.id ?? '')) && !wasSkipped(skipped, entry);
      const left = record.plan.affected.filter(entry => validEntries.some(valid => valid.path === entry.path && valid.notebookId === entry.notebookId) && !restored(entry));
      if (left.length) tagOperations.narrow(id, { ...record.plan, affected: left });
      else tagOperations.dismiss(id);
      const notice = [failure?.message, skippedTagNotice(t, skipped)].filter(Boolean).join(' ');
      if (notice) setActionError(notice);
    } catch (error) {
      // Keep the record so the user can retry; a silently vanished undo with no feedback
      // would leave them unable to tell whether the undo happened.
      setActionError((error as Error).message);
    }
  };
  return { tagOperations, previewTagUsage, handleRenameTag, handleMergeTag, handleDeleteTag, handleUndoTagOperation };
}
