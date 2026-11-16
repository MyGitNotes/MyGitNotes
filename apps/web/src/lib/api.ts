import type { NewVersionRequest } from './history-api.js';
import type { AgentFile, AgentWorkspace } from './agent-workspaces.js';
import { AssetItem, FolderItem, GitCommit, GitStatus, NoteItem } from './types.js';
import type { RepositoryId } from '@mygitnotes/core/repository';
import type { WorkspaceAnswer } from './workspace-repositories.js';
import { demoScopeOfNotebook, hasDemoScopes } from './demo-storage.js';
import { localCommittedEntry } from './local-commits.js';
import type { ListedNoteTemplate } from '@mygitnotes/core/note-template';
import { translateNow } from './i18n/context.js';

const API_BASE = '/api';
/** The outcome of pushing one committed note to the Gist its `gist` frontmatter names. */
/** What an edition's publishing service reports for one committed note (see the local server's `PublishSync`). */
export interface PublishSync {
  path: string;
  url?: string;
  error?: string;
  notices?: string[];
}

export interface GistSync {
  path: string;
  gist: string;
  error?: string;
  reauthorize?: boolean;
}

/** A note and the Gist the person agreed to publish it to. */
export interface GistConfirmation {
  path: string;
  gist: string;
}

/**
 * Commits drafts of one repository as one commit on it; `gists` reports the published notes it pushed to their Gists,
 * `gistsNeedConfirm` the ones it pushed nothing for until the person confirms them, and `published` what an edition's
 * publishing service did with them. `confirmedGists` names the Gists the person already confirmed, by note.
 */
export async function commitRemoteNotes(repository: RepositoryId, notes: ({ path: string; content: string; metadata: Record<string, unknown>; createOnly?: boolean; } | { path: string; delete: true; })[], revision: string, message: string, documents: { path: string; page: unknown; base: unknown; }[] = [], version?: NewVersionRequest, confirmedGists: GistConfirmation[] = []): Promise<{ revision: string; commit: { commitHash: string; }; gists?: GistSync[]; gistsNeedConfirm?: GistConfirmation[]; published?: PublishSync[]; }> {
  const res = await fetch(`${API_BASE}/notes/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, notes, revision, message, documents, version, ...(confirmedGists.length ? { confirmedGists } : {}) }) });
  if (!res.ok) throw await responseError(res, 'Failed to commit notes');
  return res.json();
}

/** Pushes the notes the person confirmed after the commit `revision` to their Gists, each as that commit holds it. */
export async function syncConfirmedGists(repository: RepositoryId, revision: string, notes: GistConfirmation[]): Promise<GistSync[]> {
  const res = await fetch(`${API_BASE}/gists/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, revision, notes }) });
  if (!res.ok) throw await responseError(res, 'Failed to update the Gists');
  return ((await res.json()) as { gists: GistSync[]; }).gists;
}
/** What else an error answer said: its `code` (`checked-out`, `too-large`, `not-live`), the paths it names, and where a filed live note went. */
export interface ApiErrorDetails {
  code?: string;
  paths?: string[];
  movedTo?: string;
}

/**
 * Whether `error` is a fetch that reached no server: the browser rejects it with a TypeError in its own words (Chrome
 * "Failed to fetch", Firefox "NetworkError when attempting to fetch resource.", Safari "Load failed"). Any other
 * TypeError is a bug, not the network.
 */
export const isNetworkFailure = (error: unknown): boolean => error instanceof TypeError && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message);

export class ApiError extends Error {
  readonly code?: string;
  readonly paths?: string[];
  readonly movedTo?: string;
  /** `staleRepositories` names the repositories whose revision a 409 rejected; `reauthorize` means signing in again grants what the request lacked. */
  constructor(message: string, public status: number, public retryAfter?: number, public staleRepositories?: RepositoryId[], public reauthorize = false, details: ApiErrorDetails = {}) {
    super(message);
    this.code = details.code;
    this.paths = details.paths;
    this.movedTo = details.movedTo;
  }
}

const textList = (value: unknown): string[] | undefined => Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;

