import fs from 'node:fs';
import path from 'node:path';
import { NotebookConfig, NoteMetadata } from './types.js';
import { resolveSafePath } from './path-guard.js';
import { parseNoteContent } from './frontmatter.js';
import { isNotebookContent } from './folders.js';
import { describeNoteTemplate, lastUseOf, type ListedNoteTemplate, notebookTemplateEntries, type NoteTemplateEntry, type NoteTemplateInfo, templateFileId, templateLastUse, TEMPLATES_FOLDER } from './note-template.js';
import { scanNotebookNotes, stampIsRacy } from './note-service.js';

export * from './note-template.js';

export interface LoadedNoteTemplate {
  id: string;
  title: string;
  metadata: NoteMetadata;
  content: string;
  /** The template file's text, frontmatter included. */
  raw: string;
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
  let folder: string;
  try {
    folder = resolveSafePath(repoRoot, path.posix.join(notebook.root, TEMPLATES_FOLDER));
  } catch {
    // A `.templates` link out of the repository holds no templates; the notebook's other templates still list.
    return [];
  }
  // lstat: a symlinked `.templates` folder is no template folder, as the note routes refuse its files.
  if (!fs.lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => `${TEMPLATES_FOLDER}/${entry.name}`).filter(file => templateFileId(file) !== undefined);
}

interface TemplateFile {
  /** The file's text, frontmatter included. */
  raw: string;
  metadata: NoteMetadata;
  content: string;
}

/**
 * Parsed template files of each notebook, reused while a file's size, change times and inode are unchanged, as a notes
 * scan keeps its notes: listing templates reads only the files edited since the last listing. A listing keeps only the
 * files it saw, and never a file changed so recently that its stamp could miss a further write.
 */
const templateCache = new Map<string, Map<string, { stamp: string; file: TemplateFile; }>>();

/** A notebook's template entries, each with its file when there is one to read. */
function readTemplates(repoRoot: string, notebook: NotebookConfig): { entry: NoteTemplateEntry; file?: TemplateFile; }[] {
  const cacheKey = JSON.stringify([path.resolve(repoRoot), notebook.id, notebook.root]);
  const previous = templateCache.get(cacheKey);
  const seen = new Map<string, { stamp: string; file: TemplateFile; }>();
  const read = notebookTemplateEntries(notebook, templateFiles(repoRoot, notebook)).map(entry => {
    try {
      const safePath = resolveSafePath(repoRoot, path.posix.join(notebook.root, entry.file));
      // Stat before reading: a file changed in between carries a newer text than its stamp, so the next listing reads it again.
      const stat = fs.statSync(safePath, { throwIfNoEntry: false });
      if (!stat?.isFile()) return { entry };
      const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
      const cached = previous?.get(entry.file);
      let file = cached?.stamp === stamp ? cached.file : undefined;
      if (!file) {
        const raw = fs.readFileSync(safePath, 'utf-8');
        const { metadata, content } = parseNoteContent(raw, path.basename(entry.file));
        file = { raw, metadata, content };
      }
      if (!stampIsRacy(stat)) seen.set(entry.file, { stamp, file });
      return { entry, file };
    } catch {
      // A registered template whose file cannot be read is still listed, as the manifest names it.
      return { entry };
    }
  });
  templateCache.set(cacheKey, seen);
  return read;
}

/** A notebook's templates, the manifest's first and then its `.templates/` files, each with its placeholders. */
export function listNoteTemplates(repoRoot: string, notebook: NotebookConfig): NoteTemplateInfo[] {
  return readTemplates(repoRoot, notebook).map(({ entry, file }) => describeNoteTemplate(notebook, entry, file));
}

/** A notebook's templates as `list_templates` answers them: each with its last use, read from the notebook's scanned notes. */
export function listedNoteTemplates(repoRoot: string, notebook: NotebookConfig): ListedNoteTemplate[] {
  const used = templateLastUse(scanNotebookNotes(repoRoot, notebook));
  return listNoteTemplates(repoRoot, notebook).map(template => ({ ...template, lastUsed: lastUseOf(used, template.id) }));
}

/** Reads one of a notebook's templates (frontmatter + body) safely from disk: a manifest-registered one, else a `.templates/` file. */
export function loadNoteTemplate(repoRoot: string, notebook: NotebookConfig, templateId: string): LoadedNoteTemplate {
  const found = readTemplates(repoRoot, notebook).find(candidate => candidate.entry.id === templateId);
  if (!found) {
    throw new Error(`Template '${templateId}' is not configured for notebook '${notebook.id}'`);
  }
  const { entry, file } = found;
  if (!file) throw new Error(`Template file not found: ${entry.file}`);
  // A copy the caller may change without altering the cached parse.
  return { id: entry.id, title: describeNoteTemplate(notebook, entry, file).name, metadata: structuredClone(file.metadata), content: file.content, raw: file.raw };
}
