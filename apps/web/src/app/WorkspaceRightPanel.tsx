import type React from 'react';
import { FileMetadata } from '../components/files/index.js';
import { RightPanel } from '../components/RightPanel.js';
import type { NotebookConfig } from '../lib/types.js';
import type { useChangeDialog } from './useChangeDialog.js';
import type { useDeletionUndo } from './useDeletionUndo.js';
import type { useFilePanel } from './useFilePanel.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useNoteSaving } from './useNoteSaving.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';
import type { useWorkspaceOverview } from './useWorkspaceOverview.js';
import type { WorkspaceState } from './workspace-state.js';

type DeletionUndo = ReturnType<typeof useDeletionUndo>;
type Overview = ReturnType<typeof useWorkspaceOverview>;

interface Props {
  phoneNotes: boolean;
  /** The active Focus pane's document panel, while the Notes page shows a Focus. */
  documentPanel: React.ComponentProps<typeof RightPanel>['documentPanel'];
  /** Whether the Files page shows the panel, which then keeps only Changes and the file's metadata. */
  fileMode: boolean;
  filePanel: ReturnType<typeof useFilePanel>;
  /** Whether the selected file's metadata may be edited now. */
  canEditFileMetadata: boolean;
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  currentFolder: string | undefined;
  remote: WorkspaceState['remote'];
  gitStatus: WorkspaceState['gitStatus'];
  repoRoot: WorkspaceState['repoRoot'];
  updateDraft: WorkspaceState['updateDraft'];
  changeCount: Overview['changeCount'];
  remoteTrash: Overview['remoteTrash'];
  repositoryHeading: Overview['repositoryHeading'];
  deletedNotes: DeletionUndo['deletedNotes'];
  handleRestoreNote: DeletionUndo['handleRestoreNote'];
  changeDialog: ReturnType<typeof useChangeDialog>;
  canWrite: boolean;
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  handleSaveNote: ReturnType<typeof useNoteSaving>['handleSaveNote'];
  readNoteForChange: ReturnType<typeof useWorkspaceNotes>['readNoteForChange'];
  refreshAfterSync: () => Promise<void>;
}

/** The workspace's right panel: Calendar, Todo and Changes, a Focus pane's document panel, or a file's metadata; a remote workspace's trash is its drafts. */
export function WorkspaceRightPanel({ phoneNotes, documentPanel, fileMode, filePanel, canEditFileMetadata, notebooks, selectedNotebookId, currentFolder, remote, gitStatus, repoRoot, updateDraft, changeCount, remoteTrash, repositoryHeading, deletedNotes, handleRestoreNote, changeDialog, canWrite, handleOpenNote, handleSaveNote, readNoteForChange, refreshAfterSync }: Props) {
  const { fileMetadataOpen, setFileMetadataOpen, selectedFileEntry, setFileMetadataContainer, setRightPanelWidth, fileManagerRef } = filePanel;
  const { openCommitModal, panelRemoteChanges, panelGetPreview } = changeDialog;
  return <RightPanel phoneSheet={phoneNotes} documentPanel={documentPanel} fileMode={fileMode} metadataOpen={fileMetadataOpen} onMetadataOpenChange={setFileMetadataOpen} fileMetadata={selectedFileEntry ? <FileMetadata entry={selectedFileEntry} onEdit={canEditFileMetadata ? () => void fileManagerRef.current?.editMetadata() : undefined} /> : undefined} onFileMetadataContainer={setFileMetadataContainer} notebooks={notebooks} selectedNotebookId={selectedNotebookId} currentFolder={currentFolder} onOpenNote={handleOpenNote} onSaveNote={handleSaveNote} onReadNote={readNoteForChange} gitStatus={gitStatus} changeCount={remote ? changeCount - remoteTrash.length : changeCount} deletedNotes={remote ? remoteTrash : deletedNotes} onRestoreNote={remote ? note => updateDraft(note.notebookId, note.path, null) : handleRestoreNote} onOpenCommitModal={openCommitModal} writable={canWrite} remoteChanges={panelRemoteChanges} getPreview={panelGetPreview} onSynced={remote ? undefined : refreshAfterSync} repositoryHeading={repositoryHeading} repoRoot={repoRoot} onWidthChange={setRightPanelWidth} />;
}
