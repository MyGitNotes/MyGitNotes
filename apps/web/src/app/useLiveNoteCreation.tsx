import type { NoteListItem } from '@mygitnotes/core/note-query';
import { useState } from 'react';
import { LiveNewNoteDialog } from '../components/live/LiveNewNoteDialog.js';
import type { LivePathPrompt } from '../lib/new-note.js';
import type { useNoteActions } from './useNoteActions.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  /** The selected notebook's repository, whose live editor takes the new notes. */
  repository: ReturnType<WorkspaceState['repositoryFor']>;
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
}

/** A new note of a live repository: what its creation asks of the live editor, and the dialog that asks for its template's path values. */
export function useLiveNoteCreation({ repository, handleOpenNote }: Params) {
  // A new note of a live repository whose template's path needs values asks for them first.
  const [livePathRequest, setLivePathRequest] = useState<{ template: string; prompts: LivePathPrompt[]; answer: (values: Record<string, string> | null) => void; } | null>(null);
  const liveCreation = repository?.live && repository.write ? { askLivePathValues: (template: string, prompts: LivePathPrompt[]) => new Promise<Record<string, string> | null>(answer => setLivePathRequest({ template, prompts, answer })), open: (note: NoteListItem) => void handleOpenNote(note) } : undefined;
  const dialog = livePathRequest && (
    <LiveNewNoteDialog
      template={livePathRequest.template}
      prompts={livePathRequest.prompts}
      onConfirm={values => {
        livePathRequest.answer(values);
        setLivePathRequest(null);
      }}
      onCancel={() => {
        livePathRequest.answer(null);
        setLivePathRequest(null);
      }}
    />
  );
  return { liveCreation, dialog };
}
