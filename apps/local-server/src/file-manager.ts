import { type Response, Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getCurrentBranch } from '@mygitnotes/git';
import { assetHash, assetInfo, assetRoot, changedFiles, checkedOutFields, editableFile, type FileCommand, FileCommandSchema, fileNeedsContent, filePresentation, fileRetainer, type FileSnapshot, isNotebookContent, managedNotebook, type NotebookConfig, NoteFrontmatterUnreadableError, parseFolderConfig, planFileChange, rawFileHeaders, remoteFileChanges, remoteFileSnapshot, type RemoteSnapshot, type RemoteSource, SourceError, stampIsRacy, withinPath, WORKSPACE_DOCUMENTS, type WorkspaceConfig } from '@mygitnotes/core';
import { defaultRepository, eachRepository, notebookRepository, noteRepository, type RepositoryHandle } from './request-workspace.js';
import { serializeWorkspaceMutation } from './workspace-mutation.js';
import { regularPath, writeFileAtomicSync } from './workspace-files.js';
import { moveLocalVersionFiles } from './version-files.js';

const auxiliary = WORKSPACE_DOCUMENTS.map(document => document.file);
interface CatalogFile {
  size: number;
  stamp: string;
  hash?: string;
  mtime?: number;
}
interface FileCatalog {
  notebooks: FileSnapshot['notebooks'];
  directories: string[];
  protectedPaths: string[];
  files: Map<string, CatalogFile>;
}
export function localFileCatalog(root: string, notebooks: NotebookConfig[]): FileCatalog {
  const catalog: FileCatalog = { notebooks, directories: [], protectedPaths: [], files: new Map() };
  const visited = new Set<string>();
  // lstat rejects a file that became a symlink after the listing.
  const add = (file: string, full: string) => {
    const stat = fs.lstatSync(full, { bigint: true });
    if (!stat.isFile()) throw new SourceError('Expected a regular file.', 400);
    catalog.files.set(file, { size: Number(stat.size), mtime: Number(stat.mtimeMs), stamp: [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.mode].join(':') });
  };
  // Only a walk's starting directory goes through `regularPath`; it descends solely into entries the listing reports as
  // real directories, so the paths below it need no per-file symlink check.
  const visit = (dir: string, full: string) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    catalog.directories.push(dir);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const file = dir + '/' + entry.name;
      if (!managedNotebook(file, notebooks, entry.isDirectory() ? 'directory' : 'file') || entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) catalog.protectedPaths.push(file);
      else if (entry.isDirectory()) visit(file, path.join(full, entry.name));
      else add(file, path.join(full, entry.name));
    }
  };
  const start = (dir: string) => {
    const full = regularPath(root, dir);
    if (fs.existsSync(full)) visit(dir, full);
  };
  for (const nb of notebooks) {
    start(nb.root);
    if (nb.pathAliases) {
      for (const target of Object.values(nb.pathAliases)) {
        const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
        if (targetDir) start(targetDir);
      }
    }
  }
  for (const file of auxiliary) {
    const full = regularPath(root, file);
    if (fs.existsSync(full)) add(file, full);
  }
  return catalog;
}
function localRead(root: string, file: string) {
  const full = regularPath(root, file), stat = fs.statSync(full);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new SourceError('File reads support up to 5 MiB.', 413);
  return fs.readFileSync(full);
}
/** Git object ids of worktree files, reused while a file's stamp is unchanged, so an asset listing hashes only edited files. */
const localHashes = new Map<string, { stamp: string; hash: string; }>();
async function localHash(root: string, file: string, size: number, stamp: string) {
  const key = `${root}\0${file}`;
  const cached = localHashes.get(key);
  if (cached?.stamp === stamp) return cached.hash;
  const hash = createHash('sha1').update(`blob ${size}\0`);
  for await (const chunk of fs.createReadStream(regularPath(root, file))) hash.update(chunk);
  const digest = hash.digest('hex');
  // A file rewritten after its stamp was taken has a new stamp next time, so this hash is never served for newer bytes;
  // only a file still inside its timestamp tick could be rewritten without one, so its hash is not kept.
  if (!stampIsRacy(fs.statSync(regularPath(root, file)))) localHashes.set(key, { stamp, hash: digest });
  return digest;
}
/**
 * The commit message of a one-file move, which a note's history shows: a rename names the old and the new name, a
 * move the folder the file went to, rather than the default count of the paths it changed (「move 2 files」). None
 * for a folder's move, which keeps the count.
 */
