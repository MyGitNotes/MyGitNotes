import type { QueryClient } from '@tanstack/react-query';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { starterTemplate, templateFilePath, templateFromNote } from '@mygitnotes/core/note-template';
import { fetchGitStatus, saveNote } from '../lib/api.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { NoteTemplateInfo } from '../lib/note-templates.js';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { NoteItem } from '../lib/types.js';
import type { WorkspaceState } from './workspace-state.js';

interface Params {
  config: WorkspaceState['config'];
  remote: boolean;
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  readDraft: WorkspaceState['readDraft'];
  updateDraft: WorkspaceState['updateDraft'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  revisionFor: WorkspaceState['revisionFor'];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  invalidateNotes: () => void;
  setGitStatus: WorkspaceState['setGitStatus'];
  /** Opens a note in zoom; a template file is never opened anywhere else. */
  openInZoom: (note: NoteListItem) => Promise<boolean>;
  /** Deletes a file as a note is deleted: a local file goes to the uncommitted trash, a remote one is committed away. */
  deleteNote: (note: NoteListItem) => Promise<void>;
  /** Puts a file at another path as it is, throwing when it is refused. */
  relocateFile: (note: Pick<NoteItem, 'notebookId' | 'path' | 'title'>, destination: string) => Promise<void>;
  t: I18nContextValue['t'];
}

/**
 * What the Manage templates dialog and a note's Save as template do. A template is a Markdown file in its notebook's
 * `.templates/` folder, so it is created, saved, renamed and deleted the way a note is in that workspace: a working change
 * of this page in a remote workspace, a file of the worktree in a local one. Every action throws the reason it was refused.
 */
export function useTemplateActions({ config, remote, canWriteNotebook, readDraft, updateDraft, stageWorkingNote, revisionFor, queryClient, queryScope, invalidateNotes, setGitStatus, openInZoom, deleteNote, relocateFile, t }: Params) {
  const listed = (template: NoteTemplateInfo): NoteListItem => ({ id: template.file, path: template.file, notebookId: template.notebookId, title: template.name, metadata: {}, tags: [] });
  const writable = (notebookId: string) => {
    const notebook = config?.notebooks.find(candidate => candidate.id === notebookId);
    if (!notebook || !canWriteNotebook(notebookId)) throw new Error(t('outline.readOnly'));
    return notebook;
  };
  /** Whether a file or a working change already holds `path`; a deleted working change frees it. */
  const taken = async (notebookId: string, path: string) => {
    const draft = remote ? readDraft(notebookId, path) : undefined;
    if (draft) return !draft.deleted;
    return (await queryClient.fetchQuery(noteLookupOptions(queryScope, [{ notebookId, path }], false))).notes.length > 0;
  };
  /** Writes a new template file named `name` and opens it in zoom; an existing file of that name is refused. */
  const write = async (notebookId: string, name: string, seed: { metadata: Record<string, unknown>; content: string; }) => {
    const notebook = writable(notebookId);
    const title = name.trim();
    const path = templateFilePath(notebook, title);
    if (await taken(notebookId, path)) throw new Error(t('templates.exists', { name: title }));
    let note: NoteItem;
    if (remote) note = stageWorkingNote({ id: path, path, notebookId, title, content: seed.content, metadata: seed.metadata, tags: [], revision: revisionFor(notebookId) }, null);
    else {
      note = (await saveNote({ path, notebookId, createOnly: true, content: seed.content, metadata: seed.metadata, noCommit: true })).note;
      invalidateNotes();
      void fetchGitStatus().then(status => setGitStatus(status.status), () => {});
    }
    await openInZoom(note);
  };

  const createTemplate = (notebookId: string, name: string) => write(notebookId, name, starterTemplate(name.trim()));
  /** Copies a note into its notebook's `.templates/` folder as a template named after it, and opens the copy. */
  const saveAsTemplate = (note: Pick<NoteItem, 'notebookId' | 'title' | 'metadata' | 'content'>) => write(note.notebookId, note.title, templateFromNote(note));
  const editTemplate = async (template: NoteTemplateInfo) => void await openInZoom(listed(template));
  /** Renames a `.templates/` file, its text untouched; a manifest-registered template keeps the file its manifest names. */
  const renameTemplate = async (template: NoteTemplateInfo, name: string) => {
    const notebook = writable(template.notebookId);
    if (template.source !== 'file') throw new Error(t('templates.manifestHint'));
    const destination = templateFilePath(notebook, name);
    if (destination === template.file) return;
    if (await taken(template.notebookId, destination)) throw new Error(t('templates.exists', { name: name.trim() }));
    await relocateFile({ notebookId: template.notebookId, path: template.file, title: template.name }, destination);
    if (!remote) invalidateNotes();
  };
  const deleteTemplate = async (template: NoteTemplateInfo) => {
    writable(template.notebookId);
    if (template.source !== 'file') throw new Error(t('templates.manifestHint'));
    // A template that exists only as a working change has no file to delete: its change goes.
    const draft = remote ? readDraft(template.notebookId, template.file) : undefined;
    if (draft && !draft.base) updateDraft(template.notebookId, template.file, null);
    else await deleteNote(listed(template));
    if (!remote) invalidateNotes();
  };

  return { createTemplate, saveAsTemplate, editTemplate, renameTemplate, deleteTemplate };
}
