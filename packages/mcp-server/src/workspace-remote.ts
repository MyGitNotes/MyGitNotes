import { isLiveContentHash, isLiveId, isLiveRevision, liveBase, mergeTemplateLists, type RemoteSource, type RevisionSet, StaleRevisionError, type TemplateList, type WorkspaceRepositories } from '@mygitnotes/core';
import { keyedResult, listedNotebooks, notebookArgument } from './notebook-keys.js';
import { callRemoteTool, isMutationTool } from './remote-tools.js';
import type { ToolAssets } from './tools/assets.js';

type RemoteHandle = { reader: RemoteSource; };
type Args = Record<string, unknown>;
const bareSha = /^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/;

/** A live note a token names: its repository and path, and the link id, live revision and content hash a read returned. */
export type LiveRevisionEntry = [repository: string, path: string, id: string, liveRevision: string, contentHash: string];
/** The most live entries one token carries, and the longest token; the oldest live entries go first. */
const LIVE_ENTRIES_MAX = 32;
const TOKEN_MAX = 8192;

/**
 * v1: base64url of a JSON object mapping repository identities to commit SHAs, exactly as before live notes. With live
 * entries, v2: base64url of `{"r": <that object>, "l": [[repository, path, id, liveRevision, contentHash], …]}`.
 */
export function encodeWorkspaceRevision(revisions: RevisionSet, live: readonly LiveRevisionEntry[] = []): string {
  if (!live.length) return `v1.${Buffer.from(JSON.stringify(revisions)).toString('base64url')}`;
  let entries = live.slice(-LIVE_ENTRIES_MAX);
  for (;;) {
    const token = `v2.${Buffer.from(JSON.stringify({ r: revisions, l: entries })).toString('base64url')}`;
    if (token.length <= TOKEN_MAX || !entries.length) return entries.length ? token : encodeWorkspaceRevision(revisions);
    entries = entries.slice(1);
  }
}

export function decodeWorkspaceRevision(token: string, repository: string, repositoryCount: number): string {
  return parseWorkspaceRevision(token, repository, repositoryCount).r[repository];
}

const invalidToken = () => new Error('Invalid workspace revision token.');
const revisionSet = (value: unknown): RevisionSet => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(sha => typeof sha !== 'string' || !bareSha.test(sha))) throw invalidToken();
  return value as RevisionSet;
};
const isRepositoryPath = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !value.startsWith('/') && !/[\\\p{Cc}]/u.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const liveEntries = (value: unknown): LiveRevisionEntry[] => {
  if (!Array.isArray(value) || value.length > LIVE_ENTRIES_MAX) throw invalidToken();
  return value.map(entry => {
    if (!Array.isArray(entry) || entry.length !== 5) throw invalidToken();
    const [repository, file, id, liveRevision, contentHash] = entry as unknown[];
    if (typeof repository !== 'string' || !repository || repository.length > 512 || !isRepositoryPath(file) || !isLiveId(id) || !isLiveRevision(liveRevision) || !isLiveContentHash(contentHash)) throw invalidToken();
    return [repository, file as string, id, liveRevision, contentHash];
  });
};

function parseWorkspaceRevision(token: string, repository: string, repositoryCount: number): { r: RevisionSet; l: LiveRevisionEntry[]; } {
  if (bareSha.test(token)) {
    if (repositoryCount !== 1) throw new Error('A bare commit SHA is only valid in a single-repository workspace; pass the workspace revision token.');
    return { r: { [repository]: token }, l: [] };
  }
  const version = /^(v[12])\.[A-Za-z0-9_-]+$/.exec(token)?.[1];
  if (!version) throw invalidToken();
  let decoded: unknown;
  try {
    const payload = token.slice(3);
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) throw new Error('Noncanonical base64url');
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalidToken();
  }
  let parsed: { r: RevisionSet; l: LiveRevisionEntry[]; };
  if (version === 'v1') parsed = { r: revisionSet(decoded), l: [] };
  else {
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Object.keys(decoded).some(key => key !== 'r' && key !== 'l')) throw invalidToken();
    const { r, l } = decoded as { r?: unknown; l?: unknown; };
    parsed = { r: revisionSet(r), l: liveEntries(l) };
  }
  if (!parsed.r[repository]) throw new Error(`Workspace revision token has no entry for repository ${repository}.`);
  return parsed;
}

