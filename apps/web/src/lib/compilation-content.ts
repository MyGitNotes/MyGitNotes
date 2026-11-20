import { findStudyNote, matchesStudyFilter, studyDue, type StudyWorkspace } from '@mygitnotes/core/study';
import { type CompilationItem, compilationNotes, type CompilationRow, contentItems } from '@mygitnotes/core/compilation';
import { resolveNoteStatuses } from '@mygitnotes/core/note-status';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { AssetItem, FolderItem, NotebookConfig } from './types.js';
import { sortNotes } from './note-sort.js';
import { noteFolderGrouping } from './note-groups.js';
import { type NoteSection, noteSection } from './note-navigation.js';

/** A heading-anchored note item as the whole note: what Open the note opens. */
export const wholeNoteItem = (item: Extract<CompilationItem, { kind: 'note'; }>): CompilationItem => ({ id: item.id, kind: 'note', notebookId: item.notebookId, path: item.path });

/**
 * The section a heading-anchored note item shows: `undefined` when the item is not anchored or its note's content
 * has not loaded, `null` once the note is there and no heading matches the anchor.
 */

export function itemSection(item: CompilationItem, note: Pick<NoteListItem, 'content'> | undefined): NoteSection | null | undefined {
  if (item.kind !== 'note' || !item.anchor || typeof note?.content !== 'string') return undefined;
  return noteSection(note.content, item.anchor);
}

export function compilationFolderOptions(notebook: NotebookConfig | undefined, folders: FolderItem[], assets: (AssetItem & { notebookId: string; })[]) {
  if (!notebook) return [];
  const options = new Map([[notebook.root, notebook.title]]);
  for (const folder of folders.filter(folder => folder.notebookId === notebook.id)) options.set(`${notebook.root}/${folder.path}`, folder.title);
  options.set(`${notebook.root}/${notebook.assets || 'assets'}`, notebook.assets || 'assets');
  for (const asset of assets.filter(asset => asset.notebookId === notebook.id && asset.path.startsWith(`${notebook.root}/`))) {
    const segments = asset.path.slice(notebook.root.length + 1).split('/').slice(0, -1);
    for (let index = 1; index <= segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      if (!options.has(`${notebook.root}/${relative}`)) options.set(`${notebook.root}/${relative}`, relative);
    }
  }
  return [...options].map(([path, title]) => ({ path, title }));
}

/**
 * The items a compilation shows, in order: a custom compilation's own, chapter headings included; a dynamic
 * compilation's members in its sort, and with `group: folder` a derived heading before each folder's members.
 * `folders` names the chapters and orders them as the sidebar does.
 */
export function compilationRowItems(row: CompilationRow, notes: NoteListItem[], assets: (AssetItem & { notebookId: string; })[], notebooks: NotebookConfig[] = [], folders: FolderItem[] = []): CompilationItem[] {
  if (row.kind === 'custom') return row.items;
  const members = dynamicMembers(row, notes, assets, notebooks);
  return row.group === 'folder' ? folderChapters(row, members, notebooks, folders) : members;
}

/** The row as a study session reads it: chapters do not change what is reviewed or its order. */
export const ungrouped = (row: CompilationRow): CompilationRow => row.kind === 'dynamic' && row.group ? { ...row, group: undefined } : row;

/**
 * Splits sorted members into one chapter per folder, keeping their order within each chapter, so a manual order
 * counts only against the members of its own chapter. Chapters follow the server's `group=folder` order: the root's
 * members, then folders in the sidebar's order, then folders it does not list by path; a folder's assets follow its
 * notes until a manual order places them elsewhere, and folders holding only assets come after the note chapters.
 * The headings live only in the browser.
 */
function folderChapters(row: Extract<CompilationRow, { kind: 'dynamic'; }>, members: CompilationItem[], notebooks: NotebookConfig[], folders: FolderItem[]): CompilationItem[] {
  const source = row.source;
  const notebook = notebooks.find(candidate => candidate.id === source.notebookId);
  const root = (notebook?.root ?? '').replace(/\/$/, '');
  const relative = (path: string) => path === root ? '' : path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  const selected = source.kind === 'folder' && relative(source.path) ? relative(source.path) : null;
  const titles = folders.filter(folder => folder.notebookId === source.notebookId);
  const selectedLabel = selected ? titles.find(folder => folder.path === selected)?.title ?? selected.split('/').pop()! : notebook?.title ?? source.notebookId;
  const groupOf = noteFolderGrouping({ notebookRoot: root, selectedFolder: selected, folders: titles, notebookId: source.notebookId, selectedLabel });
  const rank = new Map(titles.map((folder, index) => [folder.path, index + 1]));
  const chapters = new Map<string, { label: string; members: CompilationItem[]; hasNotes: boolean; }>();
  for (const item of members) {
    if (item.kind !== 'note' && item.kind !== 'asset') continue;
    const { key, label } = groupOf({ path: item.path } as NoteListItem);
    const chapter = chapters.get(key) ?? { label, members: [], hasNotes: false };
    chapters.set(key, chapter);
    chapter.members.push(item);
    chapter.hasNotes ||= item.kind === 'note';
  }
  const order = (key: string) => key === '' ? 0 : rank.get(key) ?? Number.MAX_SAFE_INTEGER;
  const noteless = (key: string) => !chapters.get(key)!.hasNotes;
  const keys = [...chapters.keys()].sort((a, b) => Number(noteless(a)) - Number(noteless(b)) || (noteless(a) ? a.localeCompare(b) : order(a) - order(b) || (order(a) === Number.MAX_SAFE_INTEGER ? a.localeCompare(b) : 0)));
  return keys.flatMap(key => {
    const chapter = chapters.get(key)!;
    const ordered = row.sort?.field === 'manual' ? chapter.members : [...chapter.members.filter(item => item.kind === 'note'), ...chapter.members.filter(item => item.kind === 'asset')];
    return [{ id: `group:${key}`, kind: 'heading' as const, title: chapter.label }, ...ordered];
  });
}

