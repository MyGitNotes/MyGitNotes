import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import type { NotebookConfig } from './types.js';
import { aliasedMedia, isHiddenPath } from './classifier.js';
import { parseFolderConfig } from './folders.js';
import { relocateMovedLinks } from './folder-plan.js';
import { retitle } from './note-title.js';
import { isNoteFile, parseNoteFile, serializeNoteFile } from './note-file.js';
import { isOutlinePath } from './outline.js';
import { relocateWorkspaceDocuments, workspaceDocument } from './workspace-documents.js';
import { isCompilationPath, relocateCompilation } from './compilation.js';
import { decodeAsset } from './assets.js';
import { LEGACY_WORKSPACE_CONFIG_FILENAME, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { CASE_COLLISION_ERROR, differsOnlyInCase, foldedIndex, foldName } from './case-collision.js';

/* eslint-disable no-control-regex -- Control-character ranges validate paths and distinguish binary data from editable text. */
const filePath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Use a relative workspace path.');
/* eslint-enable no-control-regex */
const target = { notebookId: z.string().min(1), path: filePath };
export const FileCommandSchema = z.discriminatedUnion('kind', [z.object({ ...target, kind: z.literal('create') }).strict(), z.object({ ...target, kind: z.literal('write'), content: z.string() }).strict(), z.object({ ...target, kind: z.literal('upload'), base64: z.string() }).strict(), z.object({ ...target, kind: z.literal('mkdir') }).strict(), z.object({ ...target, kind: z.literal('move'), destination: filePath, title: z.string().trim().min(1).max(500).optional() }).strict(), z.object({ ...target, kind: z.literal('delete') }).strict(), z.object({ ...target, kind: z.literal('delete-directory') }).strict(), z.object({ ...target, kind: z.literal('remove-directory'), destination: filePath }).strict(), z.object({ ...target, kind: z.literal('metadata'), title: z.string().trim().min(1).max(120), description: z.string().max(10000), order: z.number().finite() }).strict()]);
export type FileCommand = z.infer<typeof FileCommandSchema>;
export interface FileSnapshot {
  notebooks: NotebookConfig[];
  directories: string[];
  protectedPaths: string[];
  files: Map<string, Buffer>;
}
export const withinPath = (file: string, dir: string) => file === dir || file.startsWith(dir + '/');

const EXCLUDED_PARTS = ['.git', '.claude', '.codex', '.agents', '.agent', 'node_modules', 'dist', 'build', 'agents.md', 'claude.md', 'gemini.md', WORKSPACE_CONFIG_FILENAME, LEGACY_WORKSPACE_CONFIG_FILENAME];
const excluded = (relative: string) => relative.split('/').some(part => EXCLUDED_PARTS.includes(part.toLowerCase())) || /(^|\/)docs\/agent(\/|$)/.test(relative);

/**
 * File browsing includes assets and dotfiles; note discovery keeps its own narrower rule. Outside every root, a notebook's
 * path alias target (tsconfig `@/*` → `blog/src/*`) lends it only the media its notes link, as `aliasedMedia` decides, and
 * the directories leading to them, so the rest of that source tree (code, configuration, data) is never browsed, read or
 * written. Pass `directory` for a directory path.
 */
export function managedNotebook(file: string, notebooks: NotebookConfig[], kind: 'file' | 'directory' = 'file'): NotebookConfig | undefined {
  if (!filePath.safeParse(file).success || workspaceDocument(file)) return;
  const nb = [...notebooks].sort((a, b) => b.root.length - a.root.length).find(nb => withinPath(file, nb.root));
  if (nb) return excluded(file.slice(nb.root.length + 1)) ? undefined : nb;
  if (excluded(file)) return;
  return notebooks.find(n =>
    kind === 'file' ? aliasedMedia(file, n) : !isHiddenPath(file) && Object.values(n.pathAliases ?? {}).some(target => {
      const targetDir = target.replace(/\*$/, '').replace(/\/$/, '');
      return targetDir && withinPath(file, targetDir);
    })
  );
}

export function decodeTextFile(bytes: Uint8Array): string | undefined {
  try {
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    /* eslint-disable no-control-regex -- Control-character ranges validate paths and distinguish binary data from editable text. */
    return /[\x00-\x08\x0b\x0e-\x1f]/.test(value) ? undefined : value;
    /* eslint-enable no-control-regex */
  } catch {
    return;
  }
}
export function filePresentation(file: string): 'image' | 'pdf' | 'audio' | 'video' | 'file' {
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file)) return 'image';
  if (/\.pdf$/i.test(file)) return 'pdf';
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(file)) return 'audio';
  if (/\.(mp4|webm|mov|m4v)$/i.test(file)) return 'video';
  return 'file';
}
export function editableFile(file: string, bytes: Uint8Array): string | undefined {
  if (filePresentation(file) !== 'file' && !/\.svg$/i.test(file) || /\.(zip|gz|7z|rar|exe|dll|bin|woff2?|ttf|otf)$/i.test(file)) return;
  return decodeTextFile(bytes);
}