export async function responseError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  const seconds = Number(res.headers.get('Retry-After') || data.retryAfter);
  const details: ApiErrorDetails = { ...(typeof data.code === 'string' ? { code: data.code } : {}), ...(textList(data.paths) ? { paths: textList(data.paths) } : {}), ...(typeof data.movedTo === 'string' ? { movedTo: data.movedTo } : {}) };
  // A write refused because a note is being edited live (編輯中) reads the same wherever it is shown.
  const message = details.code === 'checked-out' ? translateNow(details.paths?.length ? 'live.checkedOutPaths' : 'live.checkedOut', { paths: details.paths?.join(', ') ?? '' }) : data.error || fallback;
  return new ApiError(message, res.status, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined, Array.isArray(data.staleRepositories) ? data.staleRepositories : undefined, data.reauthorize === true, details);
}

/** Publishes a note body as a secret Gist of the signed-in GitHub account, which the server binds to the note at `path` of `repository`. */
export async function publishGist(repository: RepositoryId, note: { path: string; content: string; metadata: Record<string, unknown>; }): Promise<{ id: string; url: string; }> {
  const res = await fetch(`${API_BASE}/gists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, ...note }) });
  if (!res.ok) throw await responseError(res, 'Failed to publish the Gist');
  return res.json();
}

/** Deletes a published Gist; one already gone counts as deleted. */
export async function unpublishGist(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/gists/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await responseError(res, 'Failed to delete the Gist');
}

export async function fetchWorkspace(fresh = false): Promise<WorkspaceAnswer> {
  const res = await fetch(`${API_BASE}/workspace${fresh ? '?fresh=1' : ''}`);
  if (!res.ok) throw await responseError(res, 'Failed to fetch workspace');
  return res.json();
}

/** A local workspace's stream of `change` events, sent when files change in any of its worktrees. */
export const openWorkspaceEvents = () => new EventSource(`${API_BASE}/workspace/events`);

/** Commits one repository's manifest, refused with 409 when `configRevision` is no longer that manifest's revision. */
export async function updateWorkspaceConfig(repository: string, configYaml: string, configRevision: string): Promise<{ success: boolean; configRevision: string; }> {
  const res = await fetch(`${API_BASE}/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, configYaml, configRevision }) });
  // The status tells Settings a 409 (the manifest moved) from a refusal.
  if (!res.ok) throw await responseError(res, 'Failed to update workspace configuration');
  return res.json();
}

/** `date` and `time` are the reader's own, which fill `{{date}}` and `{{time}}`; left out, the server's clock does. */
export async function renderNoteTemplate(params: { notebookId: string; templateId: string; title: string; date?: string; time?: string; }): Promise<{ content: string; metadata: Record<string, unknown>; }> {
  const url = `${API_BASE}/templates/render?${new URLSearchParams({ notebookId: params.notebookId, templateId: params.templateId, title: params.title, ...(params.date ? { date: params.date } : {}), ...(params.time ? { time: params.time } : {}) })}`;
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, 'Failed to render template');
  return res.json();
}

/** A notebook's templates as its repository holds them: the manifest's, then the files of its `.templates/` folder, each with its last use. */
export async function fetchNoteTemplates(notebookId: string): Promise<ListedNoteTemplate[]> {
  const res = await fetch(`${API_BASE}/templates?notebookId=${encodeURIComponent(notebookId)}`);
  if (!res.ok) throw await responseError(res, 'Failed to load templates');
  return (await res.json()).templates;
}

export async function readNote(path: string, notebookId?: string): Promise<NoteItem> {
  // In demo mode a note committed in this browser is what the note now is.
  const local = localCommittedEntry(path, notebookId);
  if (local) {
    if (local.deleted) throw new ApiError('Failed to read note', 404);
    return local.note;
  }
  const url = `${API_BASE}/notes/read?path=${encodeURIComponent(path)}${notebookId ? `&notebookId=${encodeURIComponent(notebookId)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const failure = await responseError(res, 'Failed to read note');
    // A demo repository never changes, so a note its server cannot find means the demo cookie no longer matches this page (it expired, was cleared, or another tab chose another language), not that the note moved or was deleted. A 404 would make the editor keep a conflict draft of a note nobody edited.
    if (failure.status === 404 && (notebookId ? demoScopeOfNotebook(notebookId) : hasDemoScopes())) throw new Error(failure.message);
    throw failure;
  }
  const data = await res.json();
  return data.note;
}

