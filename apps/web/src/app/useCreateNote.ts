import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OUTLINE_SUFFIX } from '@mygitnotes/core/outline';
import { noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { QueryClient } from '@tanstack/react-query';
import { fetchGitStatus, renderNoteTemplate, saveNote } from '../lib/api.js';
import { buildNewNoteDraft, type LivePathPrompt, livePathPrompts } from '../lib/new-note.js';
import { createLiveNote } from '../lib/live-api.js';
import { serializeNoteFile } from '@mygitnotes/core/note-file';
import { isBuiltinTemplate, renderBuiltinNoteTemplate } from '../lib/builtin-templates.js';
import { localTemplateClock, renderNoteTemplate as fillNoteTemplate } from '@mygitnotes/core/note-template';
import type { NoteTemplateInfo } from '../lib/note-templates.js';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { FolderItem, GitStatus, NotebookConfig, NoteItem } from '../lib/types.js';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface UseCreateNoteParams {
  config: { notebooks: NotebookConfig[]; } | null;
  selectedNotebookId: string;
  setSelectedNotebookId: (id: string) => void;
  folders: FolderItem[];
  /** The folder the Notes page is browsing, relative to the notebook root; a note created without a folder of its own goes there. */
  browsedFolder: string | null;
  /** While the folder list is still arriving, a folder cannot be checked yet. */
  foldersLoading: boolean;
  remote: boolean;
  canWrite: boolean;
  readDraft: WorkspaceState['readDraft'];
  /** The selected notebook's templates, which name the file of a template whose working change is filled in on this page. */
  templates?: NoteTemplateInfo[];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null) => NoteItem;
  revisionFor: WorkspaceState['revisionFor'];
  invalidateNotes: () => void;
  setGitStatus: (status: GitStatus) => void;
  newNoteStatuses: string[];
  sourceId: string;
  t: I18nContextValue['t'];
  /**
   * The selected notebook's repository hands notes to a live editor: a new note is born live (pending) through
   * `/api/live/new` and opens in the editor; `askLivePathValues` asks for the values its template's path needs, or null.
   */
  live?: { askLivePathValues: (template: string, prompts: LivePathPrompt[]) => Promise<Record<string, string> | null>; open: (note: NoteListItem) => void; };
  onCreated: (note: NoteItem) => void;
  onError: (message: string) => void;
}

export interface NewNoteOptions {
  status?: string;
  /** A compilation lane's source folder, so the note joins that lane; otherwise the note starts in the browsed folder, else at the notebook root. */
  folder?: string;
  tag?: string;
  tags?: string[];
  notebookId?: string;
  kind?: 'note' | 'outline';
  templateId?: string;
  initialLink?: Pick<NoteItem, 'notebookId' | 'path' | 'title'>;
}

/** The stem every new note starts from; the editor's Rename gives it a name. */
export const UNTITLED_STEM = 'untitled';
/** How many numbered names are looked up at once before creation gives up. */
const CANDIDATES = 20;

/** `untitled<suffix>`, then `untitled-2<suffix>` … in `directory`. */
export function untitledCandidates(directory: string, suffix: string, count = CANDIDATES): string[] {
  return Array.from({ length: count }, (_, index) => `${directory}/${UNTITLED_STEM}${index ? `-${index + 1}` : ''}${suffix}`);
}

