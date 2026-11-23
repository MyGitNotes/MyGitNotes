import path from 'node:path';
import fs from 'node:fs';
import { agentEditMessage, DEFAULT_NOTE_STATUSES, deleteNoteFile, isNotebookContent, keptNoteMetadata, listedNoteTemplates, listTemplates, loadNoteTemplate, loadWorkspaceConfig, type NotebookConfig, noteFromTemplate, NoteItem, noteStatusNames, noteSummary, readNoteFile, resolveNoteStatuses, resolveSafePath, scanNotebookNotes, versionFilePath, withEditDate, withNoteEdits, type WorkspaceConfig, writeNoteFile } from '@mygitnotes/core';
import { generateCommitMessage, noteEditFacts, stageAndCommit } from '@mygitnotes/git';
import { isNoteFile } from '@mygitnotes/core/note-file';
import { assertNoteResource, assertUserWorkspaceBranch } from '../guards.js';
import type { ToolContext } from './context.js';

/** The absolute path of a note a tool may read or change, judged against the manifest of its repository. */
const noteResource = (ctx: ToolContext, file: string) => assertNoteResource(ctx.repoRoot, file, ctx.config ?? loadWorkspaceConfig(ctx.repoRoot));

/** The note with its edit dates from the worktree's Git history (`noteEditFacts`), the frontmatter standing in where Git has none. */
async function dated<T extends NoteItem>(ctx: ToolContext, notes: T[]) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  const facts = await noteEditFacts(ctx.repoRoot, config?.notebooks.map(nb => nb.root) ?? []);
  return notes.map(note => withEditDate(note, facts.get(note.path)));
}

export async function handleGetWorkspaceConfig(ctx: ToolContext) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'No .mygitnotes.yaml (or legacy .github-notes.yaml) configuration file found in workspace.' };
  }
  return { config };
}

export async function handleListNotebooks(ctx: ToolContext) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }
  return { notebooks: config.notebooks };
}

export async function handleListNotes(ctx: ToolContext, args: { notebookId?: string; offset?: number; limit?: number; }) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) {
    return { error: 'Workspace not initialized.' };
  }

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;
  const offset = args.offset === undefined ? 0 : Number(args.offset);
  const limit = args.limit === undefined ? 100 : Number(args.limit);

  const all: NoteItem[] = [];
  for (const nb of notebooks) {
    all.push(...scanNotebookNotes(ctx.repoRoot, nb).sort((a, b) => a.path.localeCompare(b.path)));
  }

  const notes = (await dated(ctx, all.slice(offset, offset + limit))).map(noteSummary);
  const next = offset + notes.length;
  return { count: notes.length, total: all.length, nextOffset: next < all.length ? next : null, notes };
}

export async function handleReadNote(ctx: ToolContext, args: { path: string; notebookId?: string; metadataOnly?: boolean; }) {
  noteResource(ctx, args.path);
  if (args.metadataOnly) {
    return handleGetNoteMetadata(ctx, { path: args.path });
  }
  const notebookId = args.notebookId || 'default';
  const [note] = await dated(ctx, [readNoteFile(ctx.repoRoot, args.path, notebookId)]);
  return { note };
}

/**
 * The templates of one notebook, or of every notebook of the worktree: the manifest's and the `.templates/` files, with
 * their placeholders and last use, narrowed by `query` and cut at `limit`. With `templateId`, the one template of the named
 * notebook with its file text.
 */
export async function handleListTemplates(ctx: ToolContext, args: { notebookId?: string; query?: unknown; templateId?: unknown; limit?: unknown; } = {}) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not initialized.' };
  if (args.notebookId && !config.notebooks.some((nb) => nb.id === args.notebookId)) throw new Error(`Notebook '${args.notebookId}' is not configured.`);
  if (args.templateId !== undefined) {
    const notebook = config.notebooks.find((nb) => nb.id === args.notebookId);
    if (!notebook) throw new Error("templateId needs notebookId: a template id is its notebook's.");
    const templates = listedNoteTemplates(ctx.repoRoot, notebook);
    const template = templates.find((candidate) => candidate.id === String(args.templateId));
    if (!template) throw new Error(`Notebook '${notebook.id}' has no template '${String(args.templateId)}'. Its templates: ${templates.map((candidate) => candidate.id).join(', ') || 'none'}.`);
    return { templates: [{ ...template, content: loadNoteTemplate(ctx.repoRoot, notebook, template.id).raw }], total: 1, truncated: false };
  }
  return listTemplates(config.notebooks.filter((nb) => !args.notebookId || nb.id === args.notebookId).flatMap((nb) => listedNoteTemplates(ctx.repoRoot, nb)), args);
}

