import fs from 'node:fs';
import path from 'node:path';
import { NotebookConfig, NoteMetadata } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { parseNoteContent } from './frontmatter.js';
import { isNotebookContent } from './folders.js';
import { describeNoteTemplate, notebookTemplateEntries, type NoteTemplateEntry, type NoteTemplateInfo, templateFileId, TEMPLATES_FOLDER } from './note-template.js';

export * from './note-template.js';

export interface LoadedNoteTemplate {
  id: string;
  title: string;
  metadata: NoteMetadata;
  content: string;
}

/**
 * Whether a notebook-relative path is a template file the note routes may read and write: one directly in `.templates/`,
 * or a manifest-registered one inside ordinary notebook content. No other dot path is ever a template file.
 */
export function isTemplateFile(relative: string, notebook: NotebookConfig): boolean {
  return templateFileId(relative) !== undefined || Boolean(notebook.templates?.some(template => template.file === relative)) && isNotebookContent(relative, notebook);
}

/** The regular `*.md` files directly in a notebook's `.templates/` folder, relative to the notebook root. */
function templateFiles(repoRoot: string, notebook: NotebookConfig): string[] {
  const folder = resolveSafePath(repoRoot, path.posix.join(notebook.root, TEMPLATES_FOLDER));
  if (!fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `${TEMPLATES_FOLDER}/${entry.name}`).filter(file => templateFileId(file) !== undefined);
}

function readTemplate(repoRoot: string, notebook: NotebookConfig, entry: NoteTemplateEntry) {
  const safePath = resolveSafePath(repoRoot, path.posix.join(notebook.root, entry.file));
  if (!fs.existsSync(safePath)) throw new Error(`Template file not found: ${entry.file}`);
  const { metadata, content } = parseNoteContent(fs.readFileSync(safePath, 'utf-8'), path.basename(entry.file));
  return { metadata, content };
}

/** A notebook's templates, the manifest's first and then its `.templates/` files, each with its placeholders. */
export function listNoteTemplates(repoRoot: string, notebook: NotebookConfig): NoteTemplateInfo[] {
  return notebookTemplateEntries(notebook, templateFiles(repoRoot, notebook)).map(entry => {
    let parsed: { metadata: NoteMetadata; content: string; } | undefined;
    try {
      parsed = readTemplate(repoRoot, notebook, entry);
    } catch { /* A registered template whose file is missing is still listed, as the manifest names it. */ }
    return describeNoteTemplate(notebook, entry, parsed);
  });
}

/** Reads one of a notebook's templates (frontmatter + body) safely from disk: a manifest-registered one, else a `.templates/` file. */
export function loadNoteTemplate(repoRoot: string, notebook: NotebookConfig, templateId: string): LoadedNoteTemplate {
  const entry = notebookTemplateEntries(notebook, templateFiles(repoRoot, notebook)).find(candidate => candidate.id === templateId);
  if (!entry) {
    throw new Error(`Template '${templateId}' is not configured for notebook '${notebook.id}'`);
  }
  const parsed = readTemplate(repoRoot, notebook, entry);
  return { id: entry.id, title: describeNoteTemplate(notebook, entry, parsed).name, ...parsed };
}
