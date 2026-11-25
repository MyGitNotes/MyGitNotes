import type { QueryClient } from '@tanstack/react-query';
import { type NotebookFacets, noteQueryStatuses } from '@mygitnotes/core/note-query';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { deleteNote, fetchGitStatus, saveNote } from '../lib/api.js';
import type { BoardNoteReceipt } from '../lib/compilation-actions.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import { buildNewNoteDraft } from '../lib/new-note.js';
import type { FolderItem, GitStatus, NotebookConfig, NoteItem } from '../lib/types.js';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import { untitledCandidates } from './useCreateNote.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: { notebooks: NotebookConfig[]; } | null;
  folders: FolderItem[];
  foldersLoading: boolean;
  remote: boolean;
  canWriteNotebook: (notebookId: string) => boolean;
  repositoryFor: WorkspaceState['repositoryFor'];
  readDraft: WorkspaceState['readDraft'];
  updateDraft: WorkspaceState['updateDraft'];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null) => NoteItem;
  revisionFor: (notebookId: string) => string | undefined;
  invalidateNotes: () => void;
  setGitStatus: (status: GitStatus) => void;
  /** The notebooks' facets, whose statuses decide a notebook's initial status as the New note action's do. */
  facets: Record<string, NotebookFacets> | undefined;
  t: I18nContextValue['t'];
}

/**
 * The 卡片 tool's note: a blank note made as the New note action makes one (the next free `untitled` name, the
 * notebook's initial status, the heading as its title) in the notebook asked, whichever notebook the page has
 * selected, at its root or in the folder or with the tag a dynamic board draws from. It is not opened; the board
 * gets a receipt whose `rollback` takes the note away again when the board cannot hold it: a hosted workspace drops
 * its own new browser draft (the note was never in Git), a local one deletes the uncommitted file and says when it
 * could not. The receipt comes back once the note is written, whatever the page did meanwhile. `newNotesLive` says
 * where new notes start as pending live notes, which have no Git path a board item could name: the tool is off there.
 */
export function useBoardNoteCreation({ config, folders, foldersLoading, remote, canWriteNotebook, repositoryFor, readDraft, updateDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, facets, t }: Params) {
  const refreshStatus = () => void fetchGitStatus().then(answer => setGitStatus(answer.status)).catch(() => {});
  const newNotesLive = (notebookId: string) => {
    const repository = repositoryFor(notebookId);
    return Boolean(repository?.live && repository.write);
  };
  const createBoardNote = async ({ notebookId, folder = '', tag }: { notebookId: string; folder?: string; tag?: string; }): Promise<BoardNoteReceipt> => {
    const notebook = config?.notebooks.find(candidate => candidate.id === notebookId);
    if (!notebook) throw new Error(t('outline.changed'));
    if (!canWriteNotebook(notebookId)) throw new Error(t('outline.readOnly'));
    if (newNotesLive(notebookId)) throw new Error(t('board.cardLive'));
    const relative = folder.trim().replace(/^\/+|\/+$/g, '');
    if (relative && foldersLoading) throw new Error(t('createNote.foldersLoading'));
    if (relative && !folders.some(item => item.notebookId === notebookId && item.path === relative)) throw new Error(t('createNote.invalidFolder'));
    const directory = [notebook.root.replace(/\/$/, ''), relative].filter(Boolean).join('/');
    const candidates = untitledCandidates(directory, '.md');
    const existing = new Set((await queryClient.fetchQuery(noteLookupOptions(queryScope, candidates.map(path => ({ notebookId, path })), false))).notes.map(note => note.path));
    const path = candidates.find(candidate => !existing.has(candidate) && !(remote && readDraft(notebookId, candidate)));
    if (!path) throw new Error(t('createNote.tooManyUntitled'));
    const slug = path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
    const title = t('createNote.untitled');
    const status = noteQueryStatuses(config?.notebooks ?? [], notebookId, Object.keys(facets?.[notebookId]?.statuses ?? {}))[0];
    const draft = buildNewNoteDraft({ slug, title, tags: tag ? [tag] : [], status, body: t('createNote.body') });
    // A note takes its title from its heading, so editing the heading renames it.
    const { title: _title, ...untitled } = draft.metadata;
    const metadata = withNoteStatus(untitled, draft.status);
    if (remote) {
      const note = stageWorkingNote({ id: slug, path, notebookId, title, content: draft.content, metadata, status: draft.status, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], revision: revisionFor(notebookId) }, null);
      return { note, rollback: async () => updateDraft(notebookId, path, null) };
    }
    const { note } = await saveNote({ path, notebookId, createOnly: true, content: draft.content, metadata, noCommit: true });
    invalidateNotes();
    refreshStatus();
    return {
      note,
      rollback: async () => {
        await deleteNote(path, { noCommit: true, notebookId });
        invalidateNotes();
        refreshStatus();
      },
    };
  };
  return { createBoardNote, newNotesLive };
}
