import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useState } from 'react';
import { BulkActionsToolbar } from '../components/BulkActionsToolbar.js';
import { FolderPickerDialog } from '../components/FolderPickerDialog.js';
import { liveActionLocked, type LiveDrafts } from '../components/live/live-drafts.js';
import type { FileChangeScope } from '../lib/file-change-scope.js';
import type { FileResult } from '../lib/files-api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { useTagOperations } from '../lib/use-tag-operations.js';
import { useBulkNoteActions } from './useBulkNoteActions.js';
import type { useNoteSelection } from './useNoteSelection.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  selection: ReturnType<typeof useNoteSelection>;
  config: WorkspaceState['config'];
  remote: boolean;
  folders: WorkspaceState['folders'];
  repositories: WorkspaceState['repositories'];
  setRepositoryRevision: WorkspaceState['setRepositoryRevision'];
  setActionError: WorkspaceState['setActionError'];
  /** Whether the selected notebook's files may be changed: moves and tag changes rewrite them. */
  canWriteFiles: boolean;
  statuses: string[];
  availableTags: string[];
  liveDrafts: LiveDrafts;
  tagOperations: ReturnType<typeof useTagOperations>;
  onUpdateNoteStatus: (note: NoteListItem, newStatus: string) => Promise<boolean>;
  beforeFileChange: (scope?: FileChangeScope) => Promise<void>;
  onFilesChanged: (result: FileResult) => Promise<void>;
  invalidateNotes: () => void;
  t: I18nContextValue['t'];
}

/** The browse views' bulk actions on the selected notes (set status, add or remove a tag, move to a folder): their toolbar and the move's folder picker. */
export function useBulkToolbar({ selection, config, remote, folders, repositories, setRepositoryRevision, setActionError, canWriteFiles, statuses, availableTags, liveDrafts, tagOperations, onUpdateNoteStatus, beforeFileChange, onFilesChanged, invalidateNotes, t }: Params) {
  const { selectedNotes, clearSelection } = selection;
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveNotebookId = selectedNotes.length > 0 && selectedNotes.every(note => note.notebookId === selectedNotes[0].notebookId) ? selectedNotes[0].notebookId : undefined;
  const bulkMoveNotebook = config?.notebooks.find(nb => nb.id === bulkMoveNotebookId);
  const { bulkBusy, runBulkStatus, runBulkTag, runBulkMove } = useBulkNoteActions({ selectedNotes, clearSelection, onUpdateNoteStatus, beforeFileChange, onFilesChanged, repositories, remote, canWrite: canWriteFiles, t, invalidateNotes, setRepositoryRevision, setActionError, tagOperations, config });
  const toolbar = selectedNotes.length > 0 && <BulkActionsToolbar count={selectedNotes.length} statuses={statuses} availableTags={availableTags} busy={bulkBusy} readOnly={!canWriteFiles} canMove={Boolean(bulkMoveNotebookId)} liveNotes={selectedNotes.filter(note => liveActionLocked(note, 'other', liveDrafts)).map(note => note.title || note.path)} liveMovable={selectedNotes.every(note => !liveActionLocked(note, 'move', liveDrafts))} onSetStatus={status => void runBulkStatus(status)} onAddTag={tag => void runBulkTag('add', tag)} onRemoveTag={tag => void runBulkTag('remove', tag)} onMove={() => setBulkMoveOpen(true)} onClear={clearSelection} />;
  const moveDialog = bulkMoveOpen && bulkMoveNotebook && (
    <FolderPickerDialog
      notebooks={[bulkMoveNotebook]}
      folders={folders}
      title={t('bulk.moveDialogTitle', { count: selectedNotes.length })}
      initial={{ notebookId: bulkMoveNotebook.id, folder: null }}
      confirmLabel={t('bulk.moveConfirm')}
      busy={bulkBusy}
      onClose={() => setBulkMoveOpen(false)}
      onConfirm={({ folder }) => {
        setBulkMoveOpen(false);
        void runBulkMove(bulkMoveNotebook.id, folder);
      }}
    />
  );
  return { toolbar, moveDialog };
}
