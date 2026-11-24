import type { NoteRef } from '@mygitnotes/core/note-query';
import { useMemo } from 'react';
import type { LiveDrafts } from '../components/live/live-drafts.js';
import { type NoteLocation, noteLocation } from '../lib/note-location.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: WorkspaceState['config'];
  remote: WorkspaceState['remote'];
  repositories: WorkspaceState['repositories'];
  defaultRepository: WorkspaceState['defaultRepository'];
  repositoryFor: WorkspaceState['repositoryFor'];
  sourceId: WorkspaceState['sourceId'];
  gitStatus: WorkspaceState['gitStatus'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  pendingDocuments: WorkspaceState['pendingDocuments'];
  selectedNotebookId: string;
}

/** What the workspace's repositories add up to: their pending changes, how Changes and the notebook switchers name them, which can serve or write, and what their live editors do with a pending note. */
export function useWorkspaceOverview({ config, remote, repositories, defaultRepository, repositoryFor, sourceId, gitStatus, activeWorkingNotes, pendingDocuments, selectedNotebookId }: Params) {
  /** Where a note lives, for the note Info tab: the repository and branch of its notebook, and why it is read-only. */
  const locateNote = (note: NoteRef): NoteLocation | undefined => {
    const repository = repositoryFor(note.notebookId);
    const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
    if (!notebook) return undefined;
    return noteLocation(notebook.title, repository, note.path);
  };
  /** Pending changes across repositories; a path names a file only within its repository, so each repository counts its own. */
  // A remote deletion is a working change held in the trash, which the Changes panel lists and counts apart.
  const remoteTrash = useMemo(() => Object.values(activeWorkingNotes).flatMap(entry => entry.deleted && entry.base ? [entry.base] : []), [activeWorkingNotes]);
  const changeCount = remote ? Object.keys(activeWorkingNotes).length + pendingDocuments.length : repositories.filter(repository => !repository.unavailable).reduce((sum, repository) => {
    const status = repository.id === sourceId ? gitStatus : repository.gitStatus;
    return sum + (status ? new Set([...status.staged, ...status.modified, ...status.untracked]).size : 0);
  }, 0);
  /** With several repositories, Changes groups entries under each repository and its branch. */
  const repositoryHeading = repositories.length > 1
    ? (id: string | undefined) => {
      const repository = repositories.find(candidate => candidate.id === id);
      const name = repository?.title ?? (id?.startsWith('local:') ? id.slice('local:'.length) : id ?? '');
      return repository?.branch ? `${name} · ${repository.branch}` : name;
    }
    : undefined;
  /** Why the selected notebook's repository cannot serve it; its notebook views show this instead. */
  const notebookUnavailable = repositoryFor(selectedNotebookId)?.unavailable;
  /** Whether the default repository, when it keeps no manifest, can create one from its derived layout. */
  const manifestWritable = Boolean(defaultRepository?.write);
  // A workspace-wide tag change commits to every repository that serves a notebook.
  const canManageTags = repositories.some(repository => repository.notebooks.length) && repositories.every(repository => repository.write || !repository.notebooks.length);
  /** With several repositories, the notebooks column and the notebook switchers group notebooks under each repository's title. */
  const notebookGroups = repositories.length > 1 ? repositories.filter(repository => repository.notebooks.length).map(repository => ({ label: repository.title, notebooks: repository.notebooks })) : undefined;
  const unavailableNotebooks = repositories.filter(repository => repository.unavailable).flatMap(repository => repository.notebooks);
  const syncTargets = useMemo(() => remote ? [] : repositories.filter(repository => !repository.unavailable).map(repository => ({ id: repository.id, label: repository.repository ?? repository.id.replace(/^local:/, ''), writable: repository.write, gitStatus: repository.id === sourceId ? gitStatus : repository.gitStatus ?? null })), [remote, repositories, sourceId, gitStatus]);
  // What each repository's live editor can do with a pending note (未歸檔): discard it on delete, move and rename it.
  const liveDrafts = useMemo<LiveDrafts>(() => {
    const live = (notebookId: string) => {
      const repository = repositoryFor(notebookId);
      return repository?.write ? repository.live : undefined;
    };
    return { discards: notebookId => Boolean(live(notebookId)?.discard), retargets: notebookId => Boolean(live(notebookId)?.retarget), releasesUntouched: notebookId => live(notebookId)?.kind === 'builtin' };
  }, [repositoryFor]);
  return { locateNote, remoteTrash, changeCount, repositoryHeading, notebookUnavailable, manifestWritable, canManageTags, notebookGroups, unavailableNotebooks, syncTargets, liveDrafts };
}
