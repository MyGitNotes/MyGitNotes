import { splitAgentSkillContent } from '@mygitnotes/core/agent-skill-metadata';
import { noteRefKey } from '@mygitnotes/core/note-query';
import { isNoteFile } from '@mygitnotes/core/note-file';
import { useCallback } from 'react';
import YAML from 'yaml';
import { fetchAgentResources, readAgentResource } from '../lib/api.js';
import { getLocalDraft } from '../lib/storage.js';
import { noteExternalEdit } from '../lib/external-note-edits.js';
import { workingDiff, type WorkingNote } from '../lib/working-notes.js';
import { draftScope } from '../lib/workspace-repositories.js';
import { isNotebookKey } from '../lib/notebook-keys.js';
import type { NoteItem } from '../lib/types.js';
import type { WebToolHandler } from '../lib/pi-agent/session.js';
import type { WorkspaceState } from './workspace-state.js';
import type { useWorkspaceNotes } from './useWorkspaceNotes.js';

interface Params {
  config: WorkspaceState['config'];
  activeWorkingNotes: WorkspaceState['activeWorkingNotes'];
  repositoryFor: WorkspaceState['repositoryFor'];
  canWriteNotebook: WorkspaceState['canWriteNotebook'];
  revisionFor: WorkspaceState['revisionFor'];
  readDraft: WorkspaceState['readDraft'];
  updateDraft: WorkspaceState['updateDraft'];
  stageWorkingNote: WorkspaceState['stageWorkingNote'];
  findCommittedNote: ReturnType<typeof useWorkspaceNotes>['findCommittedNote'];
  resolveBareNotebook: WorkspaceState['resolveBareNotebook'];
}

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
};

/** A path Pi may ask the agent-system tools about: repository-relative, with no traversal; a trailing slash is dropped. */
const repositoryPath = (value: unknown) => {
  const path = text(value, 'path').replace(/\/$/, '');
  if (!path || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Use a repository-relative path with no traversal segments.');
  return path;
};

/** The agent workspace the bridge started this session in, which it names in every agent-system call; absent when it did not. */
const sessionWorkspace = (value: unknown): { repository: string; folder: string; } | undefined => {
  const workspace = value as { repository?: unknown; folder?: unknown; } | null | undefined;
  return workspace && typeof workspace.repository === 'string' && workspace.repository && typeof workspace.folder === 'string' ? { repository: workspace.repository, folder: workspace.folder } : undefined;
};

/** A target directory and each ancestor up to the repository root, root first. */
const chain = (directory: string) => {
  const parts = directory ? directory.split('/') : [];
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))];
};

/** The `description` of a SKILL.md's frontmatter; empty when it has none or cannot be read. */
function skillDescription(content: string): string {
  try {
    const { frontmatter } = splitAgentSkillContent(content);
    const metadata = frontmatter ? YAML.parse(frontmatter.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n?$/, '')) as { description?: unknown; } | null : null;
    return typeof metadata?.description === 'string' ? metadata.description : '';
  } catch {
    return '';
  }
}

const AGENT_FILE = /(?:^|\/)AGENTS\.md$|(?:^|\/)\.agents\/skills\//;

/**
 * The agent's note tools for a remote workspace: reads see the person's working changes, and writes become
 * working changes of this page, which the person commits. Nothing here commits or reaches the repository host.
 */