/** Creates a note, outline or templated note at once, with default values, and opens it. */
export function useCreateNote({ config, selectedNotebookId, setSelectedNotebookId, folders, browsedFolder, foldersLoading, remote, canWrite, readDraft, templates, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, newNoteStatuses, sourceId, t, live, onCreated, onError }: UseCreateNoteParams) {
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  useLayoutEffect(() => () => {
    generation.current++;
  }, []);
  const latest = useRef({ sourceId, selectedNotebookId, canWrite, config, queryScope });
  const scopeKey = JSON.stringify([sourceId, selectedNotebookId, canWrite, queryScope.repositories[selectedNotebookId], config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root]);
  const requestScope = useRef(scopeKey);
  useLayoutEffect(() => {
    if (requestScope.current !== scopeKey) generation.current++;
    requestScope.current = scopeKey;
    latest.current = { sourceId, selectedNotebookId, canWrite, config, queryScope };
  }, [scopeKey, sourceId, selectedNotebookId, canWrite, config, queryScope]);

  /** A new note of a live repository: pending in the live editor, filed in Git at its first check-in by its path rule. */
  const createLive = async ({ notebook, folder, title, clock, opts }: { notebook: NotebookConfig; folder: string; title: string; clock: { date: string; time: string; }; opts: NewNoteOptions; }): Promise<NoteListItem | null> => {
    const notebookTemplate = opts.templateId && !isBuiltinTemplate(opts.templateId) ? templates?.find(candidate => candidate.id === opts.templateId) : undefined;
    if (opts.templateId && !isBuiltinTemplate(opts.templateId) && !notebookTemplate) throw new Error(t('outline.changed'));
    let request: Parameters<typeof createLiveNote>[0];
    if (notebookTemplate) {
      const prompts = livePathPrompts(notebookTemplate);
      const values = prompts.length ? await live!.askLivePathValues(notebookTemplate.name, prompts) : {};
      if (!values) return null;
      request = { notebookId: notebook.id, folder, title, templateId: notebookTemplate.id, values, clock };
    } else {
      const template = opts.templateId ? renderBuiltinNoteTemplate(opts.templateId, title, t) : undefined;
      const status = opts.status || (typeof template?.metadata.status === 'string' && template.metadata.status) || newNoteStatuses[0];
      const tags = opts.tags || (opts.tag ? [opts.tag] : Array.isArray(template?.metadata.tags) ? template.metadata.tags.map(String) : []);
      const draft = buildNewNoteDraft({ slug: UNTITLED_STEM, title, tags, status, body: t('createNote.body'), template });
      const { id: _id, ...metadata } = withNoteStatus(draft.metadata, draft.status);
      request = { notebookId: notebook.id, folder, title, content: serializeNoteFile(`${notebook.root}/${UNTITLED_STEM}.md`, metadata, draft.content, true, new Date()), clock };
    }
    const { checkout } = await createLiveNote(request);
    return { id: checkout.id, path: checkout.path, notebookId: notebook.id, title, tags: [], metadata: {}, live: { since: checkout.since, activeEditors: checkout.activeEditors, pending: true, editorUrl: checkout.editorUrl } };
  };

  const pending = useRef<NewNoteOptions | null>(null);
  const createNote = async (options?: string | NewNoteOptions) => {
    const opts: NewNoteOptions = typeof options === 'string' ? { status: options } : { ...options };
    // Creating in another notebook switches to it first; the note is made once that notebook is the selected one.
    if (opts.notebookId && opts.notebookId !== selectedNotebookId) {
      if (!config?.notebooks.some(n => n.id === opts.notebookId)) return onError(t('outline.changed'));
      pending.current = opts;
      setSelectedNotebookId(opts.notebookId);
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setCreating(true);
    const request = ++generation.current;
    const currentRequest = () => request === generation.current && latest.current.sourceId === sourceId && latest.current.selectedNotebookId === selectedNotebookId && latest.current.queryScope.repositories[selectedNotebookId] === queryScope.repositories[selectedNotebookId] && latest.current.config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root === config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root;
    try {
      onError('');
      if (!canWrite) throw new Error('This workspace is read-only.');
      const kind = opts.kind ?? 'note';
      const notebook = config?.notebooks.find(n => n.id === selectedNotebookId);
      if (!notebook) throw new Error(t('outline.changed'));
      const folder = (opts.folder ?? (opts.notebookId ? '' : browsedFolder ?? '')).trim().replace(/^\/+|\/+$/g, '');
      if (folder && foldersLoading) throw new Error(t('createNote.foldersLoading'));
      if (folder && !folders.some(item => item.notebookId === notebook.id && item.path === folder)) throw new Error(t('createNote.invalidFolder'));
      const directory = [notebook.root.replace(/\/$/, ''), folder].filter(Boolean).join('/');
      const candidates = untitledCandidates(directory, kind === 'outline' ? OUTLINE_SUFFIX : '.md');
      const existing = new Set((await queryClient.fetchQuery(noteLookupOptions(queryScope, candidates.map(path => ({ notebookId: notebook.id, path })), false))).notes.map(note => note.path));
      const notePath = candidates.find(path => !existing.has(path) && !(remote && readDraft(notebook.id, path)));
      if (!notePath) throw new Error(t('createNote.tooManyUntitled'));
      const slug = notePath.slice(notePath.lastIndexOf('/') + 1).replace(kind === 'outline' ? OUTLINE_SUFFIX : '.md', '');
      const title = t('createNote.untitled');
      // A built-in template is filled in here; a notebook's own is read from its file by the workspace, with this reader's
      // date and time. Only the title, date and time are filled: every other placeholder stays as written, a declared default
      // included, for the writer to replace.
      const clock = localTemplateClock();
      if (live && kind === 'note') {
        const created = await createLive({ notebook, folder, title, clock, opts });
        if (created && currentRequest()) {
          invalidateNotes();
          // Zoom reads the new note's live text and frames its editor at once.
          live.open(created);
        }
        return;
      }
      // A template that is still a working change of this page has no file the workspace could read, so it is filled in here.
      const templateFile = remote && opts.templateId ? templates?.find(candidate => candidate.id === opts.templateId)?.file : undefined;
      const templateDraft = templateFile ? readDraft(notebook.id, templateFile) : undefined;
      const filled = kind !== 'note' || !opts.templateId ? undefined : isBuiltinTemplate(opts.templateId) ? renderBuiltinNoteTemplate(opts.templateId, title, t) : templateDraft && !templateDraft.deleted ? fillNoteTemplate(templateDraft.note, { title, ...clock, defaults: false }) : await renderNoteTemplate({ notebookId: notebook.id, templateId: opts.templateId, title, ...clock });
      // A note made from a notebook's template records its id as `template`, which dates the template's last use; a built-in
      // template is the app's own text and leaves no id.
      const template = filled && opts.templateId && !isBuiltinTemplate(opts.templateId) ? { ...filled, metadata: { ...filled.metadata, template: opts.templateId } } : filled;
      // The template's own status and tags are the note's unless the caller chose them.
      const templateTags = Array.isArray(template?.metadata.tags) ? template.metadata.tags.map(String) : [];
      const status = opts.status || (typeof template?.metadata.status === 'string' && template.metadata.status) || newNoteStatuses[0];
      const tags = opts.tags || (opts.tag ? [opts.tag] : templateTags);
      const draft = buildNewNoteDraft({ slug, title, tags, status, body: t('createNote.body'), template });
      if (opts.initialLink && opts.initialLink.notebookId !== notebook.id) throw new Error(t('outline.changed'));
      const content = kind === 'outline' ? `- ${opts.initialLink ? noteMarkdownLink(notePath, opts.initialLink.path, opts.initialLink.title) : ''}` : draft.content;
      // A note takes its title from its heading, so editing the heading renames it; an outline has no heading to read.
      const { title: _title, ...untitled } = draft.metadata;
      const metadata = withNoteStatus(kind === 'outline' || template ? draft.metadata : untitled, draft.status);

      if (!currentRequest()) return;
      if (!latest.current.canWrite) throw new Error(t('outline.readOnly'));
      const res = remote ? { note: stageWorkingNote({ ...(kind === 'outline' ? { kind: 'outline' as const } : {}), id: slug, path: notePath, notebookId: notebook.id, title, content, metadata, status: draft.status, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], revision: revisionFor(notebook.id) }, null) } : await saveNote({ path: notePath, notebookId: notebook.id, createOnly: true, content, metadata, noCommit: true });
      if (!remote) invalidateNotes();
      if (!currentRequest()) return;
      onCreated(res.note);
      // Creation has already succeeded; a status refresh failure must not invite a duplicate retry.
      void fetchGitStatus().then(statusRes => {
        if (currentRequest()) setGitStatus(statusRes.status);
      }).catch(() => {});
    } catch (error) {
      if (currentRequest()) onError((error as Error).message);
    } finally {
      submitting.current = false;
      setCreating(false);
    }
  };

  useEffect(() => {
    if (pending.current?.notebookId !== selectedNotebookId) return;
    const opts = pending.current;
    pending.current = null;
    void createNote(opts);
  });

  return { creating, createNote };
}
