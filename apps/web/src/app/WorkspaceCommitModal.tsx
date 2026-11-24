import { type NoteListItem, sameNote } from '@mygitnotes/core/note-query';
import type React from 'react';
import type { AgentSystemHandle } from '../components/AgentSystemView.js';
import { CommitModal } from '../components/CommitModal.js';
import { readNote } from '../lib/api.js';
import { discardDocumentDraft } from '../lib/use-workspace-document.js';
import { documentClientOf } from '../lib/workspace-document-clients.js';
import { editable } from '../lib/workspace-repositories.js';
import type { useChangeDialog } from './useChangeDialog.js';
import type { useDeletionUndo } from './useDeletionUndo.js';
import type { useWorkingNoteCommit } from './useWorkingNoteCommit.js';
import type { useWorkspaceOverview } from './useWorkspaceOverview.js';
import type { WorkspaceState } from './workspace-state.js';

interface Props {
  remote: WorkspaceState['remote'];
  repositories: WorkspaceState['repositories'];
  documents: WorkspaceState['documents'];
  pendingDocuments: WorkspaceState['pendingDocuments'];
  gitStatus: WorkspaceState['gitStatus'];
  readDraft: WorkspaceState['readDraft'];
  readDraftIn: WorkspaceState['readDraftIn'];
  updateDraft: WorkspaceState['updateDraft'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  refreshDocuments: () => Promise<void>;
  changeDialog: ReturnType<typeof useChangeDialog>;
  commitWorkingNotes: ReturnType<typeof useWorkingNoteCommit>['commitWorkingNotes'];
  repositoryHeading: ReturnType<typeof useWorkspaceOverview>['repositoryHeading'];
  agentSystemRef: React.RefObject<AgentSystemHandle>;
  editingNote: NoteListItem | null;
  setEditingNote: React.Dispatch<React.SetStateAction<NoteListItem | null>>;
  setDeletedNotes: ReturnType<typeof useDeletionUndo>['setDeletedNotes'];
  setUndoToast: ReturnType<typeof useDeletionUndo>['setUndoToast'];
}

/** The Changes dialog: a remote workspace's drafts discarded and committed here, and the views read again after a commit. */
export function WorkspaceCommitModal({ remote, repositories, documents, pendingDocuments, gitStatus, readDraft, readDraftIn, updateDraft, refreshWorkspace, refreshDocuments, changeDialog, commitWorkingNotes, repositoryHeading, agentSystemRef, editingNote, setEditingNote, setDeletedNotes, setUndoToast }: Props) {
  const { commitRequest, isCommitOpen, setIsCommitOpen, panelRemoteChanges, panelGetPreview, panelDescribeChanges } = changeDialog;
  return (
    <CommitModal
      writable={repositories.some(editable)}
      remoteChanges={panelRemoteChanges}
      getPreview={panelGetPreview}
      describeChanges={panelDescribeChanges}
      request={commitRequest}
      restoreFile={remote
        ? async file => {
          const pendingDocument = pendingDocuments.find(document => document.repository === file.repository && document.file === file.path);
          if (pendingDocument) {
            if (file.revision !== pendingDocument.diff) throw new Error('Draft changed. Review it again.');
            discardDocumentDraft(documentClientOf(file.path)!, pendingDocument.repository);
            const live = documents.find(document => document.file === file.path && document.repository === pendingDocument.repository);
            if (live) await live.reload();
            return;
          }
          const entry = file.repository ? readDraftIn(file.repository, file.path) : undefined;
          if (!entry || JSON.stringify(entry) !== file.revision) throw new Error('Draft changed. Review it again.');
          // The draft lives in this browser, so discarding it is a local delete. Reading the remote
          // only refreshes an open editor, and a draft is often blocked precisely because that read
          // fails, which used to leave the draft undiscardable.
          const latest = entry.base ? await readNote(file.path).catch(() => null) : null;
          if (JSON.stringify(readDraft(entry.note.notebookId, file.path)) !== file.revision) throw new Error('Draft changed. Review it again.');
          updateDraft(entry.note.notebookId, file.path, null);
          if (latest && editingNote && sameNote(editingNote, entry.note)) setEditingNote(latest);
        }
        : undefined}
      commitFiles={remote ? commitWorkingNotes : undefined}
      repositoryHeading={repositoryHeading}
      isOpen={isCommitOpen}
      onClose={() => setIsCommitOpen(false)}
      gitStatus={gitStatus}
      onChanged={async () => {
        await refreshWorkspace();
        if (!remote) {
          await refreshDocuments();
          await agentSystemRef.current?.refresh();
        }
      }}
      onCommitted={async () => {
        // Another server instance may still cache the head from before this commit.
        await refreshWorkspace(true);
        if (!remote) {
          await refreshDocuments();
          await agentSystemRef.current?.refresh();
        }
        setDeletedNotes([]);
        setUndoToast(null);
      }}
    />
  );
}