function moveMessage(pathMap: Record<string, string>): string | undefined {
  const moved = Object.entries(pathMap);
  if (moved.length !== 1) return undefined;
  const [[from, to]] = moved;
  const plain = (text: string) => text.replace(/[\r\n]/g, ' ');
  const name = plain(path.posix.basename(from));
  return path.posix.dirname(from) === path.posix.dirname(to) ? `docs(files): rename ${name} to ${plain(path.posix.basename(to))}` : `docs(files): move ${name} to ${plain(path.posix.dirname(to))}`;
}
export function localFileSnapshot(root: string, notebooks: NotebookConfig[], command?: FileCommand): FileSnapshot {
  const catalog = localFileCatalog(root, notebooks);
  const keep = fileRetainer(command);
  const files = new Map<string, Buffer>();
  for (const file of catalog.files.keys()) {
    // Untouched entries retain their paths for collision checks. Only affected
    // files and reference-bearing documents need content for the planner.
    files.set(file, fileNeedsContent(file, command) ? keep(file, localRead(root, file)) : Buffer.alloc(0));
  }
  return { ...catalog, files };
}
function catalogRevision(catalog: FileCatalog) {
  return createHash('sha256').update(JSON.stringify([catalog.notebooks, [...catalog.directories].sort(), [...catalog.protectedPaths].sort(), [...catalog.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, entry]) => [file, entry.stamp])])).digest('hex');
}
async function remoteFiles(reader: RemoteSource, command: FileCommand): Promise<{ snapshot: FileSnapshot; state: RemoteSnapshot; }> {
  const state = await reader.getSnapshot(true);
  return { snapshot: await remoteFileSnapshot(reader, state, command), state };
}
export function applyLocalFilePlan(root: string, before: FileSnapshot, after: ReturnType<typeof planFileChange>) {
  const changes = changedFiles(before, after);
  const addedDirs = after.directories.filter(dir => !before.directories.includes(dir)).sort((a, b) => a.length - b.length);
  const removedDirs = before.directories.filter(dir => !after.directories.includes(dir)).sort((a, b) => b.length - a.length);
  const modes = new Map([...before.files.keys()].map(file => [file, fs.statSync(regularPath(root, file)).mode]));
  for (const file of [...changes, ...addedDirs, ...removedDirs]) regularPath(root, file);
  const write = (file: string, bytes: Buffer, mode?: number) => writeFileAtomicSync(regularPath(root, file), bytes, mode);
  try {
    for (const dir of addedDirs) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of changes) {
      if (after.files.has(file)) {
        const source = Object.keys(after.pathMap).find(key => after.pathMap[key] === file);
        write(file, after.files.get(file)!, modes.get(source || file));
      }
    }
    for (const file of changes) if (!after.files.has(file)) fs.unlinkSync(regularPath(root, file));
    for (const dir of removedDirs) fs.rmdirSync(regularPath(root, dir));
  } catch (error) {
    for (const dir of before.directories) fs.mkdirSync(regularPath(root, dir), { recursive: true });
    for (const file of changes) {
      if (before.files.has(file)) write(file, before.files.get(file)!, modes.get(file));
      else if (fs.existsSync(regularPath(root, file))) fs.unlinkSync(regularPath(root, file));
    }
    for (const dir of [...addedDirs].reverse()) if (fs.existsSync(regularPath(root, dir))) fs.rmdirSync(regularPath(root, dir));
    throw error;
  }
}

