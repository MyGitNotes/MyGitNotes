import { type NoteListItem, noteQueryStatuses, noteRefKey } from '@mygitnotes/core/note-query';
import { parseNoteFile } from '@mygitnotes/core/note-file';
import type { useNavigate } from 'react-router-dom';
import type { NoteEditorSharedProps } from '../components/note-editor/types.js';
import { fetchFileDiff, readNote } from '../lib/api.js';
import { liveEditableKind, type LiveNoteEditing } from '../lib/live-api.js';
import { LIVE_MERGE_CONFLICT, noteFileText } from '../lib/live-handover.js';
import { noteRoute } from '../lib/routes.js';
import type { NoteItem } from '../lib/types.js';
import { workingDiff } from '../lib/working-notes.js';
import { draftScope, editable } from '../lib/workspace-repositories.js';
import type { useAssetOperations } from './useAssetOperations.js';
import type { useBrowseFacets } from './useBrowseFacets.js';
import type { useDeletionUndo } from './useDeletionUndo.js';
import type { useFileNavigation } from './useFileNavigation.js';
import type { useLiveHandover } from './useLiveHandover.js';
import type { useNoteActions } from './useNoteActions.js';
import type { useOpenNoteLinkInFocus } from './useNoteLinkFocus.js';
import type { useNoteMove } from './useNoteMove.js';
import type { useNoteRestoration } from './useNoteRestoration.js';
import type { useNoteSaving } from './useNoteSaving.js';
import type { useQuickNoteCommit } from './useQuickNoteCommit.js';
import type { useTemplateActions } from './useTemplateActions.js';
import type { WorkspaceState } from './workspace-state.js';

type AssetOperations = ReturnType<typeof useAssetOperations>;
type FileNavigation = ReturnType<typeof useFileNavigation>;
type NoteLinkInFocus = ReturnType<typeof useOpenNoteLinkInFocus>;