/** Text writes that take the revision a read of a live note returned; `append` lands live whatever it is given. */
const liveTextWrites = new Set(['write', 'edit', 'save_note', 'update_note_metadata']);

const workspaceReads = new Set(['glob', 'find', 'list_notes', 'search_notes', 'list_skills', 'list_assets', 'get_statuses', 'list_folders', 'list_templates']);
const pathTools = new Set(['read', 'read_note', 'check_in_note', 'write', 'append', 'edit', 'save_note', 'delete_note', 'mkdir', 'rm', 'cp', 'mv', 'get_folder_metadata', 'update_folder_metadata', 'get_note_metadata', 'update_note_metadata', 'delete_asset', 'download_assets', 'list_folders', 'ls']);
const optionalWrites = new Set(['delete_note', 'delete_asset', 'update_note_metadata', 'add_asset', 'replace_notes']);
const mutation = (name: string) => isMutationTool(name) || optionalWrites.has(name);

/**
 * Route a hosted tool by notebook identity; only workspace-wide reads fan out. Tools name notebooks by key (a bare
 * local id resolves as an old URL does), each repository's tools see its local ids, and results name notebooks by key.
 * `assetsFor` names the bucket each repository's asset tools use (the environment's by default).
 */
export async function callWorkspaceRemoteTool(workspace: WorkspaceRepositories<RemoteHandle>, name: string, input: Args, write: boolean, appUrl?: string, assetsFor?: (handle: RemoteHandle) => ToolAssets): Promise<Record<string, unknown>> {
  const repositories = await workspace.all();
  const available = repositories.filter((entry): entry is typeof entry & { handle: RemoteHandle; } => 'handle' in entry);
  const unavailable = repositories.filter(entry => 'unavailable' in entry).map(entry => ({ repository: entry.ref.id, message: entry.unavailable.message }));
  if (name === 'get_workspace_config') return { config: await workspace.keyedConfig(), notebooks: await listedNotebooks(workspace), revision: await revisions(available.slice(0, 1)) };
  if (name === 'list_notebooks') return { notebooks: await listedNotebooks(workspace), revision: await revisions(available.slice(0, 1)) };
  const notebookKey = await notebookArgument(workspace, input.notebookId);
  const args: Args = notebookKey ? { ...input, notebookId: notebookKey } : input;
  const web = (entry: (typeof available)[number]) => appUrl ? { appUrl, alias: entry.alias } : undefined;
  if (name === 'get_statuses' && !args.notebookId && repositories.length > 1) {
    const results = await Promise.all(available.map(entry => callRemoteTool(entry.handle.reader, name, args, write)));
    const union = (field: string) => [...new Set(results.flatMap(result => result[field] as string[]))];
    return { notebookId: 'all', defaultStatuses: union('defaultStatuses'), configuredStatuses: union('configuredStatuses'), observedStatuses: union('observedStatuses'), allStatuses: union('allStatuses'), revision: await revisions(available), unavailable };
  }
  const broad = (name === 'ls' && (!args.path || args.path === '.')) || (workspaceReads.has(name) && !args.notebookId && !args.path && repositories.length > 1);
  if (broad && name !== 'get_statuses') {
    if (name === 'list_skills' || name === 'list_assets' || name === 'list_folders' || name === 'list_templates') {
      const results = await Promise.all(available.map(async entry => keyedResult(await callRemoteTool(entry.handle.reader, name, args, write, web(entry), assetsFor?.(entry.handle)), entry)));
      // Each repository answered its own matches, cut at the limit; one order and one limit hold across them.
      if (name === 'list_templates') return { ...mergeTemplateLists(results as unknown as TemplateList[], args.limit), revision: await revisions(available), unavailable };
      const field = name === 'list_skills' ? 'skills' : name === 'list_assets' ? 'assets' : 'folders';
      return { [field]: results.flatMap(result => result[field] as unknown[]), ...(name === 'list_skills' ? { target: null } : {}), revision: await revisions(available), unavailable };
    }
    if (name === 'find') {
      // fileOffset counts glob-matching files across repositories in manifest order.
      const counts = await Promise.all(available.map(async entry => Number((await callRemoteTool(entry.handle.reader, 'glob', { ...(args.pattern ? { pattern: args.pattern } : {}), limit: 1 }, write)).total)));
      const totalFiles = counts.reduce((sum, count) => sum + count, 0);
      const fileOffset = Number(args.fileOffset || 0);
      let skip = fileOffset;
      let scannedFiles = 0;
      const matches: unknown[] = [];
      let cannotContinue = false;
      for (let i = 0; i < available.length; i++) {
        if (skip >= counts[i]) {
          skip -= counts[i];
          continue;
        }
        const maxFiles = Number(args.maxFiles || 25) - scannedFiles;
        const maxResults = Number(args.maxResults || 100) - matches.length;
        if (maxFiles <= 0 || maxResults <= 0) break;
        const result = await callRemoteTool(available[i].handle.reader, name, { ...args, fileOffset: skip, maxFiles, maxResults }, write);
        matches.push(...result.matches as unknown[]);
        scannedFiles += Number(result.scannedFiles);
        if (result.truncated && result.nextFileOffset === null) {
          cannotContinue = true;
          break;
        }
        skip = 0;
      }
      const nextFileOffset = cannotContinue || fileOffset + scannedFiles >= totalFiles ? null : fileOffset + scannedFiles;
      return { matches, scannedFiles, truncated: cannotContinue || nextFileOffset !== null, nextFileOffset, revision: await revisions(available), unavailable };
    }
    const paged = name === 'ls' || name === 'glob' || name === 'list_notes';
    const field = name === 'ls' ? 'entries' : name === 'glob' ? 'paths' : name === 'list_notes' ? 'notes' : 'matches';
    const results = await Promise.all(available.map(async entry => {
      if (!paged) return [keyedResult(await callRemoteTool(entry.handle.reader, name, args, write, web(entry)), entry)];
      const pages: Record<string, unknown>[] = [];
      let nextOffset: number | null = 0;
      while (nextOffset !== null) {
        const page = keyedResult(await callRemoteTool(entry.handle.reader, name, { ...args, offset: nextOffset, limit: 500 }, write, web(entry)), entry);
        pages.push(page);
        nextOffset = page.nextOffset as number | null;
      }
      return pages;
    }));
    const pages = results.flat();
    const merged = pages.flatMap(result => result[field] as unknown[]);
    const offset = Number(args.offset || 0);
    const limit = Number(args.limit || 100);
    const total = paged ? merged.length : pages.reduce((n, r) => n + Number(r.total), 0);
    const entries = paged ? merged.slice(offset, offset + limit) : name === 'search_notes' ? merged.sort((a, b) => Number((b as { score: number; }).score) - Number((a as { score: number; }).score)).slice(0, Number(args.limit || 20)) : merged;
    return { ...(name === 'ls' ? { path: '.' } : {}), ...(name === 'search_notes' ? { query: args.query || '', isRegex: Boolean(args.isRegex), totalMatches: pages.reduce((n, r) => n + Number(r.totalMatches), 0), truncated: pages.some(r => r.truncated) || merged.length > entries.length } : {}), [field]: entries, total, ...(paged ? { nextOffset: offset + limit < total ? offset + limit : null } : {}), ...(name === 'list_notes' ? { count: entries.length } : {}), revision: await revisions(available), unavailable };
  }
  const entry = ['cp', 'mv', 'rm'].includes(name) ? await resolvePath(workspace, name, args, assetsFor) : notebookKey ? await workspace.forNotebook(notebookKey) : await resolvePath(workspace, name, args, assetsFor);
  const selectedPath = args.path;
  const selected = notebookKey ? entry.notebooks.find(nb => nb.key === notebookKey) : undefined;
  if (notebookKey && typeof selectedPath === 'string' && !selectedPath.startsWith('r2:') && !(selected && (selectedPath === selected.root || selectedPath.startsWith(`${selected.root}/`) || selectedPath.startsWith('.agents/skills/') || selectedPath.startsWith(`${selected.root.replace(/\/[^/]+$/, '')}/.agents/skills/`)))) throw new Error('Path does not belong to the selected notebook.');
  // The repository's tools name the notebook by its local id.
  const scoped: Args = { ...args, ...(selected ? { notebookId: selected.id } : {}) };
  if (typeof scoped.revision === 'string' && scoped.revision.length > TOKEN_MAX) throw new Error('Workspace revision token is too long.');
  const token = typeof scoped.revision === 'string' ? parseWorkspaceRevision(scoped.revision, entry.ref.id, repositories.length) : { r: {}, l: [] };
  const received = token.r;
  // The live calls are optional: a reader that is not a `RemoteSource` subclass, such as a test double, has none and is never live.
  const reader = entry.handle.reader;
  if (typeof scoped.revision === 'string') {
    scoped.revision = received[entry.ref.id];
    // A text write to a note still checked out under the link a read named goes to the live editor on that read's
    // revision; a note no longer checked out ignores its live entry and checks the commit.
    const held = liveTextWrites.has(name) && typeof args.path === 'string' ? token.l.find(([repository, file]) => repository === entry.ref.id && file === args.path) : undefined;
    if (held && (await reader.liveCheckout?.(held[1]))?.id === held[2]) scoped.revision = liveBase({ id: held[2], liveRevision: held[3], contentHash: held[4] });
  }
  /** The live entries the answer's token carries: those received, with this call's own read or write of its note. */
  const liveOut = (): LiveRevisionEntry[] => {
    const file = typeof args.path === 'string' ? args.path : undefined;
    const record = file === undefined ? undefined : reader.liveRecord?.(file);
    if (!file || !record) return token.l;
    return [...token.l.filter(([repository, held]) => !(repository === entry.ref.id && held === file)), [entry.ref.id, file, record.id, record.liveRevision, record.contentHash]];
  };
  let result: Record<string, unknown>;
  try {
    result = keyedResult(await callRemoteTool(entry.handle.reader, name, scoped, write, web(entry), assetsFor?.(entry.handle)), entry);
  } catch (error) {
    if (error instanceof StaleRevisionError) throw new StaleRevisionError([entry.ref.id], `Stale revision for repository ${entry.ref.id}. Reload before writing.`);
    throw error;
  }
  if (typeof result.revision === 'string' || mutation(name)) {
    const sha = typeof result.revision === 'string' ? result.revision : (result.commit as { commitHash?: string; } | undefined)?.commitHash;
    if (sha) result.revision = encodeWorkspaceRevision({ ...received, [entry.ref.id]: sha }, liveOut());
  }
  if (!mutation(name) && typeof result.revision !== 'string') result.revision = encodeWorkspaceRevision({ [entry.ref.id]: (await reader.getSnapshot()).sha }, liveOut());
  if (result.note && typeof (result.note as Record<string, unknown>).revision === 'string') {
    const note = result.note as Record<string, unknown>;
    const record = typeof note.path === 'string' ? reader.liveRecord?.(note.path) : undefined;
    result.note = { ...note, revision: encodeWorkspaceRevision({ [entry.ref.id]: note.revision as string }, record ? [[entry.ref.id, note.path as string, record.id, record.liveRevision, record.contentHash]] : []) };
  }
  return result;
}