export function createFileManagerRouter(): Router {
  const router = Router();
  /**
   * The snapshot of the repository serving the command's notebook, and the command with its notebook key turned into
   * the local id that repository's notebooks carry; a command never leaves its notebook.
   */
  const load = async (res: Response, keyed: FileCommand) => {
    const { handle, config, notebook } = await notebookRepository(res, keyed.notebookId);
    const command = { ...keyed, notebookId: notebook.id };
    if (handle.kind === 'local') {
      const snapshot = localFileSnapshot(handle.root, config.notebooks, command);
      return { command, snapshot, revision: catalogRevision(localFileCatalog(handle.root, config.notebooks)), writable: await getCurrentBranch(handle.root) === 'main', reader: undefined, remoteSnapshot: undefined, local: handle.root, notebooks: config.notebooks };
    }
    const { reader } = handle;
    const { snapshot, state } = await remoteFiles(reader, command);
    return { command, snapshot, revision: state.sha, writable: reader.canWrite(state), reader, remoteSnapshot: state, local: undefined, notebooks: config.notebooks };
  };
  const catalogOf = async (handle: RepositoryHandle, config: WorkspaceConfig) => {
    if (handle.kind === 'local') {
      const index = localFileCatalog(handle.root, config.notebooks);
      return { index, revision: catalogRevision(index), writable: await getCurrentBranch(handle.root) === 'main', read: async (file: string) => localRead(handle.root, file), local: handle.root };
    }
    const { reader } = handle;
    const state = await reader.getSnapshot(true);
    const index: FileCatalog = { notebooks: config.notebooks, directories: [], protectedPaths: [], files: new Map() };
    for (const entry of state.entries) {
      if (entry.mode === '120000' || !managedNotebook(entry.path, config.notebooks, entry.type === 'tree' ? 'directory' : 'file')) continue;
      if (entry.type === 'tree') index.directories.push(entry.path);
      else if (entry.type === 'blob') index.files.set(entry.path, { size: entry.size || 0, stamp: entry.sha, hash: entry.sha });
    }
    return { index, revision: state.sha, writable: reader.canWrite(state), read: (file: string) => reader.readFile(file), local: undefined };
  };
  /** The catalog of the repository serving a notebook key, which lists every notebook of that repository, with that notebook (local id). */
  const catalog = async (res: Response, notebookId: unknown) => {
    const { handle, config, notebook } = await notebookRepository(res, notebookId);
    return { state: await catalogOf(handle, config), nb: notebook };
  };
  router.get('/api/files', async (req, res) => {
    try {
      const { state, nb } = await catalog(res, req.query.notebookId);
      const entries = [...state.index.directories.map(file => ({ path: file, directory: true, size: 0 })), ...[...state.index.files].map(([file, info]) => ({ path: file, directory: false, size: info.size }))].filter(entry => managedNotebook(entry.path, state.index.notebooks, entry.directory ? 'directory' : 'file')?.id === nb.id && entry.path !== nb.root).map(entry => ({ ...entry, noteDirectory: entry.directory && isNotebookContent(entry.path.slice(nb.root.length + 1), nb), name: path.posix.basename(entry.path), hidden: entry.path.slice(nb.root.length + 1).split('/').some(p => p.startsWith('.')), presentation: filePresentation(entry.path) }));
      res.json({ root: nb.root, entries, revision: state.revision, writable: state.writable, remote: state.local === undefined });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/api/files/read', async (req, res) => {
    try {
      const { state, nb } = await catalog(res, req.query.notebookId), file = String(req.query.path || '');
      if (managedNotebook(file, state.index.notebooks, state.index.directories.includes(file) ? 'directory' : 'file')?.id !== nb.id) throw new SourceError('Path is outside this notebook.', 403);
      if (state.index.directories.includes(file)) {
        const raw = state.index.files.has(file + '/_dir.yml') ? (await state.read(file + '/_dir.yml')).toString('utf8') : '';
        return res.json({ path: file, metadata: parseFolderConfig(raw, path.posix.basename(file), file), revision: state.revision });
      }
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      const bytes = await state.read(file);
      res.json({ path: file, hash: assetHash(bytes), content: editableFile(file, bytes) ?? null, revision: state.revision, size: bytes.length });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get('/api/assets', async (req, res) => {
    try {
      // Without a notebook the listing covers the default repository's first notebook.
      const fallback = req.query.notebookId ? undefined : await defaultRepository(res);
      const firstNotebook = fallback?.config.notebooks[0];
      if (fallback && !firstNotebook) throw new SourceError('Choose a notebook.', 400);
      const { state, nb } = fallback ? { state: await catalogOf(fallback.handle, fallback.config), nb: firstNotebook! } : await catalog(res, req.query.notebookId);
      const root = assetRoot(nb), assets = [];
      for (const [file, info] of state.index.files) {
        if (managedNotebook(file, state.index.notebooks)?.id !== nb.id || file.slice(nb.root.length + 1).split('/').some(part => part.startsWith('.'))) continue;
        if (!withinPath(file, root) && filePresentation(file) === 'file' && !/\.(bin|zip|gz|7z|rar|woff2?|ttf|otf)$/i.test(file)) continue;
        const hash = info.hash || (state.local !== undefined ? await localHash(state.local, file, info.size, info.stamp) : assetHash(await state.read(file)));
        assets.push({ ...assetInfo(file, withinPath(file, root) ? root : nb.root, hash, info.size, info.mtime), revision: state.revision });
      }
      res.json({ assets });
    } catch (error) {
      fail(res, error);
    }
  });
  router.get(['/api/files/raw', '/raw-assets/by-hash/:hash', '/raw-assets/*'], async (req, res) => {
    try {
      let state: Awaited<ReturnType<typeof catalogOf>> | undefined;
      let file = String(req.query.path || '');
      let bytes: Buffer | undefined;
      if (req.params.hash) {
        if (!/^[a-f0-9]{40}$/.test(req.params.hash)) throw new SourceError('Invalid file hash.', 400);
        file = '';
        search: for (const { handle, config } of await eachRepository(res)) {
          state = await catalogOf(handle, config);
          for (const [candidate, info] of state.index.files) {
            if (!managedNotebook(candidate, state.index.notebooks) || info.size > 5 * 1024 * 1024) continue;
            if (info.hash) {
              if (info.hash === req.params.hash) {
                file = candidate;
                break search;
              }
            } else {
              const content = await state.read(candidate);
              if (assetHash(content) === req.params.hash) {
                file = candidate;
                bytes = content;
                break search;
              }
            }
          }
        }
      } else if (req.path.startsWith('/raw-assets/')) {
        file = (req.params as Record<string, string>)[0];
        // `notebook` names the asset's notebook, since notebook roots may repeat across repositories. A note's image may lie
        // outside its notebook under a path alias (`@/assets/...`); only such media is served from there.
        const resolved = await noteRepository(res, file, req.query.notebook, { aliasedMedia: true }).catch((error: unknown) => {
          if (error instanceof SourceError && error.status === 403) throw new SourceError('Path is outside the notebooks.', 403);
          throw error;
        });
        state = await catalogOf(resolved.handle, resolved.config);
      } else {
        const named = await catalog(res, req.query.notebookId);
        state = named.state;
        if (managedNotebook(file, state.index.notebooks)?.id !== named.nb.id) throw new SourceError('Path is outside this notebook.', 403);
      }
      if (!state) throw new SourceError('File unavailable.', 404);
      if (!state.index.files.has(file)) throw new SourceError('File unavailable.', 404);
      bytes ??= await state.read(file);
      // Text goes out as plain text, a PDF as an inline PDF, and a page or any other file under the sandbox (see `rawFileHeaders`).
      const headers = rawFileHeaders(file);
      res.setHeader('Content-Security-Policy', headers.contentSecurityPolicy);
      res.removeHeader('X-Frame-Options');
      res.type(headers.contentType ?? (path.extname(file) || 'application/octet-stream'));
      if (req.query.download === '1') res.attachment(path.posix.basename(file));
      res.send(bytes);
    } catch (error) {
      fail(res, error);
    }
  });
  router.post('/api/files', async (req, res) => {
    const execute = async () => {
      const parsed = FileCommandSchema.parse(req.body?.command);
      // A filed live note (編輯中) moves without a Git write: its next check-in moves it (§20.4 of the built-in editor spec).
      if (parsed.kind === 'move') {
        const { handle } = await notebookRepository(res, parsed.notebookId);
        if (handle.kind !== 'local' && handle.reader.liveView && await handle.reader.livePath(parsed.path)) {
          const moved = await handle.reader.moveLive(parsed.path, parsed.destination, { ...(parsed.title !== undefined ? { title: parsed.title } : {}), editing: req.body?.editing === true });
          return void res.json({ revision: moved.checkIn?.revision ?? (await handle.reader.getSnapshot()).sha, selectedPath: parsed.destination, pathMap: { [parsed.path]: parsed.destination }, deletedPaths: [], live: moved });
        }
      }
      const state = await load(res, parsed), { command } = state;
      if (!state.writable) throw new SourceError('Write access on the main workspace branch is required.', 403);
      // A move is planned from the snapshot read here, so it needs no revision of the client's view: a named one must still be current.
      const unversioned = command.kind === 'move' && req.body.revision === undefined;
      if (!unversioned && (!req.body.revision || req.body.revision !== state.revision)) throw new SourceError('The workspace changed. Reload before saving.', 409);
      // The live notes a move takes along stay where they lie in its commit, and the links to them with them: each moves
      // at its own check-in (§20.4 of the built-in editor spec).
      const relocation = (file: string) => command.kind === 'move' && withinPath(file, command.path) ? command.destination + file.slice(command.path.length) : file;
      const live = state.reader && command.kind === 'move' ? await state.reader.liveRelocations(relocation) : { moves: [], kept: new Set<string>() };
      const after = planFileChange(state.snapshot, command, { stays: live.kept }), paths = changedFiles(state.snapshot, after);
      // Version files follow their files: moved along the path map, deleted with a deleted file.
      const relocate = (file: string) => after.pathMap[file] ?? file;
      const removed = (file: string) => !after.files.has(file) && !(file in after.pathMap);
      const followed = [...paths, ...Object.keys(after.pathMap)];
      let nextRevision: string;
      let liveLeft: Awaited<ReturnType<RemoteSource['followLiveRelocation']>>['left'] = [];
      if (state.local !== undefined) {
        applyLocalFilePlan(state.local, state.snapshot, after);
        moveLocalVersionFiles(state.local, followed, relocate, removed);
        nextRevision = catalogRevision(localFileCatalog(state.local, state.notebooks));
      } else {
        const reader = state.reader!;
        const { changes } = remoteFileChanges(state.remoteSnapshot!, state.snapshot, after);
        nextRevision = changes.length ? (await reader.commitChanges(changes, state.revision, command.kind, 'files', command.kind === 'move' ? moveMessage(after.pathMap) : undefined, state.remoteSnapshot)).revision : state.revision;
        // The commit landed: a live note that cannot follow stays where the links to it lead, and the answer says so.
        const followed = await reader.followLiveRelocation(live, relocation);
        for (const { file, destination } of followed.moved) after.pathMap[file] = destination;
        liveLeft = followed.left;
      }
      res.json({ revision: nextRevision, selectedPath: after.selectedPath, pathMap: after.pathMap, deletedPaths: [...paths.filter(file => !after.files.has(file)), ...state.snapshot.directories.filter(dir => !after.directories.includes(dir))], ...(liveLeft.length ? { liveLeft } : {}) });
    };
    try {
      // A local mutation is serialized on the worktree it changes.
      const command = FileCommandSchema.safeParse(req.body?.command);
      const { handle } = command.success ? await notebookRepository(res, command.data.notebookId) : { handle: undefined };
      if (handle?.kind === 'local') await serializeWorkspaceMutation(handle.root, execute);
      else await execute();
    } catch (error) {
      fail(res, error);
    }
  });
  return router;
}
function fail(res: Response, error: unknown) {
  const unreadable = error instanceof NoteFrontmatterUnreadableError;
  res.status(error instanceof SourceError || unreadable ? error.status : 400).json({ error: error instanceof Error ? error.message : 'File operation failed.', ...checkedOutFields(error), ...(unreadable ? { code: error.code } : {}) });
}