/** Reads notes of one repository at the revision the caller reviewed. */
export async function readNotes(repository: RepositoryId, paths: string[], revision: string): Promise<NoteItem[]> {
  const res = await fetch(`${API_BASE}/notes/read-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, paths, revision }) });
  if (!res.ok) throw await responseError(res, 'Failed to review notes');
  return (await res.json()).notes;
}

export async function saveNote(params: { path: string; content: string; metadata?: Record<string, unknown>; commitMessage?: string; createOnly?: boolean; revision?: string; noCommit?: boolean; notebookId?: string; }): Promise<{ success: boolean; note: NoteItem; commit?: { commitHash: string; }; committed?: boolean; }> {
  const res = await fetch(`${API_BASE}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw await responseError(res, 'Failed to save note');
  return res.json();
}

export async function deleteNote(path: string, options?: { noCommit?: boolean; notebookId?: string; }): Promise<{ success: boolean; committed?: boolean; pending?: boolean; }> {
  const url = `${API_BASE}/notes?path=${encodeURIComponent(path)}${options?.noCommit ? '&noCommit=true' : ''}${options?.notebookId ? `&notebookId=${encodeURIComponent(options.notebookId)}` : ''}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw await responseError(res, 'Failed to delete note');
  return res.json();
}

/**
 * Sets each listed note's `tags` array exactly, in one commit. Used for tag rename/merge/
 * delete and for undoing any of them — the caller computes the target `tags` per note
 * (see `@mygitnotes/core`'s `planTagRename`/`planTagMerge`/`planTagDelete`/
 * `invertTagOperationPlan`); this endpoint only writes and commits.
 */
/** Rewrites the tags of notes in one repository as one commit on it. */
export async function applyTagChange(repository: RepositoryId, entries: { path: string; notebookId: string; tags: string[]; }[], revision: string, message?: string): Promise<{ success: boolean; changedPaths: string[]; commit?: { commitHash: string; }; revision?: string; }> {
  const res = await fetch(`${API_BASE}/tags/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, entries, revision, message }) });
  if (!res.ok) throw await responseError(res, 'Failed to update tags');
  return res.json();
}

export async function restoreNote(params: { path: string; content?: string; metadata?: Record<string, unknown>; notebookId?: string; }): Promise<{ success: boolean; note: NoteItem | null; }> {
  const res = await fetch(`${API_BASE}/notes/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw await responseError(res, 'Failed to restore note');
  return res.json();
}

/** The agent workspaces of every available repository. */
export async function fetchAgentWorkspaces(): Promise<AgentWorkspace[]> {
  const res = await fetch(`${API_BASE}/agent-resources/workspaces`);
  if (!res.ok) throw new Error('Failed to fetch agent workspaces');
  return (await res.json()).workspaces;
}

/** The workspaces and workspace files of one repository (the default repository without `repository`); each repository keeps its own. */
export async function fetchAgentResources(repository?: string): Promise<{ workspaces: AgentWorkspace[]; files: AgentFile[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch agent resources');
  return res.json();
}

export async function readAgentResource(path: string, repository?: string): Promise<{ path: string; content: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/read?path=${encodeURIComponent(path)}${repository ? `&repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to read agent resource');
  return res.json();
}

export async function saveAgentResource(params: { path: string; content: string; revision?: string; create?: boolean; repository?: string; }): Promise<{ success: boolean; path: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save agent resource');
  }
  return res.json();
}

export async function renameAgentSkill(params: { path: string; slug: string; content: string; revision?: string; repository?: string; }): Promise<{ success: boolean; path: string; changedPaths?: string[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to rename skill');
  }
  return res.json();
}

export async function restoreAgentResource(path: string, revision?: string, repository?: string): Promise<{ success: boolean; path: string; content: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, revision, repository }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to restore agent resource');
  }
  return res.json();
}

export async function fetchAssets(notebookId: string): Promise<AssetItem[]> {
  const res = await fetch(`${API_BASE}/assets?notebookId=${encodeURIComponent(notebookId)}`);
  if (!res.ok) throw new Error('Failed to fetch assets');
  const data = await res.json();
  return data.assets || [];
}