/**
 * The stored form of the note `raw` once renamed `title`: the frontmatter title, or the heading that names the note,
 * follow `retitle`. Not applied to a compilation, which keeps its name in its own file.
 */
export function retitleNoteFile(raw: string, file: string, title: string, now: Date = new Date()): string {
  const parsed = parseNoteFile(raw, file);
  const next = retitle(parsed.content, parsed.metadata, title, isOutlinePath(file), parsed.title);
  return serializeNoteFile(file, next.metadata, next.content, false, now, raw);
}

export function planFileChange(snapshot: FileSnapshot, input: unknown) {
  const command = FileCommandSchema.parse(input);
  const nb = snapshot.notebooks.find(n => n.id === command.notebookId);
  const snapshotDirectories = new Set(snapshot.directories);
  const assertPath = (file: string, allowRoot = false, directory = snapshotDirectories.has(file)) => {
    if (!nb || managedNotebook(file, snapshot.notebooks, directory ? 'directory' : 'file')?.id !== nb.id || !allowRoot && file === nb.root || snapshot.protectedPaths.some(p => withinPath(file, p))) throw new Error('Path is not an editable file in this notebook.');
  };
  assertPath(command.path, command.kind === 'metadata', command.kind === 'mkdir' || snapshotDirectories.has(command.path));
  // A folder keeps its title in `_dir.yml`, which a path alias target, lending only media, does not hold.
  if (command.kind === 'mkdir' || command.kind === 'metadata') assertPath(`${command.path}/_dir.yml`, false, false);
  const files = new Map(snapshot.files), directories = new Set(snapshot.directories);
  const exists = (file: string) => files.has(file) || directories.has(file) || snapshot.protectedPaths.includes(file);
  // Every check runs before the plan changes anything, so one index of the snapshot's names, folded to lower case, serves them all.
  let folded: Map<string, string[]> | undefined;
  const assertCase = (file: string, skip?: (entry: string) => boolean) => {
    folded ??= foldedIndex([...snapshot.files.keys(), ...snapshot.directories, ...snapshot.protectedPaths]);
    if (differsOnlyInCase(folded.get(foldName(file)) ?? [], file, skip)) throw new Error(CASE_COLLISION_ERROR);
  };
  const assertParent = (file: string) => {
    if (!directories.has(path.posix.dirname(file))) throw new Error('Destination directory does not exist.');
  };
  let selectedPath = command.path;
  const pathMap: Record<string, string> = {};
  if (['create', 'upload', 'mkdir'].includes(command.kind)) {
    if (exists(command.path)) throw new Error('Destination already exists.');
    assertCase(command.path);
    assertParent(command.path);
    if (command.kind === 'mkdir') {
      directories.add(command.path);
      files.set(`${command.path}/_dir.yml`, Buffer.from(YAML.stringify({ title: path.posix.basename(command.path) })));
    } else files.set(command.path, command.kind === 'upload' ? decodeAsset(command.base64) : Buffer.alloc(0));
  } else if (command.kind === 'write') {
    const before = files.get(command.path);
    if (!before || editableFile(command.path, before) === undefined) throw new Error('This file is not editable UTF-8 text.');
    if (Buffer.byteLength(command.content) > 5 * 1024 * 1024) throw new Error('Text files support up to 5 MiB.');
    if (path.posix.basename(command.path) === '_dir.yml') parseFolderConfig(command.content, path.posix.basename(path.posix.dirname(command.path)), command.path);
    files.set(command.path, Buffer.from(command.content));
  } else if (command.kind === 'metadata') {
    if (!directories.has(command.path)) throw new Error('Directory does not exist.');
    const file = command.path + '/_dir.yml';
    const existing = YAML.parse(files.get(file)?.toString('utf8') || '') || {};
    const raw = YAML.stringify({ ...existing, title: command.title, description: command.description, order: command.order });
    parseFolderConfig(raw, command.title, file);
    files.set(file, Buffer.from(raw));
  } else if (command.kind === 'delete') {
    if (!files.has(command.path)) throw new Error('File does not exist.');
    files.delete(command.path);
    selectedPath = path.posix.dirname(command.path);
  } else if (command.kind === 'delete-directory') {
    if (!directories.has(command.path)) throw new Error('Directory does not exist.');
    if (snapshot.protectedPaths.some(p => withinPath(p, command.path))) throw new Error('This directory contains protected entries.');
    if (snapshot.notebooks.some(other => other.id !== nb!.id && withinPath(other.root, command.path))) throw new Error('This directory contains another notebook.');
    // Validate the entire scope before removing anything, including hidden descendants.
    for (const file of [...directories, ...files.keys()]) if (withinPath(file, command.path)) assertPath(file);
    for (const file of files.keys()) if (withinPath(file, command.path)) files.delete(file);
    for (const dir of directories) if (withinPath(dir, command.path)) directories.delete(dir);
    selectedPath = path.posix.dirname(command.path);
  } else if (command.kind === 'move' || command.kind === 'remove-directory') {
    const destination = command.destination;
    assertPath(destination, command.kind === 'remove-directory', command.kind === 'remove-directory' || snapshotDirectories.has(command.path));
    const isDirectory = directories.has(command.path);
    if (!isDirectory && !files.has(command.path)) throw new Error('Source does not exist.');
    if (command.path === destination || isDirectory && withinPath(destination, command.path)) throw new Error('Choose a destination outside the source.');
    if (snapshot.protectedPaths.some(p => withinPath(p, command.path))) throw new Error('This directory contains protected entries.');
    if (snapshot.notebooks.some(other => other.id !== nb!.id && withinPath(other.root, command.path))) throw new Error('This directory contains another notebook.');
    if (command.kind === 'remove-directory') {
      if (!isDirectory || !directories.has(destination)) throw new Error('Choose an existing destination directory.');
    } else {
      assertParent(destination);
      if (exists(destination)) throw new Error('Destination already exists.');
    }
    // The source itself counts: a rename that changes only letter case writes the new name over the old entry, then deletes it.
    const inSource = (entry: string) => withinPath(entry, command.path) && entry !== command.path;
    const title = command.kind === 'move' ? command.title : undefined;
    const relocate = (file: string) => withinPath(file, command.path) ? destination + file.slice(command.path.length) : file;
    const removedMetadata = command.kind === 'remove-directory' ? command.path + '/_dir.yml' : '';
    for (const source of [...directories, ...files.keys()]) {
      if (!withinPath(source, command.path) || source === removedMetadata || command.kind === 'remove-directory' && source === command.path) continue;
      const next = relocate(source);
      assertPath(next, false, snapshotDirectories.has(source));
      if (exists(next)) throw new Error('Destination already exists.');
      assertCase(next, inSource);
      pathMap[source] = next;
    }
    files.clear();
    directories.clear();
    for (const dir of snapshot.directories) if (!(command.kind === 'remove-directory' && dir === command.path)) directories.add(relocate(dir));
    for (const [file, bytes] of snapshot.files) {
      if (file === removedMetadata) continue;
      const next = relocate(file);
      const raw = /\.(md|markdown)$/i.test(file) ? decodeTextFile(bytes) : undefined;
      // A compilation pins paths of its notebook; they follow the move like a link does.
      const pinned = isCompilationPath(file) && bytes.length ? relocateCompilation(decodeTextFile(bytes) ?? '', relocate) : null;
      const relinked = pinned !== null ? Buffer.from(pinned) : raw === undefined ? bytes : Buffer.from(relocateMovedLinks(raw, file, next, relocate, command.path));
      // The moved note takes its new title in the same write, so the move never leaves the old title behind.
      const text = title && file === command.path && !isDirectory && isNoteFile(file) && !isCompilationPath(file) ? decodeTextFile(relinked) : undefined;
      files.set(next, text === undefined ? relinked : Buffer.from(retitleNoteFile(text, next, title!)));
    }
    pathMap[command.path] = destination;
    relocateWorkspaceDocuments({ get: file => files.get(file)?.toString('utf8'), set: (file, text) => files.set(file, Buffer.from(text)) }, nb!, relocate);
    selectedPath = destination;
  }
  for (const [file, bytes] of files) if (path.posix.basename(file) === '_dir.yml' && bytes !== snapshot.files.get(file)) parseFolderConfig(bytes.toString('utf8'), path.posix.basename(path.posix.dirname(file)), file);
  return { ...snapshot, files, directories: [...directories], selectedPath, pathMap };
}