/** A dynamic compilation's members in its sort: notes and a folder source's assets. */
function dynamicMembers(row: Extract<CompilationRow, { kind: 'dynamic'; }>, notes: NoteListItem[], assets: (AssetItem & { notebookId: string; })[], notebooks: NotebookConfig[]): CompilationItem[] {
  const source = row.source;
  const within = (file: string) => file.startsWith(`${source.kind === 'folder' ? source.path : ''}/`) && (source.kind !== 'folder' || source.recursive || !file.slice(source.path.length + 1).includes('/'));
  // Membership is judged again on the loaded rows so a staged draft lands in the right lane.
  const selectedNotes: NoteListItem[] = compilationNotes({ ...row, study: undefined }, notes.map(note => ({ ...note, content: note.content ?? '' })));
  const selectedAssets = source.kind === 'folder' ? assets.filter(asset => asset.notebookId === source.notebookId && within(asset.path)) : [];
  if (row.sort) {
    const entries = [
      ...selectedNotes.map(note => ({ note, kind: 'note' as const })),
      // Assets have no creation metadata; use their modification time as in Notes.
      ...selectedAssets.map(asset => ({ kind: 'asset' as const, note: { id: asset.path, path: asset.path, notebookId: asset.notebookId, title: asset.name, mtime: asset.mtime, metadata: {}, tags: [], content: '' } as NoteListItem })),
    ];
    const items = new Map<string, CompilationItem>();
    const sortable = entries.map(({ note, kind }) => {
      const id = `dynamic:${row.id}:${note.path}`;
      items.set(id, { id, kind, notebookId: note.notebookId, path: note.path });
      return { ...note, id };
    });
    // Members come from the source's notebook, so its statuses order them.
    const applicable = notebooks.filter(notebook => notebook.id === source.notebookId);
    const statuses = [...new Set((applicable.length ? applicable.flatMap(notebook => resolveNoteStatuses(notebook)) : resolveNoteStatuses()).map(status => status.trim().toLowerCase()))];
    if (row.sort.field === 'manual') {
      // The user's order first; members it does not name follow, oldest update first, so new arrivals join at the end.
      const position = new Map((row.manualOrder ?? []).map((path, index) => [path, index]));
      const placed = sortable.filter(note => position.has(note.path)).sort((a, b) => position.get(a.path)! - position.get(b.path)!);
      const rest = sortNotes(sortable.filter(note => !position.has(note.path)), 'updated', 'asc', statuses);
      return [...placed, ...rest].map(note => items.get(note.id)!);
    }
    return sortNotes(sortable, row.sort.field, row.sort.order, statuses).map(note => items.get(note.id)!);
  }
  // Preserve the original note-first order until the user chooses a sort.
  return [...selectedNotes.sort((a, b) => a.title.localeCompare(b.title)).map(note => ({ id: `dynamic:${row.id}:${note.path}`, kind: 'note' as const, notebookId: note.notebookId, path: note.path })), ...selectedAssets.sort((a, b) => a.name.localeCompare(b.name)).map(asset => ({ id: `dynamic:${row.id}:${asset.path}`, kind: 'asset' as const, notebookId: asset.notebookId, path: asset.path }))];
}

export function noteSummary(content: string): string {
  return content.replace(/^#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/**
 * What a study session reviews, in flat item order: every item but the chapter headings, and each note once, at its
 * first item, since a card, its stage and its `status:` belong to the whole note however many of its sections are pinned.
 */
export function studyQueueItems(items: readonly CompilationItem[]): CompilationItem[] {
  const seen = new Set<string>();
  return contentItems(items).filter(item => {
    if (item.kind !== 'note') return true;
    const key = JSON.stringify([item.notebookId, item.path]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The items a lane, book or study session shows under the compilation's study settings; chapter headings stay where they are. */
export function studyRowItems(items: CompilationItem[], row: CompilationRow, notes: NoteListItem[], study: StudyWorkspace, now = new Date()): CompilationItem[] {
  if (!row.study) return items;
  const sources = new Map(notes.map(note => [JSON.stringify([note.notebookId, note.path]), note]));
  const lookup = (item: CompilationItem) => item.kind === 'note' ? sources.get(JSON.stringify([item.notebookId, item.path])) : undefined;
  const entries = items.map(item => {
    const note = lookup(item);
    return { item, note, study: note ? findStudyNote(study, { ...note, content: note.content ?? '' }) : undefined };
  }).filter(entry => entry.item.kind === 'heading' || (!row.study!.status || entry.note?.status === row.study!.status) && matchesStudyFilter(entry.study, row.study!.filter, now));
  if (row.study.dueFirst) entries.sort((a, b) => (a.study ? studyDue(a.study) || '~' : '~').localeCompare(b.study ? studyDue(b.study) || '~' : '~'));
  return entries.map(entry => entry.item);
}