export async function uploadAsset(notebookId: string, filename: string, base64Content: string, options: { directory?: string; revision?: string; } = {}): Promise<{ success: boolean; filename: string; path: string; markdownRef: string; }> {
  const res = await fetch(`${API_BASE}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId, filename, base64Content, ...options }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to upload asset');
  }
  return res.json();
}

export async function deleteAsset(path: string, options?: { noCommit?: boolean; revision?: string; }): Promise<{ success: boolean; committed?: boolean; }> {
  const url = `${API_BASE}/assets?path=${encodeURIComponent(path)}${(options?.noCommit ? '&noCommit=true' : '') + (options?.revision ? '&revision=' + encodeURIComponent(options.revision) : '')}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete asset');
  }
  return res.json();
}

/** Git status of one worktree, the default worktree without `repository`. */
export async function fetchGitStatus(repository?: string): Promise<{ status: GitStatus; commits: GitCommit[]; }> {
  const res = await fetch(`${API_BASE}/git/status${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch git status');
  return res.json();
}

export async function fetchFileChanges(): Promise<import('./types.js').FileChange[]> {
  const response = await fetch(`${API_BASE}/git/changes`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read changes');
  return data.changes;
}
const repositoryParam = (repository?: string) => repository ? `&repository=${encodeURIComponent(repository)}` : '';
export async function fetchFileDiff(file: Pick<import('./types.js').FileChange, 'path' | 'repository'>, side: 'working' | 'staged' | 'current'): Promise<string> {
  const response = await fetch(`${API_BASE}/git/file-diff?path=${encodeURIComponent(file.path)}&side=${side}${repositoryParam(file.repository)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read diff');
  return data.diff;
}
export async function manageFileChange(file: import('./types.js').FileChange, action: 'stage' | 'unstage' | 'restore'): Promise<{ backup?: string; }> {
  const response = await fetch(`${API_BASE}/git/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path, revision: file.revision, action, repository: file.repository }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'File operation failed');
  return data;
}
/** A commit run that stopped at a repository; `committed` names the repositories already committed. */
export class PartialCommitError extends Error {
  constructor(message: string, public committed: string[]) {
    super(message);
  }
}
/** Commits each worktree's files in turn, one commit per worktree, stopping at the first that fails. */
export async function commitStagedChanges(files: import('./types.js').FileChange[], message: string, selected = false, version?: NewVersionRequest) {
  const groups = new Map<string | undefined, import('./types.js').FileChange[]>();
  for (const file of files) groups.set(file.repository, [...groups.get(file.repository) ?? [], file]);
  const committed: string[] = [];
  for (const [repository, group] of groups) {
    const response = await fetch(`${API_BASE}/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, files: group.map(file => file.path), revisions: Object.fromEntries(group.map(file => [file.path, file.revision])), message, selected, version }) });
    const data = await response.json();
    if (!response.ok) throw new PartialCommitError(data.error || 'Commit failed', committed);
    if (repository) committed.push(repository);
  }
}

export async function fetchGitDiff(path?: string): Promise<string> {
  const url = path ? `${API_BASE}/git/diff?path=${encodeURIComponent(path)}` : `${API_BASE}/git/diff`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch git diff');
  const data = await res.json();
  return data.diff || '';
}

export async function generateSemanticCommit(diff: string, filePath?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/git/semantic-commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diff, filePath }) });
  if (!res.ok) return 'minor-mod';
  const data = await res.json();
  return data.message || 'minor-mod';
}