type SaveNoteArgs = { path?: string; notebookId?: string; template?: string; values?: unknown; content?: string; metadata?: Record<string, unknown>; status?: string; tags?: string[]; title?: string; commitMessage?: string; };

/** Creates a note from a template of its notebook, filled by name; an existing note at the path is refused. */
async function saveNoteFromTemplate(ctx: ToolContext, args: SaveNoteArgs & { template: string; }) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not initialized.' };
  // The notebook is the named one; a path alone names the notebook that holds it.
  const notebook = args.notebookId ? config.notebooks.find((nb) => nb.id === args.notebookId) : config.notebooks.find((nb) => args.path?.replace(/\\/g, '/').startsWith(`${nb.root}/`));
  if (!notebook) throw new Error(args.notebookId ? `Notebook '${args.notebookId}' is not configured.` : 'Name the notebook of the template as notebookId, or a path inside it.');
  const template = loadNoteTemplate(ctx.repoRoot, notebook, args.template);
  const made = noteFromTemplate(notebook, template, { templateId: template.id, path: args.path, title: args.title, values: args.values, content: args.content, metadata: args.metadata });
  const target = noteResource(ctx, made.path);
  if (!made.path.startsWith(`${notebook.root}/`) || !isNotebookContent(made.path.slice(notebook.root.length + 1), notebook) || !isNoteFile(made.path)) throw new Error(`${made.path} is not a note path of notebook '${notebook.id}'.`);
  if (fs.existsSync(target)) throw new Error(`A note already exists at ${made.path}.`);
  const saved = writeNoteFile(ctx.repoRoot, made.path, made.content, withNoteEdits(made.metadata, { status: args.status, tags: args.tags }), notebook.id, config.notebooks.map((nb) => nb.root));
  const message = agentEditMessage(args.commitMessage || await generateCommitMessage({ filePath: made.path, diff: made.content }));
  const commitResult = await stageAndCommit(ctx.repoRoot, [made.path], message);
  return { success: true, path: made.path, note: saved, template: template.id, unfilled: made.unfilled, commit: commitResult };
}

export async function handleSaveNote(ctx: ToolContext, input: SaveNoteArgs) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  if (input.template !== undefined) return saveNoteFromTemplate(ctx, { ...input, template: String(input.template) });
  if (input.values !== undefined) throw new Error('values fill a template: name one as template.');
  if (typeof input.path !== 'string' || !input.path) throw new Error('path is required.');
  const args = { ...input, path: input.path };
  noteResource(ctx, args.path);

  if (args.content === undefined) {
    return handleUpdateNoteMetadata(ctx, args);
  }

  // A save that leaves metadata out keeps the note's frontmatter; given keys replace their values.
  const target = resolveSafePath(ctx.repoRoot, args.path);
  const kept = keptNoteMetadata(args.path, fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : undefined, args.metadata);
  const edited = args.status !== undefined || args.tags !== undefined || args.title !== undefined;
  const finalMetadata = edited ? withNoteEdits(kept ?? {}, args) : kept;

  const saved = writeNoteFile(ctx.repoRoot, args.path, args.content, finalMetadata);

  // An agent's edit of one note is marked as such, whatever message it supplied.
  const message = agentEditMessage(args.commitMessage || await generateCommitMessage({ filePath: args.path, diff: args.content }));

  const commitResult = await stageAndCommit(ctx.repoRoot, [args.path], message);

  return { success: true, path: args.path, note: saved, commit: commitResult };
}

