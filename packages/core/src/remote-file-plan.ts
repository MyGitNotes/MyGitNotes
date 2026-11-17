import path from 'node:path';
import { isCompilationPath } from './compilation.js';
import { decodeTextFile, editableFile, type FileCommand, type FileSnapshot, managedNotebook, planFileChange, withinPath } from './file-manager.js';
import { SourceError } from './github-api.js';
import { mayLinkToMove, MOVE_RETAINED_BYTES, moveRetainedError, snapshotFileBatches } from './move-retention.js';
import { versionFileChanges } from './note-versions.js';
import type { RemoteChange, RemoteSnapshot, RemoteSource } from './remote-source.js';
import { WORKSPACE_DOCUMENTS } from './workspace-documents.js';

/*
 * The file manager's plan over a remote repository: the snapshot a file command is planned from, read with the move's
 * 32 MiB bound (0.21.2), and the commit changes a plan makes. The file route plans every command with it, and a live
 * note's check-in plans the move it commits (docs/specs/2026-11-15-builtin-live-editor §20.4) with the same planner.
 */

const auxiliary = WORKSPACE_DOCUMENTS.map(document => document.file);
const moves = (command?: FileCommand): command is Extract<FileCommand, { kind: 'move' | 'remove-directory'; }> => command?.kind === 'move' || command?.kind === 'remove-directory';

/** Whether planning `command` needs `file`'s bytes: what it changes, and for a move every note, compilation and workspace document that can link to it. */
export function fileNeedsContent(file: string, command?: FileCommand) {
  if (!command) return true;
  // Keep original bytes for rollback if unlink/rmdir fails partway through deletion.
  if (command.kind === 'delete-directory') return withinPath(file, command.path);
  if (moves(command)) return withinPath(file, command.path) || /\.(md|markdown)$/i.test(file) || isCompilationPath(file) || auxiliary.includes(file);
  return file === command.path || command.kind === 'metadata' && file === command.path + '/_dir.yml';
}

/**
 * Whether the planner needs `file`'s bytes once read: a move keeps what moves, compilations and workspace documents,
 * and only the notes that can link to the moved path (`mayLinkToMove`, the test the planner itself applies); every
 * other note stays an empty placeholder, as untouched files are, so it still counts for collisions.
 */
function retained(file: string, bytes: Buffer, command?: FileCommand) {
  if (!moves(command) || withinPath(file, command.path) || !/\.(md|markdown)$/i.test(file)) return true;
  const raw = decodeTextFile(bytes);
  return raw !== undefined && mayLinkToMove(raw, command.path);
}

/** Keeps what `retained` asks for within `MOVE_RETAINED_BYTES` of a move, read one file at a time. */
export function fileRetainer(command?: FileCommand) {
  let total = 0;
  return (file: string, bytes: Buffer) => {
    if (!retained(file, bytes, command)) return Buffer.alloc(0);
    total += bytes.length;
    if (total > MOVE_RETAINED_BYTES) throw moves(command) ? moveRetainedError() : new SourceError('File operations support 32 MiB per workspace snapshot.', 413);
    return bytes;
  };
}

/** The file snapshot `command` is planned from, over the repository as `state` holds it. */
export async function remoteFileSnapshot(reader: RemoteSource, state: RemoteSnapshot, command: FileCommand): Promise<FileSnapshot> {
  const config = await reader.config();
  const snapshot: FileSnapshot = { notebooks: config.notebooks, files: new Map(), directories: [], protectedPaths: [] };
  const readable: string[] = [];
  for (const entry of state.entries) {
    if (!config.notebooks.some(nb => withinPath(entry.path, nb.root)) && !auxiliary.includes(entry.path)) continue;
    if (entry.mode === '120000' || !['blob', 'tree'].includes(entry.type) || !auxiliary.includes(entry.path) && !managedNotebook(entry.path, config.notebooks, entry.type === 'tree' ? 'directory' : 'file')) snapshot.protectedPaths.push(entry.path);
    else if (entry.type === 'tree') snapshot.directories.push(entry.path);
    else readable.push(entry.path);
  }
  // A move reads every note for the links it rewrites, so the reads are batched instead of one round trip each, and
  // each batch keeps only the notes that can link to the moved path.
  const keep = fileRetainer(command);
  for (const file of readable) snapshot.files.set(file, Buffer.alloc(0));
  for await (const [file, bytes] of snapshotFileBatches(reader, state, readable.filter(file => fileNeedsContent(file, command)))) snapshot.files.set(file, keep(file, bytes));
  return snapshot;
}

/** The files a plan changed; refused past 200 files or 5 MiB. */
export function changedFiles(before: FileSnapshot, after: FileSnapshot) {
  const files = [...new Set([...before.files.keys(), ...after.files.keys()])].filter(file => !before.files.get(file)?.equals(after.files.get(file) ?? Buffer.alloc(0)) || !after.files.has(file));
  // A new empty file is a change even though it contains zero bytes.
  if (files.length > 200 || files.reduce((sum, file) => sum + (after.files.get(file)?.length || 0), 0) > 5 * 1024 * 1024) throw new SourceError('Operation exceeds 200 changed files or 5 MiB.', 413);
  return files;
}

/**
 * The commit changes of a plan over `state`: a file whose bytes did not change keeps its object, and the version files
 * of the files it moved or deleted follow them.
 */
export function remoteFileChanges(state: RemoteSnapshot, before: FileSnapshot, after: ReturnType<typeof planFileChange>): { changes: RemoteChange[]; paths: string[]; } {
  const paths = changedFiles(before, after);
  const relocate = (file: string) => after.pathMap[file] ?? file;
  const removed = (file: string) => !after.files.has(file) && !(file in after.pathMap);
  const changes: RemoteChange[] = paths.map(file => {
    const bytes = after.files.get(file);
    if (!bytes) return { path: file, sha: null };
    const original = [...before.files].find(([, original]) => original === bytes);
    if (original) return { path: file, sha: state.entries.find(entry => entry.path === original[0])!.sha };
    const content = editableFile(file, bytes);
    return content === undefined ? { path: file, base64: bytes.toString('base64') } : { path: file, content };
  });
  changes.push(...versionFileChanges(state.entries, [...paths, ...Object.keys(after.pathMap)], relocate, removed));
  return { changes, paths };
}

/**
 * Moving the note `from` to `to` with the text `content` (a live note's, in place of Git's): the commit changes, with
 * every link to it rewritten in the notes that stay, its own relative links rewritten for its new place, workspace
 * documents and its version file following it, and `content` as the move rewrote it. The folders `to` names are made
 * as Git makes them, by the files in them.
 */
export async function planRemoteNoteMove(reader: RemoteSource, state: RemoteSnapshot, notebookId: string, from: string, to: string, content: string): Promise<{ changes: RemoteChange[]; content: string; }> {
  const command: FileCommand = { kind: 'move', notebookId, path: from, destination: to };
  const before = await remoteFileSnapshot(reader, state, command);
  before.files.set(from, Buffer.from(content, 'utf8'));
  const directories = new Set(before.directories);
  for (let folder = path.posix.dirname(to); folder !== '.' && !directories.has(folder); folder = path.posix.dirname(folder)) directories.add(folder);
  before.directories = [...directories];
  const after = planFileChange(before, command);
  const { changes } = remoteFileChanges(state, before, after);
  return { changes, content: after.files.get(to)!.toString('utf8') };
}