export async function createCommit(files: string[], message: string): Promise<{ success: boolean; }> {
  const res = await fetch(`${API_BASE}/git/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, message }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to commit changes');
  }
  return res.json();
}

export class GitSyncError extends Error {
  constructor(message: string, public code: string, public files: string[]) {
    super(message);
  }
}

/** Pulls and pushes one worktree, the default worktree when `repository` is absent. */
export async function syncGitWorkspace(strategy?: 'remote' | 'local', repository?: string, pullOnly?: boolean): Promise<{ upstream: string; pulled: number; pushed: number; backup?: string; }> {
  const res = await fetch(`${API_BASE}/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(strategy ? { strategy } : {}), ...(repository ? { repository } : {}), ...(pullOnly ? { pullOnly } : {}) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GitSyncError(data.error || 'Sync failed', data.code || 'FAILED', data.files || []);
  return data.result;
}

export class CoreUpdateApiError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}
export async function fetchCoreStatus(): Promise<import('@mygitnotes/core').CoreStatus> {
  const res = await fetch(`${API_BASE}/core/status`);
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to check Core status', data.code || 'STATUS_FAILED');
  return data.status;
}
export async function installCoreSyncWorkflow(): Promise<void> {
  const res = await fetch(`${API_BASE}/core/install`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to install Core sync', data.code || 'INSTALL_FAILED');
}
export async function fetchCoreUpdateRun(requestId: string): Promise<import('@mygitnotes/core').CoreUpdateRun> {
  const res = await fetch(`${API_BASE}/core/runs/${encodeURIComponent(requestId)}`);
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to follow Core update', data.code || 'RUN_STATUS_FAILED');
  return data.run;
}
export async function runCoreUpdate(autoPush = false): Promise<{ result: { success?: boolean; alreadyUpToDate?: boolean; accepted?: boolean; receipt?: import('@mygitnotes/core').CoreUpdateReceipt; }; }> {
  const res = await fetch(`${API_BASE}/core/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPush }) });
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to run Core update', data.code || 'UPDATE_FAILED');
  return data;
}

export async function fetchFolders(): Promise<FolderItem[]> {
  const res = await fetch(`${API_BASE}/folders`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch folders');
  return data.folders;
}

export async function moveAsset(params: { path: string; directory: string; revision?: string; }): Promise<{ path: string; }> {
  const res = await fetch(`${API_BASE}/assets`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw await responseError(res, 'Failed to move asset');
  return res.json();
}

/** A thesis-toolkit project a note belongs to, as the local server found it (local mode only). */
export interface TypstPreviewProject {
  name: string;
  /** The project's directory in its worktree; a note under it belongs to the project. */
  directory: string;
  targets: string[];
  defaultTarget: string;
  bibliographyRevision: string;
}
export type TypstToolkitStatus = { ok: true; version: string; } | { ok: false; code: 'missing' | 'too-old' | 'unsupported-platform'; version?: string; };
export interface TypstPreviewProjectAnswer {
  project: TypstPreviewProject | null;
  toolkit?: TypstToolkitStatus;
}
export interface TypstCompileResult {
  ok: boolean;
  revision?: string;
  durationMs: number;
  log: string;
}

const typstPreviewQuery = (path: string, notebookId?: string) => `path=${encodeURIComponent(path)}${notebookId ? `&notebookId=${encodeURIComponent(notebookId)}` : ''}`;

/** The thesis-toolkit project of a note, or `project: null` for a note outside one. */
export async function fetchTypstPreviewProject(path: string, notebookId?: string): Promise<TypstPreviewProjectAnswer> {
  const res = await fetch(`${API_BASE}/typst-preview/project?${typstPreviewQuery(path, notebookId)}`);
  if (!res.ok) throw await responseError(res, 'Failed to read the Typst project');
  return res.json();
}

/** The entries of the bibliography the note's project cites from. */
export async function fetchTypstBibliography(path: string, notebookId?: string): Promise<{ revision: string; entries: import('@mygitnotes/core/citations').CitationEntry[]; }> {
  const res = await fetch(`${API_BASE}/typst-preview/bibliography?${typstPreviewQuery(path, notebookId)}`);
  if (!res.ok) throw await responseError(res, 'Failed to read the bibliography');
  return res.json();
}

/** Compiles the note's project from the saved files; answers when the run (or the one queued behind a running one) ends. */
export async function compileTypstPreview(path: string, notebookId: string | undefined, target: string): Promise<TypstCompileResult> {
  const res = await fetch(`${API_BASE}/typst-preview/compile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, notebookId, target }) });
  if (!res.ok) throw await responseError(res, 'Failed to compile the preview');
  return res.json();
}

/** The PDF of one compiled revision. */
export async function fetchTypstPreviewPdf(path: string, notebookId: string | undefined, target: string, revision: string): Promise<Uint8Array> {
  const res = await fetch(`${API_BASE}/typst-preview/pdf?${typstPreviewQuery(path, notebookId)}&target=${encodeURIComponent(target)}&revision=${encodeURIComponent(revision)}`);
  if (!res.ok) throw await responseError(res, 'Failed to load the preview');
  return new Uint8Array(await res.arrayBuffer());
}