export function useWebAgentTools({ config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote, resolveBareNotebook }: Params): WebToolHandler {
  return useCallback<WebToolHandler>(async (tool, args) => {
    // A bare local id, as tool calls written before notebook keys name one, resolves as an MCP tool argument does.
    const named = typeof args.notebookId === 'string' ? isNotebookKey(args.notebookId) ? args.notebookId : resolveBareNotebook(args.notebookId) ?? args.notebookId : undefined;
    /** The notebook a repository-relative path belongs to; `notebookId` tells repositories with the same path apart. */
    const locate = () => {
      const path = text(args.path, 'path');
      if (!isNoteFile(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`${path} is not a note path.`);
      const candidates = (config?.notebooks ?? []).filter(notebook => (!named || notebook.id === named) && path.startsWith(`${notebook.root}/`));
      if (!candidates.length) throw new Error(`${path} is not inside ${named ? `notebook ${named}` : 'any notebook'}.`);
      if (candidates.length > 1) throw new Error(`${path} is in several notebooks (${candidates.map(notebook => notebook.id).join(', ')}); name one as notebookId.`);
      return { path, notebookId: candidates[0].id };
    };
    /** Refuses a note whose editor holds typing that is not a working change yet, so the agent never overwrites it. */
    const assertNotEditing = (notebookId: string, path: string, draft: WorkingNote | undefined) => {
      const repository = repositoryFor(notebookId);
      const typing = repository && getLocalDraft(draftScope(repository), path);
      if (typing && !(draft && typing.content === draft.note.content)) throw new Error(`The person is editing ${path}; ask them to finish first.`);
    };
    const assertWritable = (notebookId: string) => {
      if (!canWriteNotebook(notebookId)) throw new Error('This notebook is read-only for the person.');
    };
    /** The note as the person sees it: their working change, else the committed note; null when neither exists. */
    const current = async (notebookId: string, path: string) => {
      const draft = readDraft(notebookId, path);
      if (draft?.deleted) throw new Error(`${path} is deleted in the person's working changes; it waits in their trash.`);
      if (draft) return { draft, note: draft.note, base: draft.base };
      const committed = await findCommittedNote({ notebookId, path });
      return { draft: undefined, note: committed, base: committed };
    };
    const describe = (note: NoteItem, source: 'working' | 'committed') => ({ path: note.path, notebookId: note.notebookId, source, metadata: note.metadata, content: note.content });
    /** Stages `content` and `metadata` for the note, created when it does not exist, and shows it in an open editor. */
    const stage = async (notebookId: string, path: string, content: string, metadata: Record<string, unknown> | undefined) => {
      assertWritable(notebookId);
      const draft = readDraft(notebookId, path);
      assertNotEditing(notebookId, path, draft);
      // A deleted note written again is a change of the committed note it deleted.
      const base = draft ? draft.base : await findCommittedNote({ notebookId, path });
      const original = draft && !draft.deleted ? draft.note : base;
      const merged = { ...original?.metadata, ...metadata };
      const note: NoteItem = original ? { ...original, content, metadata: merged, revision: base?.revision || original.revision } : { id: path, path, notebookId, title: path.split('/').pop() || path, content, metadata: merged, tags: [], revision: revisionFor(notebookId) };
      stageWorkingNote(note, base);
      noteExternalEdit(noteRefKey({ notebookId, path }));
      return { path, notebookId, source: 'working' as const, created: !base };
    };

    /** The repository of the notebook the call names, else of the agent workspace the session runs in. */
    const agentRepository = () => {
      if (named) {
        const repository = repositoryFor(named);
        if (!repository) throw new Error(`Unknown notebook: ${named}`);
        return repository.id;
      }
      const workspace = sessionWorkspace(args.workspace);
      if (!workspace) throw new Error('Name a notebookId: this session did not report its agent workspace.');
      return workspace.repository;
    };
    /** Where an agent-system call looks: a note or folder path, a notebook's root, or the session's own workspace. */
    const agentTarget = () => {
      const notebooks = config?.notebooks ?? [];
      if (args.path !== undefined) {
        const path = repositoryPath(args.path);
        // The agent-resource listing has only agent files, so a path with an extension is taken for a note and a folder otherwise.
        const directory = isNoteFile(path) || /\.[^./]+$/.test(path.split('/').pop() ?? '') ? path.split('/').slice(0, -1).join('/') : path;
        const candidates = notebooks.filter(notebook => (!named || notebook.id === named) && (directory === notebook.root || directory.startsWith(`${notebook.root}/`)));
        if (!candidates.length) throw new Error(`${path} is not inside ${named ? `notebook ${named}` : 'any notebook'}; target a notebook, or a note or folder inside one.`);
        if (candidates.length > 1) throw new Error(`${path} is in several notebooks (${candidates.map(notebook => notebook.id).join(', ')}); name one as notebookId.`);
        const repository = repositoryFor(candidates[0].id);
        if (!repository) throw new Error(`Unknown notebook: ${candidates[0].id}`);
        return { repository: repository.id, directory, notebookId: candidates[0].id };
      }
      if (named) {
        const notebook = notebooks.find(candidate => candidate.id === named);
        if (!notebook) throw new Error(`Unknown notebook: ${named}`);
        return { repository: agentRepository(), directory: notebook.root, notebookId: notebook.id };
      }
      const workspace = sessionWorkspace(args.workspace);
      if (!workspace) throw new Error('Pass a path or notebookId: this session did not report its agent workspace.');
      return { repository: workspace.repository, directory: workspace.folder, notebookId: undefined };
    };

    switch (tool) {
      case 'agent_system': {
        const { repository, directory, notebookId } = agentTarget();
        const listing = await fetchAgentResources(repository);
        const folders = chain(directory);
        const instructions = folders.flatMap(folder => listing.files.filter(file => file.kind === 'instructions' && file.folder === folder));
        // Along the chain the nearest folder wins a shared skill name, as Pi loads them.
        const chosen = new Map<string, (typeof listing.files)[number]>();
        for (const folder of [...folders].reverse()) for (const file of listing.files) if (file.kind === 'skill' && file.folder === folder && file.skill && !chosen.has(file.skill)) chosen.set(file.skill, file);
        const [files, skills] = await Promise.all([
          Promise.all(instructions.map(async file => ({ path: file.path, content: (await readAgentResource(file.path, repository)).content }))),
          Promise.all([...chosen.values()].sort((a, b) => a.skill!.localeCompare(b.skill!)).map(async file => ({ name: file.skill!, description: skillDescription((await readAgentResource(file.path, repository)).content), path: file.path, directory: file.path.slice(0, -'/SKILL.md'.length) }))),
        ]);
        return { workspace: { repository, folder: directory }, ...notebookId ? { notebookId } : {}, ...listing.revision ? { revision: listing.revision } : {}, files, skills };
      }
      case 'read_agent_file': {
        const path = repositoryPath(args.path);
        if (!AGENT_FILE.test(path)) throw new Error(`${path} is not an AGENTS.md or skill file of the agent workspace.`);
        const repository = agentRepository();
        const resource = await readAgentResource(path, repository).catch(() => {
          throw new Error(`${path} is not an AGENTS.md or skill file of this workspace, or it does not exist.`);
        });
        return { path, workspace: { repository }, content: resource.content, ...resource.revision ? { revision: resource.revision } : {} };
      }
      case 'read_note': {
        const { path, notebookId } = locate();
        const { draft, note } = await current(notebookId, path);
        if (!note) throw new Error(`No note at ${path}.`);
        return describe(note, draft ? 'working' : 'committed');
      }
      case 'write_note': {
        const { path, notebookId } = locate();
        const metadata = args.metadata === undefined ? undefined : args.metadata;
        if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) throw new Error('metadata must be an object.');
        return stage(notebookId, path, text(args.content, 'content'), metadata as Record<string, unknown> | undefined);
      }
      case 'edit_note': {
        const { path, notebookId } = locate();
        const oldText = text(args.oldText, 'oldText'), newText = text(args.newText, 'newText');
        const { note } = await current(notebookId, path);
        if (!note) throw new Error(`No note at ${path}.`);
        const found = oldText ? note.content.split(oldText).length - 1 : 0;
        if (found !== 1) throw new Error(found ? `oldText occurs ${found} times in ${path}; include more context so it occurs once.` : `oldText does not occur in ${path}.`);
        return stage(notebookId, path, note.content.replace(oldText, () => newText), undefined);
      }
      case 'delete_note': {
        const { path, notebookId } = locate();
        assertWritable(notebookId);
        const draft = readDraft(notebookId, path);
        assertNotEditing(notebookId, path, draft);
        if (draft?.deleted) throw new Error(`${path} is already deleted; it waits in the person's trash.`);
        // A note that exists only as a working change has nothing to keep: its change goes.
        if (draft && !draft.base) {
          updateDraft(notebookId, path, null);
          return { path, notebookId, deleted: true, trashed: false };
        }
        const base = draft?.base ?? await findCommittedNote({ notebookId, path });
        if (!base) throw new Error(`No note at ${path}.`);
        stageWorkingNote(base, base, undefined, true);
        return { path, notebookId, deleted: true, trashed: true };
      }
      case 'list_changes':
        return { changes: Object.values(activeWorkingNotes).map(entry => ({ path: entry.note.path, notebookId: entry.note.notebookId, kind: entry.deleted ? 'deleted' : entry.base ? 'modified' : 'added', ...(entry.blocked ? { blocked: entry.blocked } : {}), diff: workingDiff({ [entry.note.path]: entry }) })) };
      default:
        throw new Error(`Unknown note tool ${tool}.`);
    }
  }, [config, activeWorkingNotes, repositoryFor, canWriteNotebook, revisionFor, readDraft, updateDraft, stageWorkingNote, findCommittedNote, resolveBareNotebook]);
}