async function revisions(entries: { ref: { id: string; }; handle: RemoteHandle; }[]) {
  return encodeWorkspaceRevision(Object.fromEntries(await Promise.all(entries.map(async entry => [entry.ref.id, (await entry.handle.reader.getSnapshot()).sha]))));
}

async function notebookPath(workspace: WorkspaceRepositories<RemoteHandle>, file: string) {
  const roots = (await workspace.all()).flatMap(entry => entry.notebooks.filter(nb => nb.root === file));
  if (roots.length > 1) throw new Error('The path lies in notebooks of more than one repository. Name its notebook.');
  return roots.length ? workspace.forNotebook(roots[0].key) : workspace.forPath(file);
}

/**
 * The repository whose notebook an `r2:` key belongs to: the key's first folder after the storage's key prefix is a
 * notebook's local id, so a key no prefix places resolves that id as a bare notebook id.
 */
async function r2Repository(workspace: WorkspaceRepositories<RemoteHandle>, key: string, assetsFor?: (handle: RemoteHandle) => ToolAssets) {
  for (const entry of await workspace.all()) {
    if (!('handle' in entry)) continue;
    const prefix = (await assetsFor?.(entry.handle).scope())?.prefix ?? '';
    const localId = key.startsWith(prefix) ? key.slice(prefix.length).split('/')[0] : undefined;
    const notebook = entry.notebooks.find(nb => nb.id === localId);
    if (notebook) return workspace.forNotebook(notebook.key);
  }
  const resolved = await workspace.resolveBareId(key.split('/')[0]);
  if (!resolved) throw new Error(`Notebook is not configured for r2:${key}.`);
  return workspace.forNotebook(resolved);
}

