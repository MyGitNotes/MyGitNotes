import { sameNote } from '@mygitnotes/core/note-query';
import { liveEditableKind } from '../lib/live-api.js';
import { draftScope } from '../lib/workspace-repositories.js';
import { useLiveHandover } from './useLiveHandover.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useRoutedNote } from './useRoutedNote.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: WorkspaceState['config'];
  remote: WorkspaceState['remote'];
  sourceId: WorkspaceState['sourceId'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  repositoryFor: WorkspaceState['repositoryFor'];
  updateDraft: WorkspaceState['updateDraft'];
  readDraft: WorkspaceState['readDraft'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  invalidateNotes: () => void;
  isTemplate: (note: { notebookId: string; path: string; }) => boolean;
  /** The note the address names, whose editor opens the pending live note its offline draft became. */
  routedNote: ReturnType<typeof useRoutedNote>['routedNote'];
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
}

/** The workspace's offline handover: which drafts the built-in live editor covers, and the editor that follows a note made offline. */
export function useWorkspaceHandover({ config, remote, sourceId, activeWorkingNotes, repositoryFor, updateDraft, readDraft, stageWorkingNote, invalidateNotes, isTemplate, routedNote, handleOpenNote }: Params) {
  // Offline handover (collab-first A3.2): once online, drafts of notes the built-in live editor covers go to their live notes.
  return useLiveHandover({
    ready: Boolean(remote && sourceId && config),
    drafts: activeWorkingNotes,
    covered: draftNote => {
      const repository = repositoryFor(draftNote.notebookId);
      const notebook = config?.notebooks.find(nb => nb.id === draftNote.notebookId);
      return repository?.live?.kind === 'builtin' && repository.write && notebook && liveEditableKind(draftNote.path) && !isTemplate(draftNote) ? { scope: draftScope(repository), notebookRoot: notebook.root } : null;
    },
    updateDraft,
    readDraft,
    stageWorkingNote,
    invalidateNotes,
    // A note made offline is a pending live note now: an editor showing its draft opens it there.
    onCreated: (draftNote, checkout) => {
      if (routedNote && sameNote(routedNote, draftNote)) void handleOpenNote({ id: checkout.id, path: checkout.path, notebookId: checkout.notebookId, title: draftNote.title, tags: [], metadata: {}, live: { since: checkout.since, activeEditors: checkout.activeEditors, pending: true, editorUrl: checkout.editorUrl } });
    },
  });
}