export interface NoteEditorPropsContext {
  config: WorkspaceState['config'];
  remote: WorkspaceState['remote'];
  sourceId: WorkspaceState['sourceId'];
  gitStatus: WorkspaceState['gitStatus'];
  assets: WorkspaceState['assets'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  repositoryFor: WorkspaceState['repositoryFor'];
  refreshWorkspace: WorkspaceState['refreshWorkspace'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  updateDraft: WorkspaceState['updateDraft'];
  setActionError: WorkspaceState['setActionError'];
  navigate: ReturnType<typeof useNavigate>;
  search: string;
  facets: ReturnType<typeof useBrowseFacets>['facetsQuery']['facets'];
  availableTags: string[];
  invalidateNotes: () => void;
  isTemplate: (note: { notebookId: string; path: string; }) => boolean;
  handleOpenNote: ReturnType<typeof useNoteActions>['handleOpenNote'];
  closeZoom: ReturnType<typeof useNoteActions>['closeZoom'];
  handleSaveNote: ReturnType<typeof useNoteSaving>['handleSaveNote'];
  handleRestoreNoteFile: ReturnType<typeof useNoteRestoration>['handleRestoreNoteFile'];
  handleDeleteNote: ReturnType<typeof useDeletionUndo>['handleDeleteNote'];
  commitNoteFile: ReturnType<typeof useQuickNoteCommit>['commitNoteFile'];
  handleUploadAsset: AssetOperations['handleUploadAsset'];
  handleDeleteAsset: AssetOperations['handleDeleteAsset'];
  handleMoveAsset: AssetOperations['handleMoveAsset'];
  beforeFileChange: FileNavigation['beforeFileChange'];
  onFilesChanged: FileNavigation['onFilesChanged'];
  returnToFocus: NoteLinkInFocus['returnToFocus'];
  frameSelection: NoteLinkInFocus['frameSelection'];
  liveHandover: ReturnType<typeof useLiveHandover>;
  noteMove: ReturnType<typeof useNoteMove>;
  templateActions: ReturnType<typeof useTemplateActions>;
  /** Follows a note that lies elsewhere now, with the note path the address names. */
  followMoved: (note: { notebookId: string; path: string; }, to: string, routedPath: string | null | undefined) => void;
  routedPath: string | null | undefined;
}

/** Every editor of a note, in zoom or in a Focus pane, is wired to the same handlers and per-path state. */
export function noteEditorProps(context: NoteEditorPropsContext) {
  const { config, remote, sourceId, gitStatus, assets, activeWorkingNotes, repositoryFor, refreshWorkspace, stageWorkingNote, updateDraft, setActionError, navigate, search, facets, availableTags, invalidateNotes, isTemplate, handleOpenNote, closeZoom, handleSaveNote, handleRestoreNoteFile, handleDeleteNote, commitNoteFile, handleUploadAsset, handleDeleteAsset, handleMoveAsset, beforeFileChange, onFilesChanged, returnToFocus, frameSelection, liveHandover, noteMove, templateActions, followMoved, routedPath } = context;
  return (note: NoteItem, committed?: NoteItem): NoteEditorSharedProps => {
    // The note's repository decides whether it may be written and where its drafts are kept.
    const repository = repositoryFor(note.notebookId);
    // A demo note is edited and committed in this browser; its assets and files are changes only the server makes.
    const editableNote = editable(repository);
    const writable = Boolean(repository?.write);
    // A live note's conflict draft is offered beside the live note (collab-first A3.1), never as the note's own draft.
    const stored = activeWorkingNotes[noteRefKey(note)];
    const liveConflict = stored?.blocked === LIVE_MERGE_CONFLICT ? stored : undefined;
    const draft = liveConflict ? undefined : stored;
    const repositoryStatus = repository?.id === sourceId ? gitStatus : repository?.gitStatus ?? null;
    // A repository with a live editor opens its Markdown notes read-only, edited there; outlines and templates keep the direct editor.
    const live: LiveNoteEditing | undefined = repository?.live && repository.write && liveEditableKind(note.path) && !isTemplate(note)
      ? {
        editor: repository.live,
        onRefetch: invalidateNotes,
        openZoom: () => void handleOpenNote(note),
        onCheckedIn: answer => {
          // The check-in moved the repository's head; a pending note now lives at the path it was filed at. The lists are
          // read again once the workspace has the new revision, not before, when the server would refuse the old one.
          void refreshWorkspace(true).then(invalidateNotes);
          const notebook = config?.notebooks.find(nb => nb.id === note.notebookId);
          if (answer?.filed && answer.path && notebook && answer.path.startsWith(`${notebook.root}/`)) navigate(noteRoute(notebook.id, answer.path.slice(notebook.root.length + 1)) + search, { replace: true });
        },
        // Checked in by someone else while this page still offers its unsaved text: the workspace first, then the lists.
        onReleased: () => void refreshWorkspace(true).then(invalidateNotes),
        // A discarded pending note is gone: the lists read it again and the view goes back to the notebook.
        onDiscarded: () => {
          invalidateNotes();
          closeZoom();
        },
        // Collab-first (A7): the note's own editor moves or renames it while it stays open, the server recording where its
        // check-in moves it (§20.4); a deletion follows a check-in, against the revision the check-in made.
        // Offline handover (A3): a draft the direct editor made offline goes to the live note once online; what the collab
        // editor kept but could not merge becomes a conflict draft, which the editor offers to compare, copy or discard.
        handOver: () => liveHandover.handOver(note),
        // A second conflict never takes the place of one the person has not dealt with: the editor offers it to copy instead.
        onMergeConflict: mine => {
          const parsed = parseNoteFile(mine, note.path);
          try {
            stageWorkingNote({ ...note, content: parsed.content, metadata: parsed.metadata }, note, LIVE_MERGE_CONFLICT);
            return true;
          } catch {
            return false;
          }
        },
        ...(liveConflict ? { mergeConflict: { mine: noteFileText(liveConflict.note), discard: () => updateDraft(note.notebookId, note.path, null) } } : {}),
        fileActions: { move: () => noteMove.moveNote({ ...note, live: undefined, editing: true })?.(), rename: (_revision, title) => noteMove.renameNote({ ...note, live: undefined, editing: true }, undefined, title || undefined)?.(), remove: revision => handleDeleteNote({ ...(note as NoteListItem), live: undefined, ...(revision ? { revision } : {}) }) },
      }
      : undefined;
    return {
      statuses: noteQueryStatuses(config?.notebooks || [], note.notebookId, Object.keys(facets?.[note.notebookId]?.statuses || {})),
      metadataFields: config?.notebooks.find(nb => nb.id === note.notebookId)?.metadata,
      onSave: params => handleSaveNote({ ...params, notebookId: note.notebookId }),
      onRestoreFile: path => handleRestoreNoteFile(path, note.notebookId),
      onCommitFile: editableNote ? (path, version) => commitNoteFile(path, note.notebookId, version) : undefined,
      // The same diff the Changes panel shows: a remote note's draft against its base, a local note's worktree against HEAD.
      readDiff: remote ? draft && (async () => workingDiff({ [note.path]: draft })) : () => fetchFileDiff({ path: note.path, repository: repository?.id }, 'current'),
      // A path names a file only within its repository: a remote note is dirty when it holds a draft, a local one when its worktree reports it.
      isDirty: remote ? Boolean(draft) : Boolean(repositoryStatus && [...repositoryStatus.modified, ...repositoryStatus.staged, ...repositoryStatus.untracked].includes(note.path)),
      availableTags,
      assets,
      onUploadAsset: !writable ? undefined : handleUploadAsset,
      onDeleteAsset: !writable ? undefined : handleDeleteAsset,
      onMoveAsset: !writable ? undefined : handleMoveAsset,
      beforeFileChange: !writable ? undefined : beforeFileChange,
      onFilesChanged: !writable ? undefined : onFilesChanged,
      readOnly: !editableNote,
      zoomNavigation: { open: mode => handleOpenNote(note, '', { mode }), returnToFocus, selection: frameSelection },
      autoSave: true,
      draftMode: remote,
      remoteBase: draft?.base || (committed && typeof committed.content === 'string' ? committed : undefined),
      conflictReason: draft?.blocked,
      onMarkConflict: remote
        ? (reason, draft, base) => {
          stageWorkingNote(draft, base, reason);
        }
        : undefined,
      onReadRemote: remote && draft?.base === null ? undefined : (path: string) => readNote(path, note.notebookId),
      // A live note another person moved: its tabs, the address and the lists follow it (§20.4 of the built-in editor spec).
      onMoved: to => followMoved(note, to, routedPath),
      branch: repository?.branch ?? '',
      draftScope: repository ? draftScope(repository) : '',
      template: isTemplate(note),
      // Save as template writes a file of the note's own notebook, so it follows that notebook's write access.
      onSaveAsTemplate: editableNote && !isTemplate(note) ? edited => void templateActions.saveAsTemplate({ notebookId: note.notebookId, ...edited }).catch(error => setActionError((error as Error).message)) : undefined,
      live,
    };
  };
}