export async function handleDeleteNote(ctx: ToolContext, args: { path: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  noteResource(ctx, args.path);

  deleteNoteFile(ctx.repoRoot, args.path);
  // The note's versions go with it in the same commit.
  const versionFile = versionFilePath(args.path);
  const versionTarget = resolveSafePath(ctx.repoRoot, versionFile);
  const withVersions = fs.existsSync(versionTarget) && fs.lstatSync(versionTarget).isFile();
  if (withVersions) fs.unlinkSync(versionTarget);

  const message = args.commitMessage || `docs(notes): delete ${path.basename(args.path)}`;
  const commitResult = await stageAndCommit(ctx.repoRoot, withVersions ? [args.path, versionFile] : [args.path], message);

  return { success: true, path: args.path, commit: commitResult };
}

export async function handleGetStatuses(ctx: ToolContext, args: { notebookId?: string; } = {}) {
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const notebooks = args.notebookId ? config.notebooks.filter((nb) => nb.id === args.notebookId) : config.notebooks;

  const result = notebooks.map((nb) => {
    const notes = scanNotebookNotes(ctx.repoRoot, nb);
    const observed = notes.map((n) => n.status);
    const allStatuses = resolveNoteStatuses(nb, observed);
    return { notebookId: nb.id, configuredStatuses: nb.statuses?.length ? noteStatusNames(nb.statuses) : [...DEFAULT_NOTE_STATUSES], observedStatuses: [...new Set(observed.filter(Boolean) as string[])], allStatuses };
  });

  return { defaultStatuses: [...DEFAULT_NOTE_STATUSES], notebooks: result };
}

/** The notebook owning an existing note, or the not-found tool error. */
function locateNote(ctx: ToolContext, config: WorkspaceConfig, file: string) {
  if (!fs.existsSync(resolveSafePath(ctx.repoRoot, file))) return { error: `Note not found: ${file}` };
  const normalized = file.replace(/\\/g, '/');
  const nb = config.notebooks.find((n) => normalized.startsWith(`${n.root}/`));
  return { nb, notebookId: nb ? nb.id : 'default' };
}

/** Statuses offered for notes of `nb`: its configured ones followed by values observed in its notes. */
function availableStatuses(ctx: ToolContext, nb?: NotebookConfig) {
  return resolveNoteStatuses(nb, nb ? scanNotebookNotes(ctx.repoRoot, nb).map((n) => n.status) : []);
}

export async function handleGetNoteMetadata(ctx: ToolContext, args: { path: string; }) {
  noteResource(ctx, args.path);
  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const located = locateNote(ctx, config, args.path);
  if ('error' in located) return located;
  const { nb, notebookId } = located;
  const [note] = await dated(ctx, [readNoteFile(ctx.repoRoot, args.path, notebookId)]);

  return { path: note.path, notebookId, title: note.title, status: note.status, tags: note.tags, metadata: note.metadata, ...(note.lastCommitAt ? { lastCommitAt: note.lastCommitAt } : {}), ...(note.updated ? { updated: note.updated } : {}), availableStatuses: availableStatuses(ctx, nb) };
}

export async function handleUpdateNoteMetadata(ctx: ToolContext, args: { path: string; metadata?: Record<string, unknown>; status?: string; tags?: string[]; title?: string; commitMessage?: string; }) {
  await assertUserWorkspaceBranch(ctx.repoRoot);
  noteResource(ctx, args.path);

  const config = ctx.config ?? loadWorkspaceConfig(ctx.repoRoot);
  if (!config) return { error: 'Workspace not configured' };

  const located = locateNote(ctx, config, args.path);
  if ('error' in located) return located;
  const { nb, notebookId } = located;

  const existingNote = readNoteFile(ctx.repoRoot, args.path, notebookId);
  const updatedMetadata = withNoteEdits({ ...existingNote.metadata, ...args.metadata }, args);
  const updatedNote = writeNoteFile(ctx.repoRoot, args.path, existingNote.content, updatedMetadata, notebookId);

  let message = args.commitMessage;
  if (!message) {
    if (args.status !== undefined && args.status !== existingNote.status) {
      message = `chore(metadata): set status to ${args.status} for ${path.basename(args.path)}`;
    } else {
      message = `chore(metadata): update metadata for ${path.basename(args.path)}`;
    }
  }

  const commit = await stageAndCommit(ctx.repoRoot, [args.path], agentEditMessage(message));

  return { success: true, path: args.path, note: updatedNote, availableStatuses: availableStatuses(ctx, nb), commit };
}
