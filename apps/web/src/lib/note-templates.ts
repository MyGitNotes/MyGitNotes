import { noteRefKey } from '@mygitnotes/core/note-query';
import { describeNoteTemplate, type NoteTemplateInfo, templateFileId } from '@mygitnotes/core/note-template';
import type { NotebookConfig } from './types.js';
import type { WorkingNotes } from './working-notes.js';

export type { NoteTemplateInfo };

type TemplateNotebook = Pick<NotebookConfig, 'id' | 'root' | 'templates'>;

/** Whether a repository-relative path is one of the notebook's template files: directly in `.templates/`, or registered in its manifest. */
export function isTemplatePath(notebook: Pick<NotebookConfig, 'root' | 'templates'> | undefined, path: string): boolean {
  if (!notebook || !path.startsWith(`${notebook.root}/`)) return false;
  const relative = path.slice(notebook.root.length + 1);
  return templateFileId(relative) !== undefined || Boolean(notebook.templates?.some(template => template.file === relative));
}

/** Whether a working change is of a `.templates/` file, which is no note: it joins no list, count, agenda or graph of notes. */
const templateDraft = (path: string) => /(^|\/)\.templates\/[^/]+\.md$/.test(path);
const noteDraftsCache = new WeakMap<WorkingNotes, WorkingNotes>();

/** The working changes the note views overlay: every one but those of `.templates/` files. The same object answers the same drafts, so memoized views keep their identity. */
export function noteDrafts(drafts: WorkingNotes): WorkingNotes {
  let listed = noteDraftsCache.get(drafts);
  if (!listed) {
    const entries = Object.entries(drafts);
    const kept = entries.filter(([, entry]) => !templateDraft(entry.note.path));
    listed = kept.length === entries.length ? drafts : Object.fromEntries(kept);
    noteDraftsCache.set(drafts, listed);
  }
  return listed;
}

/**
 * A notebook's templates as this page sees them: the server's list with the page's working changes applied. A remote
 * workspace keeps a new, edited or deleted template as a working change until it is committed, so the server's list
 * alone would miss it.
 */
export function overlayDraftTemplates(templates: NoteTemplateInfo[], notebook: TemplateNotebook, drafts: WorkingNotes): NoteTemplateInfo[] {
  const draftOf = (file: string) => drafts[noteRefKey({ notebookId: notebook.id, path: file })];
  const relative = (file: string) => file.slice(notebook.root.length + 1);
  const listed = templates.filter(template => !draftOf(template.file)?.deleted).map(template => {
    const draft = draftOf(template.file);
    return draft ? describeNoteTemplate(notebook, { id: template.id, source: template.source, file: relative(template.file), ...(template.source === 'manifest' ? { title: template.name } : {}) }, draft.note) : template;
  });
  const taken = new Set(listed.map(template => template.id)), known = new Set(templates.map(template => template.file));
  const created: NoteTemplateInfo[] = [];
  for (const draft of Object.values(drafts)) {
    const file = draft.note.path;
    if (draft.deleted || draft.note.notebookId !== notebook.id || known.has(file) || !file.startsWith(`${notebook.root}/`)) continue;
    const id = templateFileId(relative(file));
    if (id === undefined || taken.has(id)) continue;
    taken.add(id);
    created.push(describeNoteTemplate(notebook, { id, source: 'file', file: relative(file) }, draft.note));
  }
  if (!created.length) return listed;
  // The manifest's templates stay first; the `.templates/` files follow by id, as the server lists them.
  return [...listed.filter(template => template.source === 'manifest'), ...[...listed.filter(template => template.source === 'file'), ...created].sort((a, b) => a.id.localeCompare(b.id))];
}