async function resolvePath(workspace: WorkspaceRepositories<RemoteHandle>, name: string, args: Args, assetsFor?: (handle: RemoteHandle) => ToolAssets) {
  const selected = typeof args.notebookId === 'string' ? await workspace.forNotebook(args.notebookId) : undefined;
  const pathEntry = (file: string) => {
    if (selected && (file === selected.notebook.root || file.startsWith(`${selected.notebook.root}/`))) return Promise.resolve(selected);
    return notebookPath(workspace, file);
  };
  if (name === 'cp' || name === 'mv') {
    const source = await pathEntry(String(args.source));
    const destination = await pathEntry(String(args.destination));
    if (source.ref.id !== destination.ref.id) throw new Error(`${name} cannot cross repositories (${source.ref.id} → ${destination.ref.id}).`);
    return source;
  }
  if (name === 'rm') {
    const paths = args.paths as string[];
    const entries = await Promise.all(paths.map(pathEntry));
    if (entries.some(entry => entry.ref.id !== entries[0].ref.id)) throw new Error('rm cannot span repositories; use one call per repository.');
    return entries[0];
  }
  if (typeof args.path === 'string' && args.path !== '.' && !args.path.startsWith('r2:')) {
    const repositories = await workspace.all();
    if (args.path.startsWith('.agents/skills/') && repositories.length === 1) return workspace.byId(repositories[0].ref.id);
    return notebookPath(workspace, args.path);
  }
  if (pathTools.has(name) && !args.path?.toString().startsWith('r2:')) throw new Error('Name a notebook or a path inside a configured notebook.');
  if (name === 'replace_notes' && !args.notebookId && !args.dryRun) throw new Error('replace_notes requires notebookId so one mutation writes one repository.');
  if (name === 'invoke_skill' && !args.path && (await workspace.all()).length !== 1) throw new Error('Name a notebook or note path when invoking a skill in a multi-repository workspace.');
  if (typeof args.path === 'string' && args.path.startsWith('r2:')) return r2Repository(workspace, args.path.slice(3), assetsFor);
  return workspace.defaultRepository();
}
